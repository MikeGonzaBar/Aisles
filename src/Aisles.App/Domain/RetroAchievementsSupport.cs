namespace Aisles.App.Domain;

/// <summary>
/// RetroAchievements coverage (PLAN.md section 3.4): not linked, unsupported, or linked
/// with progress. DS works through RetroArch's cores but not standalone DeSmuME.
/// </summary>
public static class RetroAchievementsSupport
{
    public const string NotLinkedNote = "Add account in Settings";
    public const string NotSupportedNote = "Emulator has no support";
    public const string LoadingNote = "Loading progress";
    public const string NoMatchNote = "No match";
    public const string AuthNote = "Reconnect in Settings";
    public const string UnavailableNote = "Unavailable";

    public static string StateFor(ConsoleDescriptor console) => IsSupported(console)
        ? "notLinked"
        : "notSupported";

    public static bool IsSupported(ConsoleDescriptor console) => SystemIdFor(console) is not null;

    /// <summary>
    /// The system IDs used by the RetroAchievements API. These are stable site IDs,
    /// not the console IDs in <c>consoles.json</c>.
    /// </summary>
    public static int? SystemIdFor(ConsoleDescriptor console) => console.Id.ToLowerInvariant() switch
    {
        "ps1" => 12,
        "ps2" => 21,
        "gamecube" => 16,
        "wii" => 19,
        "ds" => DsSystemId(console),
        _ => null,
    };

    private static int? DsSystemId(ConsoleDescriptor console)
    {
        if (EmulatorProfile.Detect(console.EmulatorPath) != EmulatorKind.RetroArch)
        {
            return null;
        }

        var core = Path.GetFileNameWithoutExtension(console.CorePath ?? string.Empty);

        return core.Contains("melondsds", StringComparison.OrdinalIgnoreCase)
            || core.Contains("desmume", StringComparison.OrdinalIgnoreCase)
            ? 18
            : null;
    }
}
