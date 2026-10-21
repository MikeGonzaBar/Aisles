using System.Globalization;
using System.Net;
using System.Text.Json;
using Aisles.App.Domain;

namespace Aisles.App.RetroAchievements;

/// <summary>
/// Small RetroAchievements Web API client. Requests are serialized and spaced out by
/// <see cref="MinimumInterval"/>; static system game lists are cached on disk because
/// the official API documentation explicitly asks callers to cache that endpoint.
/// The API key is never written to logs or exception messages.
/// </summary>
public sealed class RetroAchievementsClient
{
    public const string ApiBase = "https://retroachievements.org/API/";
    public const string BadgeBase = "https://media.retroachievements.org/Badge/";
    public static readonly TimeSpan GameListCacheLifetime = TimeSpan.FromDays(7);
    public static readonly TimeSpan MinimumInterval = TimeSpan.FromMilliseconds(350);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    // The gate is process-wide because a settings test and a selected game can use
    // different clients. They still share RetroAchievements' rate limit.
    private static readonly SemaphoreSlim RequestGate = new(1, 1);
    private static DateTimeOffset _lastRequest = DateTimeOffset.MinValue;

    private readonly HttpClient _http;
    private readonly string _cacheRoot;
    private readonly RetroAchievementsSettings _settings;
    private readonly TimeSpan _requestInterval;

    public RetroAchievementsClient(
        HttpClient http,
        string cacheRoot,
        RetroAchievementsSettings settings,
        TimeSpan? requestInterval = null)
    {
        _http = http;
        _cacheRoot = cacheRoot;
        _settings = settings;
        _requestInterval = requestInterval ?? MinimumInterval;
    }

    public async Task<RetroAchievementsAccount> GetAccountAsync(CancellationToken cancellationToken)
    {
        EnsureCredentials();
        var json = await RequestJsonAsync(
            "API_GetUserProfile.php",
            cancellationToken,
            ("u", _settings.Username)).ConfigureAwait(false);

        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("User", out var userElement)
            || userElement.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(userElement.GetString()))
        {
            throw new RetroAchievementsException(
                "RetroAchievements could not find that account. Check the username and web API key.",
                isAuthFailure: true);
        }

        return new RetroAchievementsAccount(
            userElement.GetString()!,
            StringProperty(root, "ULID"),
            IntProperty(root, "TotalPoints"),
            IntProperty(root, "TotalSoftcorePoints"));
    }

    public async Task<IReadOnlyList<RetroAchievementsGame>> GetGameListAsync(
        int systemId,
        CancellationToken cancellationToken)
    {
        EnsureCredentials();

        var cachePath = Path.Combine(_cacheRoot, $"games-{systemId}.json");
        var cached = ReadGameListCache(cachePath);
        var now = DateTimeOffset.UtcNow;

        if (cached is not null)
        {
            var age = now - cached.FetchedAt;
            if (age >= TimeSpan.Zero && age < GameListCacheLifetime)
            {
                return cached.Games;
            }
        }

        try
        {
            var json = await RequestJsonAsync(
                "API_GetGameList.php",
                cancellationToken,
                ("i", systemId.ToString(System.Globalization.CultureInfo.InvariantCulture)),
                ("f", "1"),
                ("h", "0")).ConfigureAwait(false);

            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;

            if (root.ValueKind != JsonValueKind.Array)
            {
                throw new RetroAchievementsException("RetroAchievements returned no game list for this system.");
            }

            var games = new List<RetroAchievementsGame>();
            foreach (var item in root.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                var id = IntProperty(item, "ID");
                var title = StringProperty(item, "Title");
                var achievements = IntProperty(item, "NumAchievements");

                if (id <= 0 || string.IsNullOrWhiteSpace(title) || achievements <= 0)
                {
                    continue;
                }

                games.Add(new RetroAchievementsGame(id, title, achievements, IntProperty(item, "Points")));
            }

            if (games.Count == 0)
            {
                throw new RetroAchievementsException("RetroAchievements returned no games for this system.");
            }

            WriteGameListCache(cachePath, new GameListCache(1, now, games.ToList()));
            return games;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (RetroAchievementsException ex) when (ex.IsAuthFailure)
        {
            throw;
        }
        catch (Exception ex) when (cached is not null
            && ex is RetroAchievementsException or JsonException)
        {
            // A stale list is still useful and the documentation asks us to be
            // conservative with this endpoint. Authentication failures must surface.
            return cached.Games;
        }
    }

    public async Task<RetroAchievementsProgress> GetProgressAsync(
        int gameId,
        CancellationToken cancellationToken)
    {
        EnsureCredentials();

        var json = await RequestJsonAsync(
            "API_GetGameInfoAndUserProgress.php",
            cancellationToken,
            ("g", gameId.ToString(System.Globalization.CultureInfo.InvariantCulture)),
            ("u", _settings.Username)).ConfigureAwait(false);

        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("NumAchievements", out _))
        {
            throw new RetroAchievementsException("RetroAchievements could not find that game for this account.");
        }

        var total = IntProperty(root, "NumAchievements");
        var earned = Math.Clamp(IntProperty(root, "NumAwardedToUser"), 0, total);
        var points = 0;
        var achievementDetails = new List<RetroAchievementsAchievement>();

        if (root.TryGetProperty("Achievements", out var achievements)
            && achievements.ValueKind == JsonValueKind.Object)
        {
            foreach (var achievement in achievements.EnumerateObject())
            {
                var value = achievement.Value;
                if (value.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                var title = StringProperty(value, "Title");
                if (string.IsNullOrWhiteSpace(title))
                {
                    continue;
                }

                var id = IntProperty(value, "ID");
                if (id <= 0
                    && int.TryParse(
                        achievement.Name,
                        NumberStyles.Integer,
                        CultureInfo.InvariantCulture,
                        out var keyedId))
                {
                    id = keyedId;
                }

                var earnedAt = DateProperty(value, "DateEarnedHardcore")
                    ?? DateProperty(value, "DateEarned");
                var achievementPoints = IntProperty(value, "Points");

                if (earnedAt is not null)
                {
                    points += achievementPoints;
                }

                achievementDetails.Add(new RetroAchievementsAchievement(
                    id,
                    title,
                    StringProperty(value, "Description"),
                    achievementPoints,
                    BadgeUrl(StringProperty(value, "BadgeName"), earnedAt is not null),
                    IntProperty(value, "DisplayOrder"),
                    earnedAt));
            }
        }

        return new RetroAchievementsProgress(gameId, earned, total, points, achievementDetails);
    }

    private async Task<string> RequestJsonAsync(
        string endpoint,
        CancellationToken cancellationToken,
        params (string Name, string Value)[] parameters)
    {
        EnsureCredentials();

        var query = string.Join(
            "&",
            new[]
            {
                ("y", _settings.ApiKey),
                ("z", _settings.Username),
            }.Concat(parameters).Select(pair =>
                $"{Uri.EscapeDataString(pair.Item1)}={Uri.EscapeDataString(pair.Item2)}"));

        var url = ApiBase + endpoint + "?" + query;

        try
        {
            using var response = await SendAsync(url, cancellationToken).ConfigureAwait(false);
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                throw response.StatusCode switch
                {
                    HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden =>
                        new RetroAchievementsException(
                            "RetroAchievements rejected the saved username or web API key.",
                            isAuthFailure: true),
                    HttpStatusCode.TooManyRequests =>
                        new RetroAchievementsException("RetroAchievements is rate limiting requests. Try again shortly."),
                    _ when (int)response.StatusCode >= 500 =>
                        new RetroAchievementsException("RetroAchievements is unavailable right now."),
                    _ => new RetroAchievementsException(
                        $"RetroAchievements returned HTTP {(int)response.StatusCode}."),
                };
            }

            ThrowIfApiError(body);
            return body;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new RetroAchievementsException("RetroAchievements did not respond in time.");
        }
        catch (HttpRequestException ex)
        {
            throw new RetroAchievementsException(
                "Could not reach RetroAchievements. Check your connection and try again.",
                inner: ex);
        }
    }

    private async Task<HttpResponseMessage> SendAsync(string url, CancellationToken cancellationToken)
    {
        await RequestGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_requestInterval > TimeSpan.Zero)
            {
                var elapsed = DateTimeOffset.UtcNow - _lastRequest;
                if (elapsed < _requestInterval)
                {
                    await Task.Delay(_requestInterval - elapsed, cancellationToken).ConfigureAwait(false);
                }
            }

            _lastRequest = DateTimeOffset.UtcNow;
            return await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
                .ConfigureAwait(false);
        }
        finally
        {
            RequestGate.Release();
        }
    }

    private static void ThrowIfApiError(string body)
    {
        if (string.IsNullOrWhiteSpace(body) || body.TrimStart().StartsWith('['))
        {
            return;
        }

        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("Error", out var error)
                || error.ValueKind != JsonValueKind.String)
            {
                return;
            }

            var message = error.GetString() ?? "RetroAchievements returned an error.";
            var lower = message.ToLowerInvariant();
            var userProblem = lower.Contains("user")
                && (lower.Contains("invalid")
                    || lower.Contains("not found")
                    || lower.Contains("unknown")
                    || lower.Contains("incorrect"));
            var auth = lower.Contains("key")
                || lower.Contains("credential")
                || lower.Contains("password")
                || userProblem;

            throw new RetroAchievementsException(message, isAuthFailure: auth);
        }
        catch (JsonException)
        {
            // Let the caller's specific parser report the unexpected shape.
        }
    }

    private static string? StringProperty(JsonElement element, string name) =>
        element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static int IntProperty(JsonElement element, string name) =>
        element.TryGetProperty(name, out var property) && property.TryGetInt32(out var value)
            ? value
            : 0;

    private static DateTime? DateProperty(JsonElement element, string name)
    {
        var text = StringProperty(element, name);
        return !string.IsNullOrWhiteSpace(text)
            && DateTime.TryParse(
                text,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces,
                out var value)
                ? value
                : null;
    }

    /// <summary>
    /// RetroAchievements returns a badge name rather than a URL. Locked achievements
    /// have a separate greyscale asset, so the rail can show what is still ahead
    /// without pretending it was earned.
    /// </summary>
    private static string? BadgeUrl(string? badgeName, bool earned)
    {
        if (string.IsNullOrWhiteSpace(badgeName))
        {
            return null;
        }

        var name = badgeName.Trim();
        if (name.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
        {
            name = name[..^4];
        }

        if (name.Length == 0
            || !name.All(character =>
                char.IsLetterOrDigit(character) || character is '-' or '_'))
        {
            return null;
        }

        return BadgeBase
            + Uri.EscapeDataString(name)
            + (earned ? ".png" : "_lock.png");
    }

    private void EnsureCredentials()
    {
        if (!_settings.HasCredentials)
        {
            throw new RetroAchievementsException(
                "Enter your RetroAchievements username and web API key in Settings.");
        }
    }

    private GameListCache? ReadGameListCache(string path)
    {
        try
        {
            if (!File.Exists(path))
            {
                return null;
            }

            var cache = JsonSerializer.Deserialize<GameListCache>(File.ReadAllText(path), JsonOptions);
            return cache is { CacheVersion: 1, Games.Count: > 0 } ? cache : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    private void WriteGameListCache(string path, GameListCache cache)
    {
        try
        {
            Directory.CreateDirectory(_cacheRoot);
            var temporary = path + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(cache, JsonOptions));
            File.Move(temporary, path, true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // The cache is an optimization; a read-only profile must not break the rail.
        }
    }

    private sealed record GameListCache(
        int CacheVersion,
        DateTimeOffset FetchedAt,
        List<RetroAchievementsGame> Games);
}
