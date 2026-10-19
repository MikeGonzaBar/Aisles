using Aisles.App.Action;
using Aisles.App.Bridge;
using Aisles.App.Domain;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using Windows.Graphics;

namespace Aisles.App;

public sealed partial class MainWindow : Window
{
    /// <summary>Maps a virtual host to the web layer, so the page is an https origin.</summary>
    private const string WebHostName = "aisles.local";

    private readonly Dictionary<string, ConsoleDescriptor> _consolesById = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, GameEntry> _gamesById = new(StringComparer.Ordinal);
    private readonly WebBridge _bridge = new();
    private readonly EmulatorLauncher _launcher = new();

    private ConsoleCatalog? _catalog;
    private string? _catalogError;
    private bool _catalogLoaded;

    public MainWindow()
    {
        InitializeComponent();
        Title = "Aisles";
        RootGrid.Loaded += OnRootGridLoaded;
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
        // The agreed blockout is 1280x720; start a little taller so the details rail
        // and the shelf both have room at the target aspect.
        AppWindow.Resize(new SizeInt32(1360, 820));

        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary);
        if (area is not null)
        {
            var x = area.WorkArea.X + ((area.WorkArea.Width - 1360) / 2);
            var y = area.WorkArea.Y + ((area.WorkArea.Height - 820) / 2);
            AppWindow.Move(new PointInt32(Math.Max(area.WorkArea.X, x), Math.Max(area.WorkArea.Y, y)));
        }
    }

    private async Task InitialiseWebViewAsync()
    {
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

        _bridge.Attach(core, OnMessageFromWeb);
        core.Navigate($"https://{WebHostName}/index.html");
    }

    private void LoadCatalog()
    {
        if (_catalogLoaded)
        {
            return;
        }

        _catalogLoaded = true;
        var path = Path.Combine(AppContext.BaseDirectory, "consoles.json");

        try
        {
            _catalog = ConsoleCatalog.Load(path);
            _catalogError = null;

            foreach (var console in _catalog.Consoles)
            {
                _consolesById[console.Id] = console;
            }
        }
        catch (Exception ex)
        {
            _catalog = null;
            _catalogError = $"Could not read {path}: {ex.Message}";
        }
    }

    private LibraryPayload BuildLibraryPayload()
    {
        if (_catalog is null)
        {
            return new LibraryPayload(_catalogError, Array.Empty<ConsolePayload>());
        }

        var scanner = new LibraryScanner();
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
                games.Select(game => new GamePayload(game.Id, game.Title, game.LaunchTarget)).ToList()));
        }

        return new LibraryPayload(null, consoles);
    }

    private void OnMessageFromWeb(string json)
    {
        if (BridgeMessage.Parse(json) is not { } message)
        {
            return;
        }

        switch (message.Type)
        {
            case "ready":
                _bridge.Send("library", BuildLibraryPayload());
                break;

            case "launchGame":
                LaunchGame(message.ReadString("gameId"));
                break;

            case "revealGame":
                RevealGame(message.ReadString("gameId"));
                break;

            // The web layer owns selection state in Phase 0, and settings arrive in
            // Phase 5, so these are accepted and acknowledged but do nothing yet.
            case "selectConsole":
            case "selectGame":
            case "openSettings":
                break;
        }
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
