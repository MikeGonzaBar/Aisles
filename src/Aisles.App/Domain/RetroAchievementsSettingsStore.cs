using System.Text.Json;

namespace Aisles.App.Domain;

/// <summary>
/// Stores the RetroAchievements username and web API key beside the console settings,
/// under <c>%LOCALAPPDATA%\Aisles</c>. Nothing here reads from or writes to the
/// repository, and an empty account removes the file rather than leaving a stale key
/// behind.
/// </summary>
public sealed class RetroAchievementsSettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public RetroAchievementsSettingsStore(string path) => Path = path;

    public string Path { get; }

    public (RetroAchievementsSettings Settings, string? Error) Load()
    {
        if (!File.Exists(Path))
        {
            return (RetroAchievementsSettings.Empty, null);
        }

        try
        {
            var file = JsonSerializer.Deserialize<SettingsFile>(File.ReadAllText(Path), JsonOptions)
                ?? throw new InvalidDataException("RetroAchievements settings file was empty.");

            if (file.SchemaVersion != 1)
            {
                throw new InvalidDataException($"Unsupported RetroAchievements settings schema {file.SchemaVersion}.");
            }

            return (new RetroAchievementsSettings(
                (file.Username ?? string.Empty).Trim(),
                (file.ApiKey ?? string.Empty).Trim()), null);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or InvalidDataException)
        {
            return (RetroAchievementsSettings.Empty, $"Could not read saved RetroAchievements settings: {ex.Message}");
        }
    }

    public void Save(RetroAchievementsSettings settings)
    {
        var username = (settings.Username ?? string.Empty).Trim();
        var apiKey = (settings.ApiKey ?? string.Empty).Trim();

        if (username.Length == 0 || apiKey.Length == 0)
        {
            Delete();
            return;
        }

        var directory = System.IO.Path.GetDirectoryName(Path)!;
        Directory.CreateDirectory(directory);

        var file = new SettingsFile
        {
            SchemaVersion = 1,
            Username = username,
            ApiKey = apiKey,
        };

        var temporary = Path + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(file, JsonOptions));
            File.Move(temporary, Path, true);
        }
        catch
        {
            try { File.Delete(temporary); } catch { }
            throw;
        }
    }

    private void Delete()
    {
        try
        {
            if (File.Exists(Path))
            {
                File.Delete(Path);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new IOException($"Could not remove saved RetroAchievements settings: {ex.Message}", ex);
        }
    }

    private sealed class SettingsFile
    {
        public int SchemaVersion { get; set; } = 1;
        public string? Username { get; set; }
        public string? ApiKey { get; set; }
    }
}
