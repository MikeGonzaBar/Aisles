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
    /// Which rule produced <see cref="Title"/>. Titles are derived from names and
    /// emulator caches rather than a catalogue, so keeping the provenance makes the
    /// heuristics auditable instead of mysterious.
    /// </summary>
    public string? TitleSource { get; init; }
}
