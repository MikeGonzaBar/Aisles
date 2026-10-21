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
        if (!console.GamesPathExists && !console.InstalledGamesPathExists)
        {
            return Array.Empty<GameEntry>();
        }

        var metadata = MetadataSource.Resolve(console);
        var artwork = ArtworkLookup.For(console);
        var entries = new List<GameEntry>();

        // Serial is the join key between a disc dump and its installed update or an
        // installed copy of the same game, so it is collected while the disc roots are
        // walked and used to keep the installed pass from listing a game twice.
        var knownSerials = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (console.GamesPathExists)
        {
            foreach (var found in Discover(console))
            {
                var entry = CreateEntry(console, found, metadata, artwork);
                entry = entry with { Version = InstalledVersion(console, entry.Serial) ?? entry.Version };
                entries.Add(entry);

                if (!string.IsNullOrWhiteSpace(entry.Serial))
                {
                    knownSerials.Add(entry.Serial);
                }
            }
        }

        entries.AddRange(DiscoverInstalled(console, knownSerials)
            .Select(found => CreateInstalledEntry(console, found, artwork)));

        return entries;
    }

    /// <summary>A launch target plus the best name we can guess for it from the path alone.</summary>
    private readonly record struct Discovered(string LaunchTarget, string NameHint);

    /// <summary>An installed (non-disc) game folder and the metadata that identifies it.</summary>
    private readonly record struct InstalledGame(string Folder, ParamSfo Sfo);

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

    private static GameEntry CreateEntry(
        ConsoleDescriptor console,
        Discovered found,
        MetadataSource metadata,
        ArtworkLookup artwork)
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

        var disc = ReadDiscMetadata(found.LaunchTarget);
        serial ??= disc.Serial;

        return new GameEntry
        {
            // Stable across rescans, and bound to platform + launch target as the
            // artwork contract requires (PLAN.md section 5.3).
            Id = $"{console.Id}:{found.LaunchTarget}".ToLowerInvariant(),
            ConsoleId = console.Id,
            Title = title,
            LaunchTarget = found.LaunchTarget,
            Serial = serial,
            Version = disc.Version,
            TitleSource = titleSource,
            FrontCover = artwork.Resolve(title, serial, found.LaunchTarget),
        };
    }

    /// <summary>
    /// Installed HDD/PSN games live beside the disc registrations, in RPCS3's
    /// <c>dev_hdd0\game</c>. Only bootable <c>HG</c> entries are games; the folder also
    /// holds disc updates (<c>GD</c>), per-profile data such as
    /// <c>BCUS98148_USER1</c>, and empty test folders. A title ID already claimed by a
    /// disc is skipped, so an installed update does not become a second shelf entry.
    /// </summary>
    private static IEnumerable<InstalledGame> DiscoverInstalled(
        ConsoleDescriptor console,
        HashSet<string> knownSerials)
    {
        if (!console.InstalledGamesPathExists)
        {
            yield break;
        }

        string[] folders;

        try
        {
            folders = Directory.GetDirectories(console.InstalledGamesPath!);
        }
        catch (IOException)
        {
            yield break;
        }
        catch (UnauthorizedAccessException)
        {
            yield break;
        }

        foreach (var folder in folders)
        {
            var sfo = ParamSfo.TryRead(Path.Combine(folder, "PARAM.SFO"));

            if (sfo is null
                || !string.Equals(sfo.Category, "HG", StringComparison.OrdinalIgnoreCase)
                || !sfo.IsBootable
                || string.IsNullOrWhiteSpace(sfo.TitleId)
                || !knownSerials.Add(sfo.TitleId))
            {
                continue;
            }

            yield return new InstalledGame(folder, sfo);
        }
    }

    private static GameEntry CreateInstalledEntry(
        ConsoleDescriptor console,
        InstalledGame found,
        ArtworkLookup artwork)
    {
        // Installed titles are the one place PARAM.SFO is more trustworthy than the
        // folder name: RPCS3 shows this TITLE, and there is no human folder name to
        // preserve. The trademark mark is typography, not part of the name.
        var title = TitleNormalizer.Normalize(CleanTitle(found.Sfo.Title));
        if (title.Length == 0)
        {
            title = TitleNormalizer.Normalize(Path.GetFileName(found.Folder));
        }

        return new GameEntry
        {
            Id = $"{console.Id}:{found.Folder}".ToLowerInvariant(),
            ConsoleId = console.Id,
            Title = title,
            LaunchTarget = found.Folder,
            Serial = found.Sfo.TitleId,
            Version = found.Sfo.AppVer,
            TitleSource = "param-sfo",
            FrontCover = artwork.Resolve(title, found.Sfo.TitleId, found.Folder),
        };
    }

    /// <summary>
    /// A disc dump reports the version burned into it (LBP: 01.01), while RPCS3 shows the
    /// installed patch level from <c>dev_hdd0\game\&lt;TITLE_ID&gt;</c> (01.30). Reading
    /// the installed copy when one exists keeps the rail in step with the emulator.
    /// </summary>
    private static string? InstalledVersion(ConsoleDescriptor console, string? serial)
    {
        if (string.IsNullOrWhiteSpace(serial) || !console.InstalledGamesPathExists)
        {
            return null;
        }

        return ParamSfo.TryRead(Path.Combine(console.InstalledGamesPath!, serial, "PARAM.SFO"))?.AppVer;
    }

    private static string? CleanTitle(string? title) =>
        title?.Replace("™", string.Empty).Replace("®", string.Empty);

    /// <summary>Reads a serial and version out of whatever metadata the target carries.</summary>
    private static (string? Serial, string? Version) ReadDiscMetadata(string launchTarget)
    {
        if (Directory.Exists(launchTarget))
        {
            return ReadDiscMetadataFromSfo(launchTarget);
        }

        if (Path.GetExtension(launchTarget).Equals(".nds", StringComparison.OrdinalIgnoreCase))
        {
            var header = NdsRomHeader.TryRead(launchTarget);
            return (string.IsNullOrWhiteSpace(header?.GameCode) ? null : header?.GameCode, null);
        }

        return (null, null);
    }

    /// <summary>
    /// PS3 disc roots keep their metadata in <c>PS3_GAME\PARAM.SFO</c>. The preferred
    /// location is tried first; the scan of immediate subfolders exists only so a disc
    /// laid out slightly differently still yields its serial, and it rejects any
    /// <c>PARAM.SFO</c> that has no <c>TITLE_ID</c> — which is what the decoy files are.
    /// </summary>
    private static (string? Serial, string? Version) ReadDiscMetadataFromSfo(string discRoot)
    {
        var sfo = ParamSfo.TryRead(Path.Combine(discRoot, "PS3_GAME", "PARAM.SFO"));
        if (!string.IsNullOrWhiteSpace(sfo?.TitleId))
        {
            return (sfo.TitleId, sfo.AppVer);
        }

        try
        {
            foreach (var folder in Directory.EnumerateDirectories(discRoot))
            {
                var candidate = ParamSfo.TryRead(Path.Combine(folder, "PARAM.SFO"));
                if (!string.IsNullOrWhiteSpace(candidate?.TitleId))
                {
                    return (candidate.TitleId, candidate.AppVer);
                }
            }
        }
        catch (IOException)
        {
            return (null, null);
        }
        catch (UnauthorizedAccessException)
        {
            return (null, null);
        }

        return (null, null);
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
