namespace Aisles.App.Domain;

/// <summary>
/// Walks a console's games folder using the strategy named in <c>consoles.json</c>.
///
/// Phase 0 scope: the four folder shapes from PLAN.md section 3.1, with titles
/// derived from filenames. The per-console metadata adapters (disc serials, NDS
/// ROM headers, PS3 <c>PARAM.SFO</c>, Dolphin header JSON) are Phase 1 and will
/// replace <see cref="DeriveTitle"/> without changing this shape.
/// </summary>
public sealed class LibraryScanner
{
    public IReadOnlyList<GameEntry> Scan(ConsoleDescriptor console)
    {
        if (!console.GamesPathExists)
        {
            return Array.Empty<GameEntry>();
        }

        var targets = console.Scan switch
        {
            "FlatFiles" => FindByExtension(console, searchSubdirectories: false),
            "CuePerFolder" => FindByExtension(console, searchSubdirectories: true),
            "FileInFolder" => FindByExtension(console, searchSubdirectories: true),
            "DiscFolders" => FindDiscRoots(console),
            _ => Array.Empty<string>(),
        };

        return targets.Select(target => CreateEntry(console, target)).ToList();
    }

    /// <summary>
    /// The launch target is the folder holding the marker, not the marker itself.
    /// For PS3 that folder is the disc root RPCS3 expects.
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

    private static GameEntry CreateEntry(ConsoleDescriptor console, string launchTarget)
    {
        return new GameEntry
        {
            // Stable across rescans, and bound to platform + launch target as the
            // artwork contract requires (PLAN.md section 5.3).
            Id = $"{console.Id}:{launchTarget}".ToLowerInvariant(),
            ConsoleId = console.Id,
            Title = DeriveTitle(launchTarget),
            LaunchTarget = launchTarget,
        };
    }

    private static string DeriveTitle(string launchTarget)
    {
        var name = Path.GetFileNameWithoutExtension(launchTarget);
        return string.IsNullOrWhiteSpace(name) ? Path.GetFileName(launchTarget) : name;
    }
}
