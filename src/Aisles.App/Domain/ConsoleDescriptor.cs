namespace Aisles.App.Domain;

/// <summary>
/// One platform, as described by <c>consoles.json</c>. Every field here is
/// user-editable and adding a platform must never require a recompile
/// (PLAN.md section 5.1).
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
    /// Required by <c>DiscFolders</c> only: the file whose presence marks a disc
    /// root. Anchoring on this is what keeps the PS3 decoy <c>PARAM.SFO</c> files
    /// (PLAN.md section 3.1) from being counted as games.
    /// </summary>
    public string? ScanMarker { get; set; }

    public string GamesPath { get; set; } = string.Empty;

    /// <summary>
    /// Optional folder of case fronts supplied by the emulator or the user. PS2
    /// points at PCSX2's serial-named <c>covers</c> folder; PS1 points at
    /// DuckStation's title-named one. Files are referenced in place.
    /// </summary>
    public string? ArtworkPath { get; set; }

    public List<string> Extensions { get; set; } = new();
    public string EmulatorPath { get; set; } = string.Empty;
    public string Arguments { get; set; } = "\"{0}\"";
    public string AccentColor { get; set; } = "#4A4F5A";
    public string BodyColor { get; set; } = "#C9CBD0";

    public bool GamesPathExists => Directory.Exists(GamesPath);
    public bool EmulatorExists => File.Exists(EmulatorPath);
}
