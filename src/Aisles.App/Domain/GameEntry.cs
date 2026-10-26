namespace Aisles.App.Domain;

/// <summary>One game, as discovered on disk.</summary>
public sealed record GameEntry
{
    public required string Id { get; init; }
    public required string ConsoleId { get; init; }
    public required string Title { get; init; }

    /// <summary>What gets substituted into the console's <c>{0}</c> argument template.</summary>
    public required string LaunchTarget { get; init; }

    /// <summary>
    /// Disc serial or ROM game code, when the platform records one: "SLUS-20946" for a
    /// PS2 disc, "BCUS98148" for a PS3 title, "YIMP" for a DS cartridge.
    /// </summary>
    public string? Serial { get; init; }

    /// <summary>
    /// The installed version the emulator would report, when the platform records one:
    /// PS3 <c>APP_VER</c> ("01.33"). Null for platforms with no version metadata.
    /// </summary>
    public string? Version { get; init; }

    /// <summary>
    /// Which rule produced <see cref="Title"/>. Titles come from names and emulator caches,
    /// so provenance keeps the heuristics auditable.
    /// </summary>
    public string? TitleSource { get; init; }

    /// <summary>
    /// A case front found on this machine, when one is suitable. Disc and cartridge
    /// labels are independent slots and are not implied by this.
    /// </summary>
    public ArtworkReference? FrontCover { get; init; }
}
