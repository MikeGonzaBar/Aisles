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
    bool RequiresCore,
    bool CoreReady,
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
/// One badge in the achievements strip. <see cref="EarnedOn"/> is set only for an
/// unlock; <see cref="BadgeUrl"/> points at the provider's badge or trophy image.
/// </summary>
public sealed record AchievementBadgePayload(
    int Id,
    string Title,
    string? Description,
    int Points,
    string? BadgeUrl,
    string? EarnedOn);

/// <summary>
/// The ACHIEVEMENTS row. <see cref="State"/> is <c>notLinked</c>, <c>notSupported</c>,
/// <c>linked</c>, <c>local</c> or <c>noTrophies</c>; <c>linked</c> and <c>local</c>
/// carry earned/total when progress is available, and leave them null while the rail
/// is still resolving. <see cref="Source"/> names the provider (<c>retroachievements</c>
/// or <c>rpcs3</c>) and <see cref="Unit"/> names what is counted, because PS3 trophies
/// are not RetroAchievements achievements or points. <see cref="Recent"/> and
/// <see cref="Pending"/> hold a short, honest sample of per-achievement badges.
/// </summary>
public sealed record AchievementsPayload(
    string State,
    int? Earned,
    int? Total,
    int? Points,
    string? Note,
    IReadOnlyList<AchievementBadgePayload>? Recent = null,
    IReadOnlyList<AchievementBadgePayload>? Pending = null,
    string? Source = null,
    string? Unit = null);
