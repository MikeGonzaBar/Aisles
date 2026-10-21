namespace Aisles.App.Domain;

/// <summary>
/// The RetroAchievements account Aisles reads progress for. The web API key is a
/// secret; it is stored only in the user's application-data folder and is never
/// written into the repository or sent back to the web layer.
/// </summary>
public sealed record RetroAchievementsSettings(string Username, string ApiKey)
{
    public static RetroAchievementsSettings Empty { get; } = new(string.Empty, string.Empty);

    public bool HasUsername => !string.IsNullOrWhiteSpace(Username);

    public bool HasApiKey => !string.IsNullOrWhiteSpace(ApiKey);

    public bool HasCredentials => HasUsername && HasApiKey;
}
