using System.Text;

namespace Aisles.App.Domain;

/// <summary>
/// Finds artwork that is already on this machine, without a network service
/// (PLAN.md section 3.3.1, precedence step 2).
///
/// Two shapes exist in the real libraries this was built against:
///
/// * A <b>cover folder</b> supplied by the emulator. PCSX2 keeps
///   <c>covers\SLUS-20946.jpg</c> next to the emulator, keyed by serial; DuckStation
///   keeps <c>Documents\DuckStation\covers\Ridge Racer (USA).jpg</c>, keyed by title.
/// * A <b>sidecar</b> beside the game. The DS set uses
///   <c>2269 - Cover.png</c> inside the game's own folder.
///
/// The folder is named in <c>consoles.json</c> rather than hard-coded, because the
/// catalog is user-editable and adding a platform must not need a recompile.
///
/// This resolves case fronts only. Disc and cartridge labels are separate slots and
/// are not inferred from a cover (PLAN.md section 3.3.1).
/// </summary>
public sealed class ArtworkLookup
{
    private static readonly string[] ImageExtensions = [".png", ".jpg", ".jpeg", ".webp"];

    /// <summary>
    /// How close two normalized titles must be before a fuzzy match is accepted.
    /// High enough that different editions of a game stay apart; the only case it
    /// exists for in this library is "Sorcerer Stone" versus "Sorcerer's Stone".
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
    /// Indexes the console's cover folder once. The scanner builds one of these per
    /// console scan, so every game in the console reuses the same file list.
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
    /// A cover stored beside the game wins over a shared folder: it was put there
    /// for this game. Names are accepted in two tiers, because a flat library shares
    /// one folder between every game and a loose "*- Cover.png" there could belong to
    /// a neighbour.
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
    /// Serial first: it survives differently spelled titles. Title rules follow, from
    /// strictest to loosest, and the loosest one is capped by <see cref="SimilarTitleFloor"/>.
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
    /// The comparison key for a title or serial: bracketed groups, trademark marks and
    /// everything that is not a-z or 0-9 removed. That turns
    /// "Ridge Racer (USA)" and "SLUS-00540" into "ridgeracer" and "slus00540",
    /// matching the workshop rules this was ported from.
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
    /// Sørensen–Dice over character bigrams. Chosen over edit distance because it
    /// tolerates the dropped apostrophe and doubled letter in
    /// "Harry Potter and the Sorcerer[']s Stone" without treating unrelated titles as
    /// close: short keys are excluded by the caller's floor.
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
