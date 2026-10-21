namespace Aisles.App.Bridge;

/// <summary>
/// The <c>library</c> payload. Serialised camelCase, so these property names are
/// the web layer's field names.
/// </summary>
public sealed record LibraryPayload(string? Error, IReadOnlyList<ConsolePayload> Consoles);

public sealed record ConsolePayload(
    string Id,
    string Name,
    string ShortName,
    string Manufacturer,
    string Year,
    string Media,
    string AccentColor,
    string BodyColor,
    string GamesPath,
    bool GamesPathExists,
    bool EmulatorExists,
    string EmulatorName,
    IReadOnlyList<GamePayload> Games);

public sealed record GamePayload(
    string Id,
    string Title,
    string LaunchTarget,
    string? Serial,
    string? Version,
    string? IdentityId,
    string? Region,
    string? TitleSource,
    string? FrontCoverUrl,
    string? FrontCoverMatch,
    string? FrontCoverSource,
    string? MediumLabelUrl,
    string? MediumLabelMatch,
    string? MediumLabelSource,
    double[]? MediumLabelRect,
    PlayedPayload Played,
    AchievementsPayload Achievements);

/// <summary>
/// The PLAYED row. A null <see cref="Seconds"/> means no value is available, and
/// <see cref="Reason"/> is the sentence the rail shows in place of a fabricated zero.
/// </summary>
public sealed record PlayedPayload(long? Seconds, string? LastPlayed, string? Source, string? Reason);

/// <summary>
/// The ACHIEVEMENTS row. <see cref="State"/> is <c>notLinked</c>, <c>notSupported</c>
/// or <c>linked</c>; the last carries earned/total/points when a game match and
/// progress are available, and leaves them null while the rail is still resolving.
/// </summary>
public sealed record AchievementsPayload(string State, int? Earned, int? Total, int? Points, string? Note);
