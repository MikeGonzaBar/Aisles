using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Aisles.App.Domain;

namespace Aisles.App.RetroAchievements;

/// <summary>
/// Resolves a local game by title or file name: exact normalized matches only, so an
/// ambiguous title stays unmatched. Hashing is not done (PLAN.md section 3.4).
/// </summary>
public static class RetroAchievementsGameMatcher
{
    private static readonly Regex StudioPrefix = new(
        "^(?:Disney(?:\\s*[/-]\\s*Pixar)?|DreamWorks|Nickelodeon|WWE)[\\s:]+",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex AttachedSystemSuffix = new(
        "(?<=\\S)[ _-]?(?:PS[123]|PSP|GC|N64|GBA|NDS|3DS|XBOX|360)$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex CamelBoundary = new(
        "(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex Whitespace = new(
        "\\s+",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static RetroAchievementsMatch? Find(
        GameEntry game,
        IReadOnlyList<RetroAchievementsGame> games)
    {
        if (games.Count == 0)
        {
            return null;
        }

        var candidates = new List<Candidate>();
        AddCandidate(candidates, game.Title, "title");
        AddCandidate(candidates, Path.GetFileNameWithoutExtension(game.LaunchTarget), "file name");
        AddCandidate(candidates, Path.GetFileName(game.LaunchTarget.TrimEnd('\\', '/')), "file name");

        if (candidates.Count == 0)
        {
            return null;
        }

        RetroAchievementsGame? bestGame = null;
        var bestScore = 0;
        var bestSource = string.Empty;
        var ambiguous = false;

        foreach (var raGame in games)
        {
            var ra = CompareKey(raGame.Title);
            if (ra.Normal.Length == 0)
            {
                continue;
            }

            var score = 0;
            var source = string.Empty;

            foreach (var candidate in candidates)
            {
                var candidateScore = 0;

                if (candidate.Normal == ra.Normal)
                {
                    candidateScore = candidate.Source == "title" ? 100 : 90;
                }
                else if (candidate.Compact == ra.Compact && candidate.Compact.Length >= 3)
                {
                    candidateScore = candidate.Source == "title" ? 80 : 70;
                }

                if (candidateScore > score)
                {
                    score = candidateScore;
                    source = candidate.Source;
                }
            }

            if (score == 0)
            {
                continue;
            }

            if (score > bestScore)
            {
                bestGame = raGame;
                bestScore = score;
                bestSource = source;
                ambiguous = false;
            }
            else if (score == bestScore && bestGame is not null && bestGame.Id != raGame.Id)
            {
                ambiguous = true;
            }
        }

        return ambiguous || bestGame is null
            ? null
            : new RetroAchievementsMatch(bestGame, bestSource);
    }

    private static void AddCandidate(List<Candidate> candidates, string? value, string source)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return;
        }

        var key = CompareKey(value);
        if (key.Normal.Length == 0)
        {
            return;
        }

        if (candidates.Any(candidate => candidate.Normal == key.Normal))
        {
            return;
        }

        candidates.Add(new Candidate(key.Normal, key.Compact, source));
    }

    private static (string Normal, string Compact) CompareKey(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return (string.Empty, string.Empty);
        }

        var split = CamelBoundary.Replace(value.Trim(), " ");
        var cleaned = TitleNormalizer.Normalize(split);
        cleaned = AttachedSystemSuffix.Replace(cleaned, string.Empty);
        cleaned = StudioPrefix.Replace(cleaned, string.Empty);

        var decomposed = cleaned.Normalize(NormalizationForm.FormKD);
        var builder = new StringBuilder(decomposed.Length);

        foreach (var character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            var lower = char.ToLowerInvariant(character);
            builder.Append(lower switch
            {
                '&' => " and ",
                '+' => " plus ",
                _ => char.IsLetterOrDigit(lower) ? lower.ToString() : " ",
            });
        }

        var normal = Whitespace.Replace(builder.ToString(), " ").Trim();

        if (normal.StartsWith("the ", StringComparison.Ordinal))
        {
            normal = normal[4..];
        }

        return (normal, normal.Replace(" ", string.Empty, StringComparison.Ordinal));
    }

    private sealed record Candidate(string Normal, string Compact, string Source);
}
