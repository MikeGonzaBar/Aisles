using System.Text.RegularExpressions;

namespace Aisles.App.Domain;

/// <summary>
/// Turns a raw file or folder name into something worth showing a person.
///
/// The rules come from what this library actually looks like. Folder names are
/// usually written for humans ("A bugs life", "Sim City - 2000"), while scene file
/// names carry entry numbers, region tags and release groups
/// ("3703 - X-Men Origins - Wolverine (US)(M2)(XenoPhobia)").
/// </summary>
public static class TitleNormalizer
{
    private static readonly HashSet<string> RegionTags = new(StringComparer.OrdinalIgnoreCase)
    {
        "USA", "US", "U", "Europe", "EU", "E", "Japan", "J", "Korea", "K", "Asia", "China",
        "Australia", "Germany", "France", "Spain", "Italy", "Netherlands", "Sweden",
        "Norway", "Denmark", "Finland", "Portugal", "Brazil", "Canada", "World",
        "Scandinavia", "Russia", "Poland", "Taiwan",
    };

    private static readonly Regex SceneNumber =
        new(@"^\d{3,4}\s*-\s*(?<rest>.+)$", RegexOptions.Compiled);

    private static readonly Regex TrailingTag =
        new(@"^(?<head>.*\S)\s*\((?<tag>[^()]*)\)$", RegexOptions.Compiled);

    private static readonly Regex LanguageList =
        new(@"^[A-Za-z]{2}(,[A-Za-z]{2})+$", RegexOptions.Compiled);

    private static readonly Regex RevisionTag =
        new(@"^Rev\s*[0-9A-Z]+(\.[0-9]+)?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex VersionTag =
        new(@"^v?\d+\.\d+(\.\d+)*$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex DiscTag =
        new(@"^(Disc|Disk|CD)\s*\d+", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex PatchedSuffix =
        new(@"\s*-\s*patched$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex UnderscoreBeforeSpace =
        new(@"_(\s)", RegexOptions.Compiled);

    private static readonly Regex RepeatedWhitespace =
        new(@"\s{2,}", RegexOptions.Compiled);

    public static string Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        var name = raw.Trim();

        var scene = SceneNumber.Match(name);
        if (scene.Success)
        {
            name = scene.Groups["rest"].Value.Trim();
        }

        name = PatchedSuffix.Replace(name, string.Empty);
        name = StripTrailingTags(name, scene.Success);
        name = FixSeparators(name);

        // A name made entirely of tags would normalise to nothing; showing the raw
        // name is more useful to a person than showing an empty row.
        return name.Length == 0 ? raw.Trim() : name;
    }

    /// <summary>
    /// Peels trailing bracketed groups while they are tags, and stops at the first
    /// that is not. "Disc 1" therefore survives, because collapsing a two-disc set
    /// into one shelf entry would be worse than a little extra noise.
    /// </summary>
    private static string StripTrailingTags(string name, bool sceneStyle)
    {
        var current = name;

        while (true)
        {
            var match = TrailingTag.Match(current);
            if (!match.Success || !IsTag(match.Groups["tag"].Value, sceneStyle))
            {
                return current;
            }

            var head = match.Groups["head"].Value.Trim();
            if (head.Length == 0)
            {
                return current;
            }

            current = head;
        }
    }

    private static bool IsTag(string tag, bool sceneStyle)
    {
        var value = tag.Trim();

        if (value.Length == 0)
        {
            return true;
        }

        // Checked before everything else: a disc marker is never a tag.
        if (DiscTag.IsMatch(value))
        {
            return false;
        }

        if (RegionTags.Contains(value)
            || LanguageList.IsMatch(value)
            || RevisionTag.IsMatch(value)
            || VersionTag.IsMatch(value))
        {
            return true;
        }

        // Scene releases trail dumpers and release groups: "(SQUiRE)", "(XenoPhobia)".
        // A name that began with an entry number is scene naming, so any leftover group
        // there is a group. In an ordinary name it might be part of the title.
        return sceneStyle;
    }

    private static string FixSeparators(string name)
    {
        // "Bakugan_ Battle Brawlers" uses the underscore as a subtitle break, while
        // "SAN_ANDREAS" uses it as a word separator. Only the spaced form becomes a colon.
        name = UnderscoreBeforeSpace.Replace(name, ": ");
        name = name.Replace('_', ' ');
        name = RepeatedWhitespace.Replace(name, " ");
        return name.Trim();
    }
}
