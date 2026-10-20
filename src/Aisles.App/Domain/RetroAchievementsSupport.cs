namespace Aisles.App.Domain;

/// <summary>
/// RetroAchievements coverage, as confirmed in PLAN.md section 3.4. The rail ships
/// three states from the start: supported but not linked, not supported on this
/// platform, and linked with progress. Phase 6 supplies the link; until then a
/// supported platform renders as <c>notLinked</c> and an unsupported one as
/// <c>notSupported</c>, so the row never collapses.
/// </summary>
public static class RetroAchievementsSupport
{
    public static string StateFor(string? consoleId) => IsSupported(consoleId)
        ? "notLinked"
        : "notSupported";

    public static bool IsSupported(string? consoleId) => consoleId?.ToLowerInvariant() switch
    {
        "ps1" or "ps2" or "gamecube" or "wii" => true,
        _ => false,
    };
}
