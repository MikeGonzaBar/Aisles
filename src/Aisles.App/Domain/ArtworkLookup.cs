using System.Text;

namespace Aisles.App.Domain;

/// <summary>
/// Finds artwork already on this machine: an emulator cover folder keyed by serial or
/// title, or a sidecar beside the game. Case fronts only.
/// </summary>
public sealed class ArtworkLookup
{
    private static readonly string[] ImageExtensions = [".png", ".jpg", ".jpeg", ".webp"];

    /// <summary>
    /// Fuzzy match floor: high enough that editions stay apart, though it accepts
    /// "Sorcerer Stone" versus "Sorcerer's Stone".
    /// </summary>
    private const double SimilarTitleFloor = 0.90;

    private readonly IReadOnlyList<CoverCandidate> _covers;
    private readonly string _gamesRoot;
    private readonly Dictionary<string, IReadOnlyList<string>> _folders = new(StringComparer.OrdinalIgnoreCase);

    private ArtworkLookup(IReadOnlyList<CoverCandidate> covers, string gamesRoot)
    {
        _covers = covers;
        _gamesRoot = gamesRoot;
    }

    /// <summary>
    /// Indexes the console's cover folder once, reused by every game in the scan.
    /// </summary>
    public static ArtworkLookup For(ConsoleDescriptor console)
    {
        var covers = new List<CoverCandidate>();

        if (!string.IsNullOrWhiteSpace(console.ArtworkPath) && Directory.Exists(console.ArtworkPath))
        {
            try
            {
                covers.AddRange(Directory
                    .EnumerateFiles(console.ArtworkPath, "*", SearchOption.TopDirectoryOnly)
                    .Where(IsImage)
                    .Select(file => new CoverCandidate(file, MatchKey(Path.GetFileNameWithoutExtension(file))))
                    .Where(candidate => candidate.Key.Length > 0));
            }
            catch (IOException)
            {
                // An unreadable artwork folder is not a game-scan failure.
            }
            catch (UnauthorizedAccessException)
            {
            }
        }

        return new ArtworkLookup(covers, console.GamesPath);
    }

    /// <summary>Chooses a case front for one game, or null when none is suitable.</summary>
    public ArtworkReference? Resolve(string title, string? serial, string launchTarget) =>
        FindSidecar(launchTarget) ?? FindInCoverFolder(title, serial);

    /// <summary>
    /// A cover beside the game wins over a shared folder; flat-library names are accepted
    /// in two tiers so a loose "*- Cover.png" cannot belong to a neighbour.
    /// </summary>
    private ArtworkReference? FindSidecar(string launchTarget)
    {
        var folder = Directory.Exists(launchTarget) ? launchTarget : Path.GetDirectoryName(launchTarget);
        if (string.IsNullOrEmpty(folder))
        {
            return null;
        }

        var files = ImagesIn(folder);
        if (files.Count == 0)
        {
            return null;
        }

        var stem = Path.GetFileNameWithoutExtension(launchTarget);
        var perGameFolder = !IsSameFolder(folder, _gamesRoot);

        foreach (var file in files)
        {
            var name = Path.GetFileNameWithoutExtension(file);

            if (name.Equals(stem + " - Cover", StringComparison.OrdinalIgnoreCase)
                || name.Equals(stem + ".cover", StringComparison.OrdinalIgnoreCase)
                || (perGameFolder
                    && (name.Equals("cover", StringComparison.OrdinalIgnoreCase)
                        || name.EndsWith(" - Cover", StringComparison.OrdinalIgnoreCase))))
            {
                return new ArtworkReference(file, "sidecar", "sidecar");
            }
        }

        return null;
    }

    /// <summary>
    /// Serial first because it survives title spelling; title rules follow from strictest
    /// to loosest, with the loosest capped by <see cref="SimilarTitleFloor"/>.
    /// </summary>
    private ArtworkReference? FindInCoverFolder(string title, string? serial)
    {
        if (_covers.Count == 0)
        {
            return null;
        }

        var serialKey = MatchKey(serial);
        if (serialKey.Length > 0)
        {
            var bySerial = _covers.FirstOrDefault(candidate => candidate.Key == serialKey);
            if (bySerial is not null)
            {
                return new ArtworkReference(bySerial.File, "cover-folder", "serial");
            }
        }

        var titleKey = MatchKey(title);
        if (titleKey.Length == 0)
        {
            return null;
        }

        var exact = _covers.FirstOrDefault(candidate => candidate.Key == titleKey);
        if (exact is not null)
        {
            return new ArtworkReference(exact.File, "cover-folder", "title");
        }

        var contains = _covers.FirstOrDefault(candidate =>
            titleKey.Length > 4
            && (candidate.Key.Contains(titleKey, StringComparison.Ordinal)
                || titleKey.Contains(candidate.Key, StringComparison.Ordinal)));
        if (contains is not null)
        {
            return new ArtworkReference(contains.File, "cover-folder", "title-contains");
        }

        CoverCandidate? closest = null;
        var best = SimilarTitleFloor;

        foreach (var candidate in _covers)
        {
            var score = Similarity(titleKey, candidate.Key);
            if (score >= best)
            {
                best = score;
                closest = candidate;
            }
        }

        return closest is null
            ? null
            : new ArtworkReference(closest.File, "cover-folder", "title-similar");
    }

    private IReadOnlyList<string> ImagesIn(string folder)
    {
        if (_folders.TryGetValue(folder, out var cached))
        {
            return cached;
        }

        IReadOnlyList<string> files;

        try
        {
            files = Directory
                .EnumerateFiles(folder, "*", SearchOption.TopDirectoryOnly)
                .Where(IsImage)
                .ToList();
        }
        catch (IOException)
        {
            files = Array.Empty<string>();
        }
        catch (UnauthorizedAccessException)
        {
            files = Array.Empty<string>();
        }

        _folders[folder] = files;
        return files;
    }

    private static bool IsImage(string file) =>
        ImageExtensions.Contains(Path.GetExtension(file), StringComparer.OrdinalIgnoreCase);

    private static bool IsSameFolder(string left, string right) =>
        !string.IsNullOrWhiteSpace(left)
        && !string.IsNullOrWhiteSpace(right)
        && string.Equals(
            Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Comparison key: bracketed groups, trademark marks and anything not a-z or 0-9
    /// removed, so "Ridge Racer (USA)" and "SLUS-00540" become "ridgeracer" and "slus00540".
    /// </summary>
    private static string MatchKey(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var key = new StringBuilder(value.Length);
        var depth = 0;

        foreach (var character in value)
        {
            switch (character)
            {
                case '(' or '[' or '{':
                    depth++;
                    continue;
                case ')' or ']' or '}':
                    depth = Math.Max(0, depth - 1);
                    continue;
            }

            if (depth > 0 || character is '™' or '®')
            {
                continue;
            }

            if (character is >= 'A' and <= 'Z')
            {
                key.Append((char)(character + 32));
            }
            else if (character is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                key.Append(character);
            }
        }

        return key.ToString();
    }

    /// <summary>
    /// Sørensen–Dice over character bigrams, which tolerates the dropped apostrophe in
    /// "Sorcerer[']s Stone" without treating unrelated titles as close.
    /// </summary>
    private static double Similarity(string left, string right)
    {
        if (left.Length < 2 || right.Length < 2)
        {
            return 0;
        }

        var counts = new Dictionary<string, int>(StringComparer.Ordinal);

        for (var index = 0; index < left.Length - 1; index++)
        {
            var gram = left.Substring(index, 2);
            counts[gram] = counts.GetValueOrDefault(gram) + 1;
        }

        var matches = 0;

        for (var index = 0; index < right.Length - 1; index++)
        {
            var gram = right.Substring(index, 2);
            if (counts.TryGetValue(gram, out var remaining) && remaining > 0)
            {
                counts[gram] = remaining - 1;
                matches++;
            }
        }

        return 2.0 * matches / (left.Length + right.Length - 2);
    }

    private sealed record CoverCandidate(string File, string Key);
}
