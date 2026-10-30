namespace Aisles.App.Domain;

/// <summary>
/// Walks a console's games folder, then enriches each find with the best on-disk title
/// and serial. The folder name beats file metadata except where the PCSX2 cache is authoritative.
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

        // Serial joins a disc dump to its installed update or copy, so it is collected
        // while disc roots are walked and prevents the installed pass from listing it twice.
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
        "DiscFolders" => FindDiscRoots(console),

        "FlatFiles" => FindByExtension(console, searchSubdirectories: false)
            .Select(file => new Discovered(file, Path.GetFileNameWithoutExtension(file))),

        "CuePerFolder" or "FileInFolder" => FindByExtension(console, searchSubdirectories: true)
            .Select(file => new Discovered(file, HintFromContainingFolder(console, file))),

        _ => Enumerable.Empty<Discovered>(),
    };

    /// <summary>
    /// Each game sits in its own folder, and that folder is the human name; a loose file
    /// falls back to its own name.
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
    /// The disc folder supplies the display name. Most disc-folder emulators launch that
    /// folder (PS3), while Xenia launches the <c>default.xex</c> marker itself.
    /// </summary>
    private static IEnumerable<Discovered> FindDiscRoots(ConsoleDescriptor console)
    {
        if (string.IsNullOrWhiteSpace(console.ScanMarker))
        {
            return Array.Empty<Discovered>();
        }

        return Directory
            .EnumerateFiles(console.GamesPath, console.ScanMarker, SearchOption.AllDirectories)
            .Select(marker => new { Marker = marker, Folder = Path.GetDirectoryName(marker) })
            .Where(found => !string.IsNullOrEmpty(found.Folder))
            .GroupBy(found => found.Folder!, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Select(found => new Discovered(
                Path.GetExtension(found.Marker).Equals(".xex", StringComparison.OrdinalIgnoreCase)
                    ? found.Marker
                    : found.Folder!,
                Path.GetFileName(found.Folder!)));
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
            // artwork contract requires.
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
    /// Installed HDD/PSN games live in RPCS3's <c>dev_hdd0\game</c>. Only bootable <c>HG</c>
    /// entries are games; a title ID already claimed by a disc is skipped.
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
        // Installed titles are where PARAM.SFO beats the folder name: RPCS3 shows this
        // TITLE, and there is no human folder name. The trademark mark is typography.
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
    /// A disc dump reports its burned version, while RPCS3 shows the installed patch level;
    /// reading the installed copy when it exists keeps the rail in step with the emulator.
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
    /// PS3 disc metadata lives in <c>PS3_GAME\PARAM.SFO</c>. The preferred path is tried
    /// first; subfolders are a fallback, and a file without TITLE_ID is a decoy.
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
