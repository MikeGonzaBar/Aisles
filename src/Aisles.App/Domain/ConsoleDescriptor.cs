namespace Aisles.App.Domain;

/// <summary>
/// One platform from <c>consoles.json</c>. Every field is user-editable, and adding a
/// platform must never require a recompile (PLAN.md section 5.1).
/// </summary>
public sealed class ConsoleDescriptor
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string ShortName { get; set; } = string.Empty;
    public string Manufacturer { get; set; } = string.Empty;
    public string Year { get; set; } = string.Empty;

    /// <summary>JewelCase | DvdCase | BluRayCase | MiniDiscCase | CartridgeCase</summary>
    public string Media { get; set; } = string.Empty;

    /// <summary>FlatFiles | CuePerFolder | FileInFolder | DiscFolders</summary>
    public string Scan { get; set; } = string.Empty;

    /// <summary>
    /// Required by <c>DiscFolders</c>: the marker file whose presence marks a disc root.
    /// Anchoring on it keeps PS3 decoy <c>PARAM.SFO</c> files from counting as games.
    /// </summary>
    public string? ScanMarker { get; set; }

    public string GamesPath { get; set; } = string.Empty;

    /// <summary>
    /// Optional folder of installed (non-disc) games. RPCS3 keeps HDD/PSN titles and disc
    /// updates under <c>dev_hdd0\game</c>; entries duplicating a disc serial are dropped.
    /// </summary>
    public string? InstalledGamesPath { get; set; }

    /// <summary>
    /// Optional folder of emulator- or user-supplied case fronts, referenced in place.
    /// PS2 points at PCSX2's serial-named covers folder; PS1 at DuckStation's title-named one.
    /// </summary>
    public string? ArtworkPath { get; set; }

    public List<string> Extensions { get; set; } = new();
    public string EmulatorPath { get; set; } = string.Empty;

    /// <summary>
    /// Optional libretro core used by multi-core frontends such as RetroArch. The launch
    /// template can reference it as <c>{core}</c>; a standalone emulator leaves this empty.
    /// </summary>
    public string? CorePath { get; set; }

    public string Arguments { get; set; } = "\"{0}\"";
    public string AccentColor { get; set; } = "#4A4F5A";
    public string BodyColor { get; set; } = "#C9CBD0";

    public bool GamesPathExists => Directory.Exists(GamesPath);
    public bool InstalledGamesPathExists =>
        !string.IsNullOrWhiteSpace(InstalledGamesPath) && Directory.Exists(InstalledGamesPath);
    public bool EmulatorExists => File.Exists(EmulatorPath);
}
