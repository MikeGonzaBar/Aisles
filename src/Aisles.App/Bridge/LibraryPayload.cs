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
    IReadOnlyList<GamePayload> Games);

public sealed record GamePayload(
    string Id,
    string Title,
    string LaunchTarget,
    string? Serial,
    string? TitleSource);
