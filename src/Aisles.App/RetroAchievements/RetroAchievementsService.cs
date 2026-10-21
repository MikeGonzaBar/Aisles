using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Headers;
using Aisles.App.Bridge;
using Aisles.App.Domain;

namespace Aisles.App.RetroAchievements;

/// <summary>
/// Owns the linked account, the per-system game caches and the short-lived progress
/// cache. The library payload is built without waiting on the network; selecting a
/// game refreshes only that game's progress. A rejected key flips the rail back to
/// "not linked" so it never claims progress from a different account.
/// </summary>
public sealed class RetroAchievementsService : IDisposable
{
    private static readonly TimeSpan ProgressLifetime = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan MatchLifetime = TimeSpan.FromMinutes(30);

    private readonly string _cacheRoot;
    private readonly HttpClient _http;
    private readonly TimeSpan? _requestInterval;
    private readonly bool _ownsHttp;
    private readonly object _gate = new();
    private readonly Dictionary<int, Task<IReadOnlyList<RetroAchievementsGame>>> _gameListTasks = new();
    private readonly ConcurrentDictionary<string, CachedMatch> _matches = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, CachedProgress> _progress = new(StringComparer.Ordinal);

    private RetroAchievementsSettings _settings = RetroAchievementsSettings.Empty;
    private RetroAchievementsClient? _client;
    private RetroAchievementsAccount? _account;
    private bool _authRejected;
    private int _configurationVersion;
    private bool _disposed;

    public RetroAchievementsService(
        string cacheRoot,
        HttpClient? http = null,
        TimeSpan? requestInterval = null)
    {
        _cacheRoot = cacheRoot;
        _requestInterval = requestInterval;
        _ownsHttp = http is null;
        _http = http ?? CreateHttpClient();
    }

    public RetroAchievementsSettings Settings => _settings;

    public bool HasCredentials => _settings.HasCredentials;

    public bool IsAuthRejected => _authRejected;

    public RetroAchievementsAccount? CachedAccount => _account;

    public void Configure(RetroAchievementsSettings settings)
    {
        lock (_gate)
        {
            if (_settings == settings)
            {
                return;
            }

            _settings = settings;
            _client = settings.HasCredentials
                ? new RetroAchievementsClient(_http, _cacheRoot, settings, _requestInterval)
                : null;
            _authRejected = false;
            _account = null;
            _configurationVersion++;
            _gameListTasks.Clear();
            _matches.Clear();
            _progress.Clear();
        }
    }

    /// <summary>
    /// Produces the achievements row for a library payload. It never starts a network
    /// request: cached progress is used when available, otherwise the row says that
    /// progress will load when the game is selected.
    /// </summary>
    public AchievementsPayload ForLibrary(ConsoleDescriptor console, GameEntry game)
    {
        if (!RetroAchievementsSupport.IsSupported(console))
        {
            return new AchievementsPayload(
                "notSupported", null, null, null, RetroAchievementsSupport.NotSupportedNote);
        }

        if (!_settings.HasCredentials)
        {
            return new AchievementsPayload(
                "notLinked", null, null, null, RetroAchievementsSupport.NotLinkedNote);
        }

        if (_authRejected)
        {
            return new AchievementsPayload(
                "notLinked", null, null, null, RetroAchievementsSupport.AuthNote);
        }

        if (_progress.TryGetValue(game.Id, out var progress))
        {
            return progress.Payload;
        }

        var note = _matches.TryGetValue(game.Id, out var match)
            && DateTimeOffset.UtcNow - match.FetchedAt < MatchLifetime
            && match.Match is null
                ? RetroAchievementsSupport.NoMatchNote
                : RetroAchievementsSupport.LoadingNote;

        return new AchievementsPayload("linked", null, null, null, note);
    }

    public async Task<AchievementsPayload> GetForGameAsync(
        ConsoleDescriptor console,
        GameEntry game,
        CancellationToken cancellationToken)
    {
        if (!RetroAchievementsSupport.IsSupported(console)
            || !_settings.HasCredentials)
        {
            return ForLibrary(console, game);
        }

        if (_authRejected)
        {
            return new AchievementsPayload(
                "notLinked", null, null, null, RetroAchievementsSupport.AuthNote);
        }

        if (_progress.TryGetValue(game.Id, out var cached)
            && DateTimeOffset.UtcNow - cached.FetchedAt < ProgressLifetime)
        {
            return cached.Payload;
        }

        var (client, version) = AccountSnapshot();
        if (client is null)
        {
            return ForLibrary(console, game);
        }

        try
        {
            var match = await ResolveMatchAsync(client, console, game, cancellationToken)
                .ConfigureAwait(false);

            if (version != ConfigurationVersion)
            {
                return ForLibrary(console, game);
            }

            if (match is null)
            {
                var unmatched = new AchievementsPayload(
                    "linked", null, null, null, RetroAchievementsSupport.NoMatchNote);
                return CacheMatch(game.Id, null, version) ? unmatched : ForLibrary(console, game);
            }

            var progress = await client.GetProgressAsync(match.Game.Id, cancellationToken)
                .ConfigureAwait(false);

            var payload = new AchievementsPayload(
                "linked",
                progress.Earned,
                progress.Total,
                progress.Points,
                null,
                RecentBadges(progress.Achievements),
                PendingBadges(progress.Achievements));

            return CacheProgress(game.Id, payload, version)
                ? payload
                : ForLibrary(console, game);
        }
        catch (RetroAchievementsException ex) when (ex.IsAuthFailure)
        {
            if (RejectAccount(version, game.Id))
            {
                Debug.WriteLine("RetroAchievements rejected the saved credentials.");
            }

            return ForLibrary(console, game);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (RetroAchievementsException ex)
        {
            Debug.WriteLine($"RetroAchievements progress for {game.Id} failed ({ex.GetType().Name}).");
            return version == ConfigurationVersion
                ? new AchievementsPayload(
                    "linked", null, null, null, RetroAchievementsSupport.UnavailableNote)
                : ForLibrary(console, game);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"RetroAchievements progress for {game.Id} failed ({ex.GetType().Name}).");
            return version == ConfigurationVersion
                ? new AchievementsPayload(
                    "linked", null, null, null, RetroAchievementsSupport.UnavailableNote)
                : ForLibrary(console, game);
        }
    }

    public async Task<RetroAchievementsAccount> TestAccountAsync(
        RetroAchievementsSettings settings,
        CancellationToken cancellationToken)
    {
        if (!settings.HasCredentials)
        {
            throw new RetroAchievementsException(
                "Enter your RetroAchievements username and web API key.");
        }

        var client = new RetroAchievementsClient(_http, _cacheRoot, settings, _requestInterval);
        var version = ConfigurationVersion;

        try
        {
            var account = await client.GetAccountAsync(cancellationToken).ConfigureAwait(false);

            if (settings == _settings)
            {
                CacheAccount(account, version);
            }

            return account;
        }
        catch (RetroAchievementsException ex) when (ex.IsAuthFailure)
        {
            if (settings == _settings)
            {
                RejectAccount(version);
            }

            throw;
        }
    }

    /// <summary>
    /// The rail has room for a small sample, not the whole achievement list. Recent
    /// unlocks are newest first; pending achievements follow the game's own display
    /// order, which is the only ordering the API exposes without inventing a
    /// "closest to earning" score.
    /// </summary>
    private static IReadOnlyList<AchievementBadgePayload>? RecentBadges(
        IReadOnlyList<RetroAchievementsAchievement> achievements)
    {
        var badges = achievements
            .Where(achievement => achievement.EarnedAt is not null)
            .OrderByDescending(achievement => achievement.EarnedAt)
            .ThenBy(achievement => achievement.DisplayOrder)
            .Take(3)
            .Select(ToBadge)
            .ToList();

        return badges.Count > 0 ? badges : null;
    }

    private static IReadOnlyList<AchievementBadgePayload>? PendingBadges(
        IReadOnlyList<RetroAchievementsAchievement> achievements)
    {
        var badges = achievements
            .Where(achievement => achievement.EarnedAt is null)
            .OrderBy(achievement => achievement.DisplayOrder)
            .ThenBy(achievement => achievement.Title, StringComparer.OrdinalIgnoreCase)
            .Take(3)
            .Select(ToBadge)
            .ToList();

        return badges.Count > 0 ? badges : null;
    }

    private static AchievementBadgePayload ToBadge(RetroAchievementsAchievement achievement) =>
        new(
            achievement.Id,
            achievement.Title,
            achievement.Description,
            achievement.Points,
            achievement.BadgeUrl,
            achievement.EarnedAt?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));

    private int ConfigurationVersion
    {
        get
        {
            lock (_gate)
            {
                return _configurationVersion;
            }
        }
    }

    private (RetroAchievementsClient? Client, int Version) AccountSnapshot()
    {
        lock (_gate)
        {
            return (_client, _configurationVersion);
        }
    }

    private bool CacheAccount(RetroAchievementsAccount account, int version)
    {
        lock (_gate)
        {
            if (version != _configurationVersion)
            {
                return false;
            }

            _account = account;
            _authRejected = false;
            return true;
        }
    }

    private bool CacheMatch(string gameId, RetroAchievementsMatch? match, int version)
    {
        lock (_gate)
        {
            if (version != _configurationVersion)
            {
                return false;
            }

            _matches[gameId] = new CachedMatch(match, DateTimeOffset.UtcNow);
            return true;
        }
    }

    private bool CacheProgress(string gameId, AchievementsPayload payload, int version)
    {
        lock (_gate)
        {
            if (version != _configurationVersion)
            {
                return false;
            }

            _progress[gameId] = new CachedProgress(payload, DateTimeOffset.UtcNow);
            return true;
        }
    }

    private bool RejectAccount(int version, string? gameId = null)
    {
        lock (_gate)
        {
            if (version != _configurationVersion)
            {
                return false;
            }

            _authRejected = true;
            if (gameId is not null)
            {
                _progress.TryRemove(gameId, out _);
            }

            return true;
        }
    }

    private async Task<RetroAchievementsMatch?> ResolveMatchAsync(
        RetroAchievementsClient client,
        ConsoleDescriptor console,
        GameEntry game,
        CancellationToken cancellationToken)
    {
        if (_matches.TryGetValue(game.Id, out var cached)
            && DateTimeOffset.UtcNow - cached.FetchedAt < MatchLifetime)
        {
            return cached.Match;
        }

        var systemId = RetroAchievementsSupport.SystemIdFor(console);
        if (systemId is null)
        {
            return null;
        }

        var games = await GetGameListAsync(client, systemId.Value, cancellationToken)
            .ConfigureAwait(false);
        return RetroAchievementsGameMatcher.Find(game, games);
    }

    private async Task<IReadOnlyList<RetroAchievementsGame>> GetGameListAsync(
        RetroAchievementsClient client,
        int systemId,
        CancellationToken cancellationToken)
    {
        Task<IReadOnlyList<RetroAchievementsGame>>? task;

        lock (_gate)
        {
            if (!_gameListTasks.TryGetValue(systemId, out task) || task is null)
            {
                // The shared task intentionally uses no caller token: one canceled
                // selection must not cancel the list for every other game.
                task = client.GetGameListAsync(systemId, CancellationToken.None);
                _gameListTasks[systemId] = task;
            }
        }

        var pending = task;
        try
        {
            return await pending.WaitAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The caller moved on, but the shared list should finish for the next
            // selection. Only forget a task that actually failed or was canceled.
            if (pending.IsFaulted || pending.IsCanceled)
            {
                ForgetGameList(systemId, task);
            }

            throw;
        }
        catch
        {
            ForgetGameList(systemId, task);
            throw;
        }
    }

    private void ForgetGameList(int systemId, Task<IReadOnlyList<RetroAchievementsGame>> task)
    {
        lock (_gate)
        {
            if (_gameListTasks.TryGetValue(systemId, out var current)
                && ReferenceEquals(current, task))
            {
                _gameListTasks.Remove(systemId);
            }
        }
    }

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(20),
        };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Aisles", "0.6"));
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return client;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_ownsHttp)
        {
            _http.Dispose();
        }
    }

    private sealed record CachedMatch(RetroAchievementsMatch? Match, DateTimeOffset FetchedAt);

    private sealed record CachedProgress(AchievementsPayload Payload, DateTimeOffset FetchedAt);
}
