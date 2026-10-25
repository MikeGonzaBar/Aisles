using Aisles.App.Action;
using Aisles.App.Bridge;
using Aisles.App.Domain;
using Aisles.App.Ps3Trophies;
using Aisles.App.RetroAchievements;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Windows.Storage.Pickers;

namespace Aisles.App;

public sealed partial class MainWindow : Window
{
    /// <summary>Maps a virtual host to the web layer, so the page is an https origin.</summary>
    private const string WebHostName = "aisles.local";

    private readonly Dictionary<string, ConsoleDescriptor> _consolesById = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, GameEntry> _gamesById = new(StringComparer.Ordinal);
    private readonly Dictionary<string, AssetHosts> _assetHosts = new(StringComparer.OrdinalIgnoreCase);
    private readonly WebBridge _bridge = new();
    private readonly EmulatorLauncher _launcher = new();
    private readonly EmulatorTools _emulatorTools = new();
    private readonly EmulatorUpdateService _updates = new();
    private readonly ConsoleSettingsStore _settingsStore = new(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Aisles", "settings.json"));
    private readonly RetroAchievementsSettingsStore _retroSettingsStore = new(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Aisles", "retroachievements.json"));
    private readonly RetroAchievementsService _retroAchievements = new(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Aisles", "RetroAchievements"));
    private readonly Ps3TrophyService _ps3Trophies = new();
    private readonly ArtworkResolver _artwork = new(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Aisles", "artwork"));
    private readonly ConcurrentDictionary<string, byte> _searchedConsoles = new(StringComparer.OrdinalIgnoreCase);

    private ConsoleCatalog? _catalog;
    private ConsoleCatalog? _catalogDefaults;
    private string? _catalogError;
    private string? _settingsError;
    private string? _retroSettingsError;
    private string? _selectedGameId;
    private CancellationTokenSource? _detailsCts;
    private bool _catalogLoaded;
    private bool _fullScreen;

    public MainWindow()
    {
        InitializeComponent();
        Title = "Aisles";
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "wwwroot", "branding", "Aisles.ico"));
        RootGrid.Loaded += OnRootGridLoaded;
        Closed += (_, _) =>
        {
            _detailsCts?.Cancel();
            _detailsCts?.Dispose();
            _retroAchievements.Dispose();
        };
    }

    private async void OnRootGridLoaded(object sender, RoutedEventArgs e)
    {
        RootGrid.Loaded -= OnRootGridLoaded;

        ResizeWindow();
        LoadCatalog();
        await InitialiseWebViewAsync();
    }

    private void ResizeWindow()
    {
        MaximizeWindow();
        _fullScreen = false;
    }

    private void MaximizeWindow()
    {
        AppWindow.SetPresenter(AppWindowPresenterKind.Overlapped);

        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.Maximize();
        }
    }

    private async Task InitialiseWebViewAsync()
    {
        var stopwatch = Stopwatch.StartNew();
        var userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Aisles",
            "WebView2");

        Directory.CreateDirectory(userDataFolder);

        // The WinUI WebView2 control builds its own default environment, so rather
        // than constructing one (the projection's CreateAsync surface differs from
        // the classic .NET library's) we redirect the default away from the exe.
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", userDataFolder);

        await Stage.EnsureCoreWebView2Async();

        var core = Stage.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;

        var webRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        core.SetVirtualHostNameToFolderMapping(WebHostName, webRoot, CoreWebView2HostResourceAccessKind.Allow);

        // Artwork is referenced in place and served over its own hosts, so the page
        // can use ordinary <img> tags instead of base64 (PLAN.md section 5.3).
        RegisterAssetHosts(core);

        // Provider images are downloads, so they live in Aisles' own cache rather than
        // in a user folder. One host for the cache; the file name is its hash.
        core.SetVirtualHostNameToFolderMapping(
            ArtworkResolver.Host,
            _artwork.CacheRoot,
            CoreWebView2HostResourceAccessKind.Allow);

        _bridge.Attach(core, OnMessageFromWeb);
        core.Navigate($"https://{WebHostName}/index.html");
        Debug.WriteLine($"Startup: WebView navigation began after {stopwatch.ElapsedMilliseconds} ms.");
    }

    private void LoadCatalog()
    {
        if (_catalogLoaded)
        {
            return;
        }

        _catalogLoaded = true;
        var path = Path.Combine(AppContext.BaseDirectory, "consoles.json");
        var (retroSettings, retroError) = _retroSettingsStore.Load();
        _retroSettingsError = retroError;
        _retroAchievements.Configure(retroSettings);

        try
        {
            _catalogDefaults = ConsoleCatalog.Load(path);
            (_catalog, _settingsError) = _settingsStore.Apply(_catalogDefaults);
            _catalogError = null;
            IndexConsoles();
        }
        catch (Exception ex)
        {
            _catalog = null;
            _catalogError = $"Could not read {path}: {ex.Message}";
        }
    }

    /// <summary>
    /// Maps each console's games folder and artwork folder to its own virtual host.
    /// The plan calls for one hostname per folder, which keeps the URL a plain
    /// relative path: <c>https://art-ps2.aisles.local/SLUS-20946.jpg</c>.
    /// </summary>
    private void RegisterAssetHosts(CoreWebView2 core)
    {
        foreach (var host in _assetHosts.Values.SelectMany(h => new[] { h.GamesHost, h.ArtHost }).Where(h => h is not null))
            core.ClearVirtualHostNameToFolderMapping(host!);
        core.ClearVirtualHostNameToFolderMapping(Ps3TrophyService.IconHost);
        _assetHosts.Clear();

        if (_catalog is null)
        {
            return;
        }

        var usedHosts = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            WebHostName,
            Ps3TrophyService.IconHost,
        };

        foreach (var console in _catalog.Consoles)
        {
            var label = HostLabel(console.Id);
            string? gamesHost = null;
            string? artHost = null;

            if (Directory.Exists(console.GamesPath))
            {
                gamesHost = UniqueHost($"games-{label}", usedHosts);
                core.SetVirtualHostNameToFolderMapping(
                    gamesHost,
                    console.GamesPath,
                    CoreWebView2HostResourceAccessKind.Allow);
            }

            if (!string.IsNullOrWhiteSpace(console.ArtworkPath) && Directory.Exists(console.ArtworkPath))
            {
                artHost = UniqueHost($"art-{label}", usedHosts);
                core.SetVirtualHostNameToFolderMapping(
                    artHost,
                    console.ArtworkPath,
                    CoreWebView2HostResourceAccessKind.Allow);
            }

            _assetHosts[console.Id] = new AssetHosts(
                gamesHost,
                console.GamesPath,
                artHost,
                console.ArtworkPath);
        }

        // PS3 trophy icons live in RPCS3's dev_hdd0\home folder rather than a
        // per-console artwork folder, so they get one fixed host of their own.
        var ps3 = _catalog.Consoles.FirstOrDefault(console =>
            console.Id.Equals("ps3", StringComparison.OrdinalIgnoreCase));
        if (ps3 is not null && Ps3TrophyService.TrophyHomeRoot(ps3) is { } trophyHome)
        {
            core.SetVirtualHostNameToFolderMapping(
                Ps3TrophyService.IconHost,
                trophyHome,
                CoreWebView2HostResourceAccessKind.Allow);
        }
    }

    /// <summary>
    /// Turns a resolved file into a URL under the host that serves its root. Anything
    /// outside that root is refused rather than exposed.
    /// </summary>
    private string? UrlForArtwork(string consoleId, ArtworkReference artwork)
    {
        if (!_assetHosts.TryGetValue(consoleId, out var hosts))
        {
            return null;
        }

        var (host, root) = artwork.Source == "sidecar"
            ? (hosts.GamesHost, hosts.GamesRoot)
            : (hosts.ArtHost, hosts.ArtRoot);

        if (host is null || string.IsNullOrEmpty(root))
        {
            return null;
        }

        var relative = Path.GetRelativePath(root, artwork.FilePath);

        if (relative.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relative))
        {
            return null;
        }

        var segments = relative
            .Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries)
            .Select(Uri.EscapeDataString);

        return $"https://{host}/{string.Join('/', segments)}";
    }

    /// <summary>A hostname label may hold only letters, digits and hyphens.</summary>
    private static string HostLabel(string value)
    {
        var label = new StringBuilder(value.Length);

        foreach (var character in value.ToLowerInvariant())
        {
            label.Append(character is >= 'a' and <= 'z' or >= '0' and <= '9' ? character : '-');
        }

        var trimmed = label.ToString().Trim('-');
        return trimmed.Length == 0 ? "console" : trimmed;
    }

    private static string UniqueHost(string label, HashSet<string> used)
    {
        var host = $"{label}.aisles.local";

        for (var suffix = 2; !used.Add(host); suffix++)
        {
            host = $"{label}-{suffix}.aisles.local";
        }

        return host;
    }

    /// <summary>Virtual hosts and their roots, used to turn artwork files into URLs.</summary>
    private sealed record AssetHosts(string? GamesHost, string? GamesRoot, string? ArtHost, string? ArtRoot);

    /// <summary>
    /// Achievement data comes from one of two providers: RetroAchievements for the
    /// consoles it supports, and RPCS3's local trophy files for PS3. Keeping the
    /// choice here means the payload and details paths cannot drift apart.
    /// </summary>
    private AchievementsPayload AchievementsFor(ConsoleDescriptor console, GameEntry game) =>
        console.Id.Equals("ps3", StringComparison.OrdinalIgnoreCase)
            ? _ps3Trophies.ForGame(console, game)
            : _retroAchievements.ForLibrary(console, game);

    private LibraryPayload BuildLibraryPayload()
    {
        if (_catalog is null)
        {
            return new LibraryPayload(_catalogError, Array.Empty<ConsolePayload>());
        }

        var scanner = new LibraryScanner();
        var playStats = new PlayStatsReader();
        var consoles = new List<ConsolePayload>(_catalog.Consoles.Count);
        _gamesById.Clear();

        foreach (var console in _catalog.Consoles)
        {
            var games = scanner.Scan(console);

            foreach (var game in games)
            {
                _gamesById[game.Id] = game;
            }

            consoles.Add(new ConsolePayload(
                console.Id,
                console.Name,
                console.ShortName,
                console.Manufacturer,
                console.Year,
                console.Media,
                console.AccentColor,
                console.BodyColor,
                console.GamesPath,
                console.GamesPathExists,
                console.EmulatorExists,
                console.Arguments.Contains("{core}", StringComparison.Ordinal),
                !console.Arguments.Contains("{core}", StringComparison.Ordinal)
                    || (!string.IsNullOrWhiteSpace(console.CorePath) && File.Exists(console.CorePath)),
                EmulatorNameFor(console),
                games.Select(game =>
                {
                    var art = _artwork.Resolve(
                        game,
                        console,
                        game.FrontCover is { } cover ? UrlForArtwork(console.Id, cover) : null);
                    var identity = _artwork.Identity(game);
                    var played = playStats.For(console, identity.Id ?? game.Serial, game.LaunchTarget);

                    return new GamePayload(
                        game.Id,
                        game.Title,
                        game.LaunchTarget,
                        game.Serial,
                        game.Version,
                        identity.Id,
                        identity.Region,
                        game.TitleSource,
                        art.FrontCover.Url,
                        art.FrontCover.Match,
                        art.FrontCover.Source,
                        art.Medium.Url,
                        art.Medium.Match,
                        art.Medium.Source,
                        art.Medium.LabelRect,
                        new PlayedPayload(played.Seconds, played.LastPlayed, played.Source, played.Reason),
                        AchievementsFor(console, game));
                }).ToList()));
        }

        return new LibraryPayload(null, consoles);
    }

    /// <summary>
    /// Refreshes the details rail when a game is selected. The payload already carries
    /// these values; this message exists for two reasons: PCSX2 and Dolphin write their
    /// caches while Aisles is running, and a Wii game's ID is only known after its disc
    /// header is read. Both are cheap and both are applied only if the selection is
    /// still current.
    /// </summary>
    private async Task SendGameDetailsAsync(string? gameId, CancellationToken cancellationToken = default)
    {
        try
        {
            if (!TryResolve(gameId, out var console, out var game))
            {
                return;
            }

            var identity = _artwork.Identity(game);

            if ((console.Id.Equals("wii", StringComparison.OrdinalIgnoreCase)
                    || console.Id.Equals("gamecube", StringComparison.OrdinalIgnoreCase))
                && identity.Id is null)
            {
                var resolved = await GameIdentityReader.DolphinHeaderAsync(
                    console,
                    game.LaunchTarget,
                    cancellationToken);

                if (resolved is { Id: not null })
                {
                    identity = resolved;
                }
            }

            if (cancellationToken.IsCancellationRequested
                || !string.Equals(_selectedGameId, game.Id, StringComparison.Ordinal))
            {
                return;
            }

            var played = new PlayStatsReader().For(console, identity.Id ?? game.Serial, game.LaunchTarget);
            var region = identity.Region ?? GameIdentityReader.RegionFromId(
                console.Id,
                identity.Id ?? game.Serial);

            // Play time and identity are local and fast. Send them immediately, then
            // let the achievements rail update separately when the API answers.
            _bridge.Send("gameDetails", new
            {
                gameId = game.Id,
                identityId = identity.Id,
                version = game.Version,
                region,
                played = new PlayedPayload(played.Seconds, played.LastPlayed, played.Source, played.Reason),
                achievements = AchievementsFor(console, game),
            });

            await RefreshAchievementsAsync(console, game, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            // A newer selection won; its details request will do the work.
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Details for {gameId} failed: {ex}");
        }
    }

    private async Task RefreshAchievementsAsync(
        ConsoleDescriptor console,
        GameEntry game,
        CancellationToken cancellationToken)
    {
        if (console.Id.Equals("ps3", StringComparison.OrdinalIgnoreCase)
            || !RetroAchievementsSupport.IsSupported(console)
            || !_retroAchievements.HasCredentials)
        {
            return;
        }

        try
        {
            var achievements = await _retroAchievements.GetForGameAsync(console, game, cancellationToken);
            if (cancellationToken.IsCancellationRequested
                || !string.Equals(_selectedGameId, game.Id, StringComparison.Ordinal))
            {
                return;
            }

            _bridge.Send("gameDetails", new
            {
                gameId = game.Id,
                achievements,
            });
        }
        catch (OperationCanceledException)
        {
            // Superseded by another selection.
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Achievements for {game.Id} failed ({ex.GetType().Name}).");
        }
    }

    private void RefreshSelectedGameDetails()
    {
        _detailsCts?.Cancel();
        _detailsCts?.Dispose();
        _detailsCts = null;

        if (_selectedGameId is null)
        {
            return;
        }

        _detailsCts = new CancellationTokenSource();
        _ = SendGameDetailsAsync(_selectedGameId, _detailsCts.Token);
    }

    private async void OnMessageFromWeb(string json)
    {
        if (BridgeMessage.Parse(json) is not { } message)
        {
            return;
        }

        switch (message.Type)
        {
            case "ready":
                _bridge.Send("library", await Task.Run(BuildLibraryPayload));
                break;

            case "getSettings":
                SendSettings(message.ReadString("requestId"));
                break;

            case "validateSettings":
                ValidateSettings(message);
                break;

            case "browsePath":
                await BrowsePathAsync(message);
                break;

            case "saveSettings":
                await SaveSettingsAsync(message);
                break;

            case "rescan":
                await RescanAsync(message.ReadString("requestId"));
                break;

            case "launchGame":
                LaunchGame(message.ReadString("gameId"));
                break;

            case "revealGame":
                RevealGame(message.ReadString("gameId"));
                break;

            // Full screen is borderless, so the page is the only thing that can offer a
            // way back out: Escape and F11 come through here.
            case "windowMode":
                SetFullScreen(message.ReadBool("fullScreen"));
                break;

            case "selectConsole":
                _ = SearchConsoleArtworkAsync(message.ReadString("consoleId"));
                break;

            case "selectGame":
                _selectedGameId = message.ReadString("gameId");
                RefreshSelectedGameDetails();
                break;

            case "testRetroAchievements":
                await TestRetroAchievementsAsync(message);
                break;

            // Console actions come from the right-click menu. They never need a game
            // selected, and each one reports its own result so the menu can stay open
            // while an update check is in flight.
            case "openEmulator":
                RunConsoleAction(message, "openEmulator", _emulatorTools.Open);
                break;

            case "openControllerConfig":
                RunConsoleAction(message, "openControllerConfig", _emulatorTools.OpenConfigFolder);
                break;

            case "openReleasePage":
                RunConsoleAction(message, "openReleasePage", _emulatorTools.OpenReleasePage);
                break;

            case "openXeniaManager":
                RunConsoleAction(message, "openXeniaManager", _emulatorTools.OpenXeniaManager);
                break;

            case "checkForUpdates":
                await CheckForUpdatesAsync(message);
                break;
        }
    }

    private void SendSettings(string? requestId)
    {
        if (_catalog is null || _catalogDefaults is null)
        {
            _bridge.Send("settingsData", new { requestId, error = _catalogError ?? "Console catalog is unavailable." });
            return;
        }

        var drafts = _catalog.Consoles.ToDictionary(c => c.Id,
            c => new ConsolePathDraft(
                c.GamesPath,
                c.EmulatorPath,
                c.ArtworkPath ?? string.Empty,
                c.CorePath ?? string.Empty),
            StringComparer.OrdinalIgnoreCase);
        var validation = _settingsStore.Validate(_catalogDefaults, drafts);
        var retro = _retroAchievements.Settings;
        _bridge.Send("settingsData", new
        {
            requestId,
            error = _settingsError,
            consoles = _catalog.Consoles.Select(c => new
            {
                c.Id, c.Name, c.ShortName, c.Manufacturer, c.Year,
                gamesPath = c.GamesPath,
                emulatorPath = c.EmulatorPath,
                artworkPath = c.ArtworkPath ?? string.Empty,
                corePath = c.CorePath ?? string.Empty,
                validation = validation[c.Id],
            }).ToList(),
            retroAchievements = new
            {
                username = retro.Username,
                hasApiKey = retro.HasApiKey,
                linked = retro.HasCredentials && !_retroAchievements.IsAuthRejected,
                rejected = _retroAchievements.IsAuthRejected,
                points = _retroAchievements.CachedAccount?.TotalPoints,
                error = _retroSettingsError,
            },
        });
    }

    private void ValidateSettings(BridgeMessage message)
    {
        var requestId = message.ReadString("requestId");
        Dictionary<string, ConsolePathDraft> drafts;
        string? error = null;
        if (_catalogDefaults is null || !TryReadDrafts(message, out drafts, out error))
        {
            _bridge.Send("settingsValidation", new { requestId, error = error ?? "Console catalog is unavailable." });
            return;
        }
        _bridge.Send("settingsValidation", new { requestId, consoles = _settingsStore.Validate(_catalogDefaults, drafts) });
    }

    private async Task BrowsePathAsync(BridgeMessage message)
    {
        var requestId = message.ReadString("requestId");
        var consoleId = message.ReadString("consoleId");
        var field = message.ReadString("field");
        try
        {
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            string? selected;
            if (field is "emulatorPath" or "corePath")
            {
                var picker = new FileOpenPicker { SuggestedStartLocation = PickerLocationId.ComputerFolder };
                picker.FileTypeFilter.Add(field == "emulatorPath" ? ".exe" : ".dll");
                WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
                selected = (await picker.PickSingleFileAsync())?.Path;
            }
            else if (field is "gamesPath" or "artworkPath")
            {
                var picker = new FolderPicker { SuggestedStartLocation = PickerLocationId.ComputerFolder };
                picker.FileTypeFilter.Add("*");
                WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
                selected = (await picker.PickSingleFolderAsync())?.Path;
            }
            else throw new InvalidDataException("Unknown settings field.");
            _bridge.Send("browsePathResult", new { requestId, consoleId, field, path = selected, cancelled = selected is null });
        }
        catch (Exception ex)
        {
            _bridge.Send("browsePathResult", new { requestId, error = ex.Message });
        }
    }

    private async Task SaveSettingsAsync(BridgeMessage message)
    {
        var requestId = message.ReadString("requestId");
        Dictionary<string, ConsolePathDraft> drafts;
        string? error = null;
        if (_catalogDefaults is null || !TryReadDrafts(message, out drafts, out error))
        {
            _bridge.Send("settingsSaved", new { requestId, saved = false, error = error ?? "Console catalog is unavailable." });
            return;
        }

        if (!TryReadRetroAchievements(message, out var retroSettings, out var retroPresent, out error))
        {
            _bridge.Send("settingsSaved", new { requestId, saved = false, error });
            return;
        }

        try
        {
            await Task.Run(() =>
            {
                _settingsStore.Save(_catalogDefaults, drafts);
                if (retroPresent)
                {
                    _retroSettingsStore.Save(retroSettings);
                }
            });

            (_catalog, _settingsError) = _settingsStore.Apply(_catalogDefaults);
            if (retroPresent)
            {
                _retroAchievements.Configure(retroSettings);
                _retroSettingsError = null;
            }

            IndexConsoles();
            RegisterAssetHosts(Stage.CoreWebView2);
            _bridge.Send("settingsSaved", new { requestId, saved = true });
            await RescanAsync(requestId);
        }
        catch (Exception ex)
        {
            _bridge.Send("settingsSaved", new { requestId, saved = false, error = ex.Message });
        }
    }

    private bool TryReadRetroAchievements(
        BridgeMessage message,
        out RetroAchievementsSettings settings,
        out bool present,
        out string? error)
    {
        settings = _retroAchievements.Settings;
        present = false;
        error = null;

        if (message.Payload is not { ValueKind: JsonValueKind.Object } payload
            || !payload.TryGetProperty("retroAchievements", out var element)
            || element.ValueKind != JsonValueKind.Object)
        {
            return true;
        }

        present = true;
        var username = JsonString(element, "username").Trim();
        var apiKey = JsonString(element, "apiKey").Trim();

        if (username.Length == 0)
        {
            settings = RetroAchievementsSettings.Empty;
            return true;
        }

        if (apiKey.Length == 0 && _retroAchievements.Settings.HasApiKey)
        {
            apiKey = _retroAchievements.Settings.ApiKey;
        }

        if (apiKey.Length == 0)
        {
            error = "Enter the RetroAchievements web API key.";
            return false;
        }

        settings = new RetroAchievementsSettings(username, apiKey);
        return true;
    }

    private static string JsonString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty
            : string.Empty;

    private async Task TestRetroAchievementsAsync(BridgeMessage message)
    {
        var requestId = message.ReadString("requestId");

        if (!TryReadRetroAchievements(message, out var settings, out _, out var error))
        {
            _bridge.Send("retroAchievementsTest", new { requestId, ok = false, message = error });
            return;
        }

        if (!settings.HasCredentials)
        {
            _bridge.Send("retroAchievementsTest", new
            {
                requestId,
                ok = false,
                message = "Enter your RetroAchievements username and web API key.",
            });
            return;
        }

        try
        {
            var account = await _retroAchievements.TestAccountAsync(settings, CancellationToken.None);
            _bridge.Send("retroAchievementsTest", new
            {
                requestId,
                ok = true,
                message = $"Connected as {account.User} - {account.TotalPoints:N0} points.",
            });
        }
        catch (RetroAchievementsException ex)
        {
            _bridge.Send("retroAchievementsTest", new { requestId, ok = false, message = ex.Message });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"RetroAchievements test failed ({ex.GetType().Name}).");
            _bridge.Send("retroAchievementsTest", new
            {
                requestId,
                ok = false,
                message = "Could not test the RetroAchievements account. Try again later.",
            });
        }
    }

    private async Task RescanAsync(string? requestId)
    {
        try
        {
            var library = await Task.Run(BuildLibraryPayload);
            _bridge.Send("library", library);
            _bridge.Send("scanResult", new { requestId, succeeded = true });

            // The selected game may now have a different match or account context.
            RefreshSelectedGameDetails();

            // New games need their first provider pass; games already searched are
            // skipped by the resolver.
            _searchedConsoles.Clear();
            _ = SearchArtworkAsync();
        }
        catch (Exception ex)
        {
            _bridge.Send("scanResult", new { requestId, succeeded = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Searches the console the user is looking at. Called on the first load and whenever
    /// a console is selected; each console is searched at most once per session, and the
    /// resolver itself skips games whose slots are already resolved. Browsing never waits
    /// on the network: the payload is sent before this starts.
    /// </summary>
    private async Task SearchArtworkAsync()
    {
        if (_catalog is null || _catalog.Consoles.Count == 0)
        {
            return;
        }

        await SearchConsoleArtworkAsync(_catalog.Consoles[0].Id);
    }

    private async Task SearchConsoleArtworkAsync(string? consoleId)
    {
        if (_catalog is null || string.IsNullOrWhiteSpace(consoleId))
        {
            return;
        }

        var console = _catalog.Consoles.FirstOrDefault(candidate =>
            candidate.Id.Equals(consoleId, StringComparison.OrdinalIgnoreCase));

        if (console is null || !console.GamesPathExists || !_searchedConsoles.TryAdd(console.Id, 0))
        {
            return;
        }

        try
        {
            var games = await Task.Run(() => new LibraryScanner().Scan(console));

            if (games.Count == 0)
            {
                return;
            }

            await _artwork.SearchConsoleAsync(
                console,
                games,
                game => game.FrontCover is { } cover ? UrlForArtwork(console.Id, cover) : null,
                CancellationToken.None);

            var library = await Task.Run(BuildLibraryPayload);
            _bridge.Send("library", library);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Artwork search for {console.Id} failed: {ex}");
        }
    }

    private bool TryReadDrafts(BridgeMessage message, out Dictionary<string, ConsolePathDraft> drafts, out string? error)
    {
        drafts = new(StringComparer.OrdinalIgnoreCase);
        error = null;
        var element = message.ReadElement("consoles");
        if (element is not { ValueKind: JsonValueKind.Object }) { error = "Settings payload is missing consoles."; return false; }
        var known = _catalogDefaults?.Consoles.Select(c => c.Id).ToHashSet(StringComparer.OrdinalIgnoreCase) ?? [];
        foreach (var console in element.Value.EnumerateObject())
        {
            if (!known.Contains(console.Name)) { error = $"Unknown console: {console.Name}"; return false; }
            if (console.Value.ValueKind != JsonValueKind.Object) { error = $"Invalid settings for {console.Name}."; return false; }
            static string Field(JsonElement item, string name) => item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
            drafts[console.Name] = new(
                Field(console.Value, "gamesPath"),
                Field(console.Value, "emulatorPath"),
                Field(console.Value, "artworkPath"),
                Field(console.Value, "corePath"));
        }
        if (drafts.Count != known.Count) { error = "Settings must include every configured console."; return false; }
        return true;
    }

    private void IndexConsoles()
    {
        _consolesById.Clear();
        if (_catalog is null) return;
        foreach (var console in _catalog.Consoles) _consolesById[console.Id] = console;
    }

    /// <summary>
    /// Switches between the optional full-screen stage and the default maximized window.
    /// </summary>
    private void SetFullScreen(bool fullScreen)
    {
        if (fullScreen == _fullScreen)
        {
            return;
        }

        _fullScreen = fullScreen;

        if (fullScreen)
        {
            AppWindow.SetPresenter(AppWindowPresenterKind.FullScreen);
            return;
        }

        MaximizeWindow();
    }

    private void RunConsoleAction(
        BridgeMessage message,
        string action,
        Func<ConsoleDescriptor, LaunchResult> operation)
    {
        var consoleId = message.ReadString("consoleId");

        if (!TryResolveConsole(consoleId, out var console))
        {
            _bridge.Send("consoleActionResult", new
            {
                consoleId,
                action,
                ok = false,
                message = "Unknown console.",
            });
            return;
        }

        LaunchResult result;

        try
        {
            result = operation(console);
        }
        catch (Exception ex)
        {
            result = new LaunchResult(false, ex.Message);
        }

        _bridge.Send("consoleActionResult", new
        {
            consoleId,
            action,
            ok = result.Started,
            message = result.Message,
        });
    }

    private async Task CheckForUpdatesAsync(BridgeMessage message)
    {
        var requestId = message.ReadString("requestId");
        var consoleId = message.ReadString("consoleId");

        if (!TryResolveConsole(consoleId, out var console))
        {
            _bridge.Send("updateCheck", new
            {
                requestId,
                consoleId,
                emulatorName = (string?)null,
                currentVersion = (string?)null,
                latestVersion = (string?)null,
                updateAvailable = (bool?)null,
                releaseAvailable = false,
                managerAvailable = false,
                note = (string?)null,
                error = "Unknown console.",
            });
            return;
        }

        var result = await _updates.CheckAsync(console, CancellationToken.None);

        _bridge.Send("updateCheck", new
        {
            requestId,
            result.ConsoleId,
            emulatorName = result.EmulatorName,
            currentVersion = result.CurrentVersion,
            latestVersion = result.LatestVersion,
            updateAvailable = result.UpdateAvailable,
            releaseAvailable = !string.IsNullOrWhiteSpace(result.ReleasePageUrl),
            managerAvailable = !string.IsNullOrWhiteSpace(result.ManagerPath),
            note = result.Note,
            error = result.Error,
        });
    }

    private bool TryResolveConsole(string? consoleId, out ConsoleDescriptor console)
    {
        console = null!;

        if (string.IsNullOrEmpty(consoleId) || !_consolesById.TryGetValue(consoleId, out var resolved))
        {
            return false;
        }

        console = resolved;
        return true;
    }

    private void LaunchGame(string? gameId)
    {
        if (!TryResolve(gameId, out var console, out var game))
        {
            _bridge.Send("launchResult", new { gameId, started = false, message = "Unknown game." });
            return;
        }

        var result = _launcher.Launch(console, game);
        _bridge.Send("launchResult", new { gameId, result.Started, result.Message });
    }

    private void RevealGame(string? gameId)
    {
        if (!TryResolve(gameId, out var console, out var game))
        {
            return;
        }

        _launcher.Reveal(console, game);
    }

    /// <summary>
    /// The rail names the executable a person actually configured, not a second
    /// platform table. Versioned file names collapse to the emulator's public name.
    /// </summary>
    private static string EmulatorNameFor(ConsoleDescriptor console)
    {
        var fileName = Path.GetFileNameWithoutExtension(console.EmulatorPath) ?? string.Empty;

        if (fileName.Contains("pcsx2", StringComparison.OrdinalIgnoreCase)) return "PCSX2";
        if (fileName.Contains("dolphin", StringComparison.OrdinalIgnoreCase)) return "Dolphin";
        if (fileName.Contains("rpcs3", StringComparison.OrdinalIgnoreCase)) return "RPCS3";
        if (fileName.Contains("duckstation", StringComparison.OrdinalIgnoreCase)) return "DuckStation";
        if (fileName.Contains("retroarch", StringComparison.OrdinalIgnoreCase)) return "RetroArch";
        if (fileName.Contains("desmume", StringComparison.OrdinalIgnoreCase)) return "DeSmuME";
        if (fileName.Contains("citra", StringComparison.OrdinalIgnoreCase)) return "Citra";
        if (fileName.Contains("xenia", StringComparison.OrdinalIgnoreCase)) return "Xenia Canary";

        return fileName.Length == 0 ? "Emulator" : fileName;
    }

    private bool TryResolve(string? gameId, out ConsoleDescriptor console, out GameEntry game)
    {
        console = null!;
        game = null!;

        if (string.IsNullOrEmpty(gameId) || !_gamesById.TryGetValue(gameId, out var resolvedGame))
        {
            return false;
        }

        if (!_consolesById.TryGetValue(resolvedGame.ConsoleId, out var resolvedConsole))
        {
            return false;
        }

        game = resolvedGame;
        console = resolvedConsole;
        return true;
    }
}
