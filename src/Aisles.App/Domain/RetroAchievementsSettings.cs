namespace Aisles.App.Domain;

/// <summary>
/// The RetroAchievements account Aisles reads progress for. The web API key is a secret,
/// stored only in application data and never sent back to the web layer.
/// </summary>
public sealed record RetroAchievementsSettings(string Username, string ApiKey)
{
    public static RetroAchievementsSettings Empty { get; } = new(string.Empty, string.Empty);

    public bool HasUsername => !string.IsNullOrWhiteSpace(Username);

    public bool HasApiKey => !string.IsNullOrWhiteSpace(ApiKey);

    public bool HasCredentials => HasUsername && HasApiKey;
}
