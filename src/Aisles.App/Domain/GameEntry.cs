namespace Aisles.App.Domain;

/// <summary>One game, as discovered on disk.</summary>
public sealed record GameEntry
{
    public required string Id { get; init; }
    public required string ConsoleId { get; init; }
    public required string Title { get; init; }

    /// <summary>What gets substituted into the console's <c>{0}</c> argument template.</summary>
    public required string LaunchTarget { get; init; }

    /// <summary>Disc serial or ROM ID, once the Phase 1 metadata adapters supply it.</summary>
    public string? Serial { get; init; }

    public string? Region { get; init; }
}
