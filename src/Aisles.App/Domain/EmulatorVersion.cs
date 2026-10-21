using System.Text.RegularExpressions;

namespace Aisles.App.Domain;

/// <summary>
/// Small, deliberately boring version parsers. Every emulator names its releases
/// differently, so the comparison rules live here rather than in the updater service
/// where they would be hard to test.
/// </summary>
public static partial class EmulatorVersion
{
    /// <summary>Parses a dotted version such as <c>v2.9.131</c> or <c>0.9.13</c>.</summary>
    public static Version? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var match = DottedVersion().Match(text);

        return match.Success && Version.TryParse(match.Value, out var version)
            ? Normalise(version)
            : null;
    }

    /// <summary>Handles tags such as <c>release_0_9_13</c> as well as dotted versions.</summary>
    public static Version? ParseFlexible(string? text)
    {
        if (Parse(text) is { } dotted)
        {
            return dotted;
        }

        var match = UnderscoreVersion().Match(text ?? string.Empty);

        if (!match.Success
            || !int.TryParse(match.Groups[1].Value, out var major)
            || !int.TryParse(match.Groups[2].Value, out var minor)
            || !int.TryParse(match.Groups[3].Value, out var build))
        {
            return null;
        }

        return new Version(major, minor, build);
    }

    /// <summary>Compares two normalised versions; a missing component counts as zero.</summary>
    public static int Compare(Version left, Version right) => Normalise(left).CompareTo(Normalise(right));

    /// <summary>
    /// DuckStation has both <c>0.1.12083</c> file versions and <c>v0.1-11894</c>
    /// release tags. The build number is the only comparable part.
    /// </summary>
    public static int? ParseDuckStationBuild(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var tagged = DuckStationTag().Match(text);

        if (tagged.Success && int.TryParse(tagged.Groups[1].Value, out var taggedBuild))
        {
            return taggedBuild;
        }

        var file = DottedVersion().Match(text);

        return file.Success && Version.TryParse(file.Value, out var version) && version.Build >= 0
            ? version.Build
            : null;
    }

    /// <summary>
    /// Dolphin releases are named <c>2609</c>, <c>2609a</c> and so on. The suffix is
    /// a second release within the same month, not a pre-release marker.
    /// </summary>
    public static (int Number, char Suffix)? ParseDolphin(string? text)
    {
        var match = DolphinTag().Match(text ?? string.Empty);

        return match.Success && int.TryParse(match.Groups[1].Value, out var number)
            ? (number, match.Groups[2].Value.Length == 0 ? '\0' : char.ToLowerInvariant(match.Groups[2].Value[0]))
            : null;
    }

    public static int CompareDolphin((int Number, char Suffix) left, (int Number, char Suffix) right)
    {
        var byNumber = left.Number.CompareTo(right.Number);
        return byNumber != 0 ? byNumber : left.Suffix.CompareTo(right.Suffix);
    }

    /// <summary>Extracts <c>0.0.43-20355</c> from RPCS3's <c>--version</c> output.</summary>
    public static string? ParseRpcs3(string? output)
    {
        var match = Rpcs3Version().Match(output ?? string.Empty);
        return match.Success ? match.Groups[1].Value : null;
    }

    /// <summary>Extracts <c>2609a</c> from Dolphin's <c>--version</c> output.</summary>
    public static string? ParseDolphinOutput(string? output)
    {
        var match = DolphinOutput().Match(output ?? string.Empty);
        return match.Success ? match.Groups[1].Value : null;
    }

    /// <summary>Finds a dotted version in a portable executable name.</summary>
    public static string? FromFileName(string? path)
    {
        var match = DottedVersion().Match(Path.GetFileNameWithoutExtension(path) ?? string.Empty);
        return match.Success ? match.Value : null;
    }

    private static Version Normalise(Version version) => new(
        Math.Max(version.Major, 0),
        Math.Max(version.Minor, 0),
        Math.Max(version.Build, 0),
        Math.Max(version.Revision, 0));

    [GeneratedRegex(@"\d+(?:\.\d+){1,3}")]
    private static partial Regex DottedVersion();

    [GeneratedRegex(@"(\d+)_(\d+)_(\d+)")]
    private static partial Regex UnderscoreVersion();

    [GeneratedRegex(@"(?:^|v)\d+\.\d+-(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex DuckStationTag();

    [GeneratedRegex(@"(?:^|\b)(\d{4})([a-z]?)\b", RegexOptions.IgnoreCase)]
    private static partial Regex DolphinTag();

    [GeneratedRegex(@"RPCS3\s+(\d+\.\d+\.\d+(?:-\d+)?)", RegexOptions.IgnoreCase)]
    private static partial Regex Rpcs3Version();

    [GeneratedRegex(@"Dolphin\s+(\d{4}[a-z]?)", RegexOptions.IgnoreCase)]
    private static partial Regex DolphinOutput();
}
