namespace Aisles.App.Domain;

/// <summary>
/// Walks a console's games folder using the strategy named in <c>consoles.json</c>, then
/// enriches each find with the best title and serial available on disk.
///
/// The guiding rule is that the name a person gave a folder beats anything stored inside
/// the file. This machine's evidence is blunt about why: the PS1 folder "A bugs life" holds
/// "A_BUGS_LIFE.CUE", the DS folder "2269 - Iron Man (E)(SQUiRE)" holds a ROM titled
/// "IRON MAN DS", and PS3 <c>PARAM.SFO</c> reports "LittleBigPlanetT". Emulator metadata is
/// therefore used to *replace* a derived name only where it is genuinely authoritative
/// (the PCSX2 cache), and to supply the serial wherever one exists.
/// </summary>
public sealed class LibraryScanner
{
    public IReadOnlyList<GameEntry> Scan(ConsoleDescriptor console)
    {
        if (!console.GamesPathExists)
        {
            return Array.Empty<GameEntry>();
        }

        var metadata = MetadataSource.Resolve(console);

        return Discover(console)
            .Select(found => CreateEntry(console, found, metadata))
            .ToList();
    }

    /// <summary>A launch target plus the best name we can guess for it from the path alone.</summary>
    private readonly record struct Discovered(string LaunchTarget, string NameHint);

    private static IEnumerable<Discovered> Discover(ConsoleDescriptor console) => console.Scan switch
    {
        "DiscFolders" => FindDiscRoots(console)
            .Select(folder => new Discovered(folder, Path.GetFileName(folder))),

        "FlatFiles" => FindByExtension(console, searchSubdirectories: false)
            .Select(file => new Discovered(file, Path.GetFileNameWithoutExtension(file))),

        "CuePerFolder" or "FileInFolder" => FindByExtension(console, searchSubdirectories: true)
            .Select(file => new Discovered(file, HintFromContainingFolder(console, file))),

        _ => Enumerable.Empty<Discovered>(),
    };

    /// <summary>
    /// In these shapes each game sits in its own folder, and that folder is the human
    /// name. A file loose in the games folder itself has no such name, so it falls back
    /// to its own.
    /// </summary>
    private static string HintFromContainingFolder(ConsoleDescriptor console, string file)
    {
        var folder = Path.GetDirectoryName(file);

        if (!string.IsNullOrEmpty(folder) && !IsSameFolder(folder, console.GamesPath))
        {
            return Path.GetFileName(folder);
        }

        return Path.GetFileNameWithoutExtension(file);
    }

    private static bool IsSameFolder(string left, string right) =>
        string.Equals(
            Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar),
            Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The launch target is the folder holding the marker, not the marker itself. For PS3
    /// that folder is the disc root RPCS3 expects, and anchoring on the marker is what
    /// keeps the decoy <c>PARAM.SFO</c> files out (PLAN.md section 3.1).
    /// </summary>
    private static IEnumerable<string> FindDiscRoots(ConsoleDescriptor console)
    {
        if (string.IsNullOrWhiteSpace(console.ScanMarker))
        {
            return Array.Empty<string>();
        }

        return Directory
            .EnumerateFiles(console.GamesPath, console.ScanMarker, SearchOption.AllDirectories)
            .Select(Path.GetDirectoryName)
            .Where(folder => !string.IsNullOrEmpty(folder))
            .Select(folder => folder!)
            .Distinct(StringComparer.OrdinalIgnoreCase);
    }

    private static IEnumerable<string> FindByExtension(ConsoleDescriptor console, bool searchSubdirectories)
    {
        var option = searchSubdirectories ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;

        return console.Extensions
            .Where(extension => !string.IsNullOrWhiteSpace(extension))
            .SelectMany(extension => Directory.EnumerateFiles(console.GamesPath, "*" + extension, option))
            .Distinct(StringComparer.OrdinalIgnoreCase);
    }

    private static GameEntry CreateEntry(ConsoleDescriptor console, Discovered found, MetadataSource metadata)
    {
        var title = TitleNormalizer.Normalize(found.NameHint);
        var titleSource = "name";
        string? serial = null;

        if (metadata.GameListCache is { } cache && cache.TryGet(found.LaunchTarget, out var cached))
        {
            title = cached.Title;
            titleSource = "pcsx2-gamelist";
            serial = cached.Serial;
        }

        serial ??= ReadSerialFromDisc(found.LaunchTarget);

        return new GameEntry
        {
            // Stable across rescans, and bound to platform + launch target as the
            // artwork contract requires (PLAN.md section 5.3).
            Id = $"{console.Id}:{found.LaunchTarget}".ToLowerInvariant(),
            ConsoleId = console.Id,
            Title = title,
            LaunchTarget = found.LaunchTarget,
            Serial = serial,
            TitleSource = titleSource,
        };
    }

    /// <summary>Reads a serial out of whatever metadata the target happens to carry.</summary>
    private static string? ReadSerialFromDisc(string launchTarget)
    {
        if (Directory.Exists(launchTarget))
        {
            return ReadDiscSerial(launchTarget);
        }

        if (Path.GetExtension(launchTarget).Equals(".nds", StringComparison.OrdinalIgnoreCase))
        {
            var header = NdsRomHeader.TryRead(launchTarget);
            return string.IsNullOrWhiteSpace(header?.GameCode) ? null : header?.GameCode;
        }

        return null;
    }

    /// <summary>
    /// PS3 disc roots keep their metadata in <c>PS3_GAME\PARAM.SFO</c>. The preferred
    /// location is tried first; the scan of immediate subfolders exists only so a disc
    /// laid out slightly differently still yields its serial, and it rejects any
    /// <c>PARAM.SFO</c> that has no <c>TITLE_ID</c> — which is what the decoy files are.
    /// </summary>
    private static string? ReadDiscSerial(string discRoot)
    {
        var titleId = ParamSfo.TryRead(Path.Combine(discRoot, "PS3_GAME", "PARAM.SFO"))?.TitleId;
        if (!string.IsNullOrWhiteSpace(titleId))
        {
            return titleId;
        }

        try
        {
            foreach (var folder in Directory.EnumerateDirectories(discRoot))
            {
                var candidate = ParamSfo.TryRead(Path.Combine(folder, "PARAM.SFO"))?.TitleId;
                if (!string.IsNullOrWhiteSpace(candidate))
                {
                    return candidate;
                }
            }
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }

        return null;
    }

    /// <summary>Metadata available from the emulator configured for this console.</summary>
    private sealed class MetadataSource
    {
        public Pcsx2GameListCache? GameListCache { get; private init; }

        public static MetadataSource Resolve(ConsoleDescriptor console) => new()
        {
            GameListCache = Pcsx2GameListCache.TryLoad(console.EmulatorPath),
        };
    }
}
