using System.Net;
using System.Text;
using Aisles.App.Bridge;
using Aisles.App.Domain;
using Aisles.App.RetroAchievements;

var root = Path.Combine(Path.GetTempPath(), "aisles-settings-tests", Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
try
{
    var defaults = new ConsoleCatalog { Consoles = [new ConsoleDescriptor
    {
        Id = "ps1", Name = "PlayStation", GamesPath = @"C:\Games", EmulatorPath = @"C:\Emu\emu.exe", ArtworkPath = @"C:\Covers"
    }] };
    var path = Path.Combine(root, "settings.json");
    var store = new ConsoleSettingsStore(path);

    store.Save(defaults, new Dictionary<string, ConsolePathDraft> { ["ps1"] = new(@"D:\Games", @"C:\Emu\emu.exe", @"C:\Covers") });
    var merged = store.Apply(defaults);
    Equal(@"D:\Games", merged.Catalog.Consoles[0].GamesPath, "override merging");
    Equal(@"C:\Games", defaults.Consoles[0].GamesPath, "defaults remain unchanged");

    store.Save(defaults, new Dictionary<string, ConsolePathDraft> { ["ps1"] = new("", "", "") });
    merged = store.Apply(defaults);
    Equal("", merged.Catalog.Consoles[0].GamesPath, "cleared games path");
    Equal("", merged.Catalog.Consoles[0].EmulatorPath, "cleared emulator path");

    Throws<InvalidDataException>(() => store.Save(defaults,
        new Dictionary<string, ConsolePathDraft> { ["ps1"] = new("relative", "", "") }), "relative path rejection");
    Throws<InvalidDataException>(() => store.Save(defaults,
        new Dictionary<string, ConsolePathDraft> { ["ps1"] = new(@"C:\Games\*", "", "") }), "malformed path rejection");
    Throws<InvalidDataException>(() => store.Save(defaults,
        new Dictionary<string, ConsolePathDraft> { ["unknown"] = new("", "", "") }), "unknown console rejection");

    File.WriteAllText(path, "{ broken");
    merged = store.Apply(defaults);
    True(merged.Error is not null, "corrupt settings report an error");
    Equal(@"C:\Games", merged.Catalog.Consoles[0].GamesPath, "corrupt settings fall back to defaults");

    var unwritable = new ConsoleSettingsStore(root);
    ThrowsAny(() => unwritable.Save(defaults,
        new Dictionary<string, ConsolePathDraft> { ["ps1"] = new(@"D:\Games", @"C:\Emu\emu.exe", @"C:\Covers") }), "failed write surfaces");

    var realDsScan = new ArtworkCandidate
    {
        Source = "LaunchBox", Kind = "cartridgeLabel", Width = 517, Height = 564, PreparationRequired = true
    };
    True(DsStickerExtractor.TryPrepare(realDsScan), "real DS scan is prepared");
    EqualArray(new double[] { 43, 20, 429, 474 }, realDsScan.LabelRect!, "real DS sticker crop");
    True(!realDsScan.PreparationRequired, "prepared DS scan is eligible");

    var dsMockup = new ArtworkCandidate
    {
        Source = "LaunchBox", Kind = "cartridgeLabel", Width = 260, Height = 270, PreparationRequired = true
    };
    True(!DsStickerExtractor.TryPrepare(dsMockup), "DS box-art mockup is rejected");
    True(dsMockup.LabelRect is null && dsMockup.PreparationRequired, "rejected mockup stays blocked");

    var pcsx2 = PlayStatsReader.ParsePcsx2(
        "SLUS-21151                       32387                1765476533          \n" +
        "SLUS-20705                       0                    0                   ",
        "slus-21151");
    EqualNumber(32387, pcsx2.Seconds, "PCSX2 play time is seconds");
    Equal(
        DateTimeOffset.FromUnixTimeSeconds(1765476533).ToLocalTime().ToString("d MMM yyyy", System.Globalization.CultureInfo.InvariantCulture),
        pcsx2.LastPlayed,
        "PCSX2 last played is local time");
    Equal("PCSX2 playtime.dat", pcsx2.Source, "PCSX2 source is named");

    var unplayed = PlayStatsReader.ParsePcsx2("SLUS-20705 0 0", "SLUS-20705");
    EqualNumber(0, unplayed.Seconds, "PCSX2 zero stays zero");
    True(unplayed.Reason is not null, "PCSX2 zero explains itself");

    var dolphin = PlayStatsReader.ParseDolphin(
        "[Other]\nRMCE01 = 0x10\n[TimePlayed]\nRMCE01 = 0x00000000004bfafc",
        "RMCE01");
    EqualNumber(4979, dolphin.Seconds, "Dolphin hex milliseconds become seconds");
    True(dolphin.LastPlayed is null, "Dolphin has no last-played time");
    Equal("Dolphin TimePlayed.ini", dolphin.Source, "Dolphin source is named");

    var noDolphinEntry = PlayStatsReader.ParseDolphin("[TimePlayed]\nRSBE01 = 0x1", "RMCE01");
    True(noDolphinEntry.Reason is not null, "missing Dolphin record explains itself");

    var duckStation = PlayStatsReader.ParseDuckStation(
        "SCUS-94288                       27                    1792469733          \n" +
        "SLUS-00113                       5                     1765476661          ",
        "scus-94288");
    EqualNumber(27, duckStation.Seconds, "DuckStation play time is seconds");
    Equal(
        DateTimeOffset.FromUnixTimeSeconds(1792469733).ToLocalTime().ToString("d MMM yyyy", System.Globalization.CultureInfo.InvariantCulture),
        duckStation.LastPlayed,
        "DuckStation last played is local time");
    Equal("DuckStation playtime.dat", duckStation.Source, "DuckStation source is named");

    var unplayedDuckStation = PlayStatsReader.ParseDuckStation("SLUS-00113 0 0", "SLUS-00113");
    EqualNumber(0, unplayedDuckStation.Seconds, "DuckStation zero stays zero");
    True(unplayedDuckStation.Reason is not null, "DuckStation zero explains itself");

    var rpcs3 = PlayStatsReader.ParseRpcs3(
        "[LastPlayed]\nBCUS98245=2025-11-21T20:35:50\nNPUA70096=2025-11-24T23:31:01\n" +
        "[Playtime]\nBCUS98245=51133\nNPUA70096=422013\n",
        "bcuS98245");
    EqualNumber(51, rpcs3.Seconds, "RPCS3 milliseconds become seconds");
    Equal("21 Nov 2025", rpcs3.LastPlayed, "RPCS3 last played is a date");
    Equal("RPCS3 persistent_settings.dat", rpcs3.Source, "RPCS3 source is named");

    var noRpcs3Entry = PlayStatsReader.ParseRpcs3("[Playtime]\nNPUA70096=1", "BCUS98148");
    True(noRpcs3Entry.Reason is not null, "missing RPCS3 record explains itself");

    Equal("notLinked", RetroAchievementsSupport.StateFor("ps2"), "PS2 has RetroAchievements support");
    Equal("notLinked", RetroAchievementsSupport.StateFor("gamecube"), "GameCube has RetroAchievements support");
    Equal("notSupported", RetroAchievementsSupport.StateFor("ds"), "DS has no RetroAchievements support");
    Equal("notSupported", RetroAchievementsSupport.StateFor("ps3"), "PS3 has no RetroAchievements support");
    EqualNumber(12, RetroAchievementsSupport.SystemIdFor("ps1") ?? -1, "PS1 RetroAchievements system ID");
    EqualNumber(21, RetroAchievementsSupport.SystemIdFor("ps2") ?? -1, "PS2 RetroAchievements system ID");
    EqualNumber(16, RetroAchievementsSupport.SystemIdFor("gamecube") ?? -1, "GameCube RetroAchievements system ID");
    EqualNumber(19, RetroAchievementsSupport.SystemIdFor("wii") ?? -1, "Wii RetroAchievements system ID");
    True(RetroAchievementsSupport.SystemIdFor("ds") is null, "DS has no RetroAchievements system ID");

    var retroSettingsPath = Path.Combine(root, "retroachievements.json");
    var retroStore = new RetroAchievementsSettingsStore(retroSettingsPath);
    var (retro, retroError) = retroStore.Load();
    True(!retro.HasCredentials && retroError is null, "missing RetroAchievements settings are empty");

    retroStore.Save(new RetroAchievementsSettings("  gonzalo  ", "  secret-key  "));
    (retro, retroError) = retroStore.Load();
    Equal("gonzalo", retro.Username, "RetroAchievements username round-trip");
    Equal("secret-key", retro.ApiKey, "RetroAchievements API key round-trip");
    True(retro.HasCredentials, "RetroAchievements credentials are complete");
    True(retroError is null, "RetroAchievements settings load without error");

    File.WriteAllText(retroSettingsPath, "{ broken");
    (retro, retroError) = retroStore.Load();
    True(retroError is not null, "corrupt RetroAchievements settings report an error");
    True(!retro.HasCredentials, "corrupt RetroAchievements settings fall back to empty");

    retroStore.Save(RetroAchievementsSettings.Empty);
    True(!File.Exists(retroSettingsPath), "empty RetroAchievements settings remove the secret file");

    var raGames = new RetroAchievementsGame[]
    {
        new(1, "Gran Turismo 4", 100, 1000),
        new(2, "Mario Kart Wii", 20, 200),
        new(3, "Shrek the Third", 30, 300),
        new(4, "Sonic Heroes", 40, 400),
        new(5, "Ambiguous Game", 5, 50),
        new(6, "Ambiguous Game", 5, 50),
    };

    var gt = RetroAchievementsGameMatcher.Find(
        new GameEntry { Id = "ps2:gt", ConsoleId = "ps2", Title = "Unknown Local Name", LaunchTarget = "GranTurismo4PS2.iso" },
        raGames);
    EqualNumber(1, gt?.Game.Id ?? -1, "camel-case filename strips the PS2 suffix and matches compactly");
    Equal("file name", gt?.Source, "compact match records the filename source");

    var mario = RetroAchievementsGameMatcher.Find(
        new GameEntry { Id = "wii:mario", ConsoleId = "wii", Title = "Mario Kart Wii", LaunchTarget = "Mario Kart Wii (USA).rvz" },
        raGames);
    EqualNumber(2, mario?.Game.Id ?? -1, "trailing Wii is part of the title, not a suffix");

    var shrek = RetroAchievementsGameMatcher.Find(
        new GameEntry { Id = "ps2:shrek", ConsoleId = "ps2", Title = "DreamWorks Shrek the Third", LaunchTarget = "Shrek the Third (USA).iso" },
        raGames);
    EqualNumber(3, shrek?.Game.Id ?? -1, "studio prefix is ignored during matching");

    var sonic = RetroAchievementsGameMatcher.Find(
        new GameEntry { Id = "ps2:sonic", ConsoleId = "ps2", Title = "SonicHeroesPS2", LaunchTarget = "SonicHeroesPS2.iso" },
        raGames);
    EqualNumber(4, sonic?.Game.Id ?? -1, "attached system suffix is removed");

    var ambiguous = RetroAchievementsGameMatcher.Find(
        new GameEntry { Id = "ps2:ambiguous", ConsoleId = "ps2", Title = "Ambiguous Game", LaunchTarget = "Ambiguous Game.iso" },
        raGames);
    True(ambiguous is null, "duplicate RetroAchievements titles stay unmatched");

    var noMatch = RetroAchievementsGameMatcher.Find(
        new GameEntry { Id = "ps2:none", ConsoleId = "ps2", Title = "MGS2", LaunchTarget = "MGS2-PS2.ISO" },
        raGames);
    True(noMatch is null, "an abbreviation without a title match stays unmatched");

    var listRequests = 0;
    var profileRequests = 0;
    var progressRequests = 0;
    var fake = new FakeHandler(request =>
    {
        var endpoint = request.RequestUri!.AbsolutePath;
        if (endpoint.EndsWith("API_GetUserProfile.php", StringComparison.Ordinal))
        {
            profileRequests++;
            return Json("""
                {"User":"gonzalo","ULID":"01ABC","TotalPoints":4200,"TotalSoftcorePoints":120}
                """);
        }

        if (endpoint.EndsWith("API_GetGameList.php", StringComparison.Ordinal))
        {
            listRequests++;
            return Json("""
                [
                  {"ID":101,"Title":"Cars","NumAchievements":5,"Points":300},
                  {"ID":102,"Title":"Gran Turismo 4","NumAchievements":100,"Points":1000}
                ]
                """);
        }

        if (endpoint.EndsWith("API_GetGameInfoAndUserProgress.php", StringComparison.Ordinal))
        {
            progressRequests++;
            return Json("""
                {
                  "ID":101,
                  "Title":"Cars",
                  "NumAchievements":5,
                  "NumAwardedToUser":2,
                  "Achievements":{
                    "1":{"Points":100,"DateEarned":"2025-01-01 10:00:00","DateEarnedHardcore":null},
                    "2":{"Points":50,"DateEarned":null,"DateEarnedHardcore":"2025-01-02 10:00:00"},
                    "3":{"Points":25,"DateEarned":null,"DateEarnedHardcore":null},
                    "4":{"Points":25,"DateEarned":null,"DateEarnedHardcore":null},
                    "5":{"Points":100,"DateEarned":null,"DateEarnedHardcore":null}
                  }
                }
                """);
        }

        return new HttpResponseMessage(HttpStatusCode.NotFound);
    });

    var raSettings = new RetroAchievementsSettings("gonzalo", "secret-key");
    using var raHttp = new HttpClient(fake);
    var raCache = Path.Combine(root, "ra-cache");
    var client = new RetroAchievementsClient(raHttp, raCache, raSettings, TimeSpan.Zero);

    var account = await client.GetAccountAsync(CancellationToken.None);
    Equal("gonzalo", account.User, "RetroAchievements profile username");
    EqualNumber(4200, account.TotalPoints, "RetroAchievements profile points");
    EqualNumber(1, profileRequests, "profile requested once");

    var gameList = await client.GetGameListAsync(21, CancellationToken.None);
    EqualNumber(2, gameList.Count, "RetroAchievements game list is parsed");
    EqualNumber(1, listRequests, "game list requested once");
    True(File.Exists(Path.Combine(raCache, "games-21.json")), "game list cache is written to disk");

    _ = await client.GetGameListAsync(21, CancellationToken.None);
    EqualNumber(1, listRequests, "fresh game list cache avoids a second request");

    var progress = await client.GetProgressAsync(101, CancellationToken.None);
    EqualNumber(2, progress.Earned, "achievement earned count is parsed");
    EqualNumber(5, progress.Total, "achievement total is parsed");
    EqualNumber(150, progress.Points, "earned achievement points are summed");
    EqualNumber(1, progressRequests, "progress requested once");

    var unauthorized = new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized));
    using var unauthorizedHttp = new HttpClient(unauthorized);
    var rejected = new RetroAchievementsClient(
        unauthorizedHttp,
        Path.Combine(root, "ra-rejected"),
        raSettings,
        TimeSpan.Zero);
    var authFailure = false;
    try
    {
        _ = await rejected.GetAccountAsync(CancellationToken.None);
    }
    catch (RetroAchievementsException ex) when (ex.IsAuthFailure)
    {
        authFailure = true;
    }
    True(authFailure, "401 is classified as an authentication failure");

    var apiError = new FakeHandler(_ => Json("""
        {"Error":"Invalid game ID"}
        """));
    using var apiErrorHttp = new HttpClient(apiError);
    var invalidGame = new RetroAchievementsClient(
        apiErrorHttp,
        Path.Combine(root, "ra-invalid-game"),
        raSettings,
        TimeSpan.Zero);
    var apiErrorClassified = false;
    var apiErrorWasAuth = false;
    try
    {
        _ = await invalidGame.GetGameListAsync(21, CancellationToken.None);
    }
    catch (RetroAchievementsException ex)
    {
        apiErrorClassified = true;
        apiErrorWasAuth = ex.IsAuthFailure;
    }
    True(apiErrorClassified, "an API error is surfaced");
    True(!apiErrorWasAuth, "a non-credential API error does not unlink the account");

    var cachePath = Path.Combine(raCache, "games-21.json");
    File.WriteAllText(cachePath, """
        {"cacheVersion":1,"fetchedAt":"2020-01-01T00:00:00+00:00","games":[{"id":77,"title":"Cached Game","numAchievements":3,"points":30}]}
        """);
    var stale = new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError));
    using var staleHttp = new HttpClient(stale);
    var staleClient = new RetroAchievementsClient(staleHttp, raCache, raSettings, TimeSpan.Zero);
    var staleGames = await staleClient.GetGameListAsync(21, CancellationToken.None);
    EqualNumber(1, staleGames.Count, "a stale game list survives a transient failure");
    Equal("Cached Game", staleGames[0].Title, "the stale game list is the cached one");

    var malformed = new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
    {
        Content = new StringContent("<html>not json</html>"),
    });
    using var malformedHttp = new HttpClient(malformed);
    var malformedClient = new RetroAchievementsClient(malformedHttp, raCache, raSettings, TimeSpan.Zero);
    var malformedGames = await malformedClient.GetGameListAsync(21, CancellationToken.None);
    EqualNumber(1, malformedGames.Count, "a stale game list survives malformed JSON");

    using var serviceHttp = new HttpClient(fake);
    using var service = new RetroAchievementsService(
        Path.Combine(root, "ra-service"),
        serviceHttp,
        TimeSpan.Zero);
    var ps2 = new ConsoleDescriptor { Id = "ps2", Name = "PlayStation 2" };
    var ds = new ConsoleDescriptor { Id = "ds", Name = "Nintendo DS" };
    var cars = new GameEntry
    {
        Id = "ps2:cars",
        ConsoleId = "ps2",
        Title = "Cars",
        LaunchTarget = "CarsPS2.iso",
    };

    Equal("notLinked", service.ForLibrary(ps2, cars).State, "unlinked supported console is notLinked");
    service.Configure(raSettings);
    var linkedWithoutProgress = service.ForLibrary(ps2, cars);
    Equal("linked", linkedWithoutProgress.State, "linked console is linked");
    True(linkedWithoutProgress.Total is null, "linked console waits for progress");
    Equal("notSupported", service.ForLibrary(ds, cars).State, "unsupported console stays notSupported");

    var serviceProgress = await service.GetForGameAsync(ps2, cars, CancellationToken.None);
    Equal("linked", serviceProgress.State, "service returns linked progress");
    EqualNumber(2, serviceProgress.Earned, "service returns earned count");
    EqualNumber(5, serviceProgress.Total, "service returns total count");
    EqualNumber(150, serviceProgress.Points, "service returns earned points");
    var cachedProgress = service.ForLibrary(ps2, cars);
    EqualNumber(2, cachedProgress.Earned, "library reuses cached progress");

    using var rejectServiceHttp = new HttpClient(unauthorized);
    using var rejectService = new RetroAchievementsService(
        Path.Combine(root, "ra-service-rejected"),
        rejectServiceHttp,
        TimeSpan.Zero);
    rejectService.Configure(raSettings);
    var rejectedProgress = await rejectService.GetForGameAsync(ps2, cars, CancellationToken.None);
    Equal("notLinked", rejectedProgress.State, "authentication failure flips the rail to notLinked");
    True(rejectService.IsAuthRejected, "service remembers an authentication failure");

    var pcsx2Version = EmulatorVersion.Parse("v2.9.131");
    True(pcsx2Version is not null, "PCSX2 release tag parses");
    EqualNumber(0, EmulatorVersion.Compare(pcsx2Version!, EmulatorVersion.Parse("2.9.131.0")!), "PCSX2 file version matches tag");
    True(EmulatorVersion.Compare(EmulatorVersion.Parse("v2.9.132")!, pcsx2Version!) > 0, "PCSX2 newer tag compares newer");

    EqualNumber(11894, EmulatorVersion.ParseDuckStationBuild("v0.1-11894") ?? -1, "DuckStation tag build parses");
    EqualNumber(12083, EmulatorVersion.ParseDuckStationBuild("0.1.12083") ?? -1, "DuckStation file build parses");

    var dolphinVersion = EmulatorVersion.ParseDolphin("Dolphin 2609a");
    True(dolphinVersion is not null, "Dolphin version parses");
    EqualNumber(2609, dolphinVersion!.Value.Number, "Dolphin release number");
    True(dolphinVersion.Value.Suffix == 'a', "Dolphin release suffix");
    True(EmulatorVersion.CompareDolphin((2609, 'a'), (2609, 'b')) < 0, "Dolphin suffix ordering");

    Equal("0.0.43-20355", EmulatorVersion.ParseRpcs3("RPCS3 0.0.43-20355-4024ea31 Alpha"), "RPCS3 version parses");
    Equal("0.9.13", EmulatorVersion.FromFileName(@"C:\Emulation\Desmume\DeSmuME_0.9.13_x64.exe"), "DeSmuME file version");
    True(EmulatorVersion.ParseFlexible("release_0_9_13") == new Version(0, 9, 13), "DeSmuME release tag parses");

    True(EmulatorProfile.Detect(@"C:\Emulation\Duckstation\duckstation-qt-x64-ReleaseLTCG.exe") == EmulatorKind.DuckStation, "DuckStation is detected");
    True(EmulatorProfile.Detect(@"C:\Emulation\PCSX2\pcsx2-qt.exe") == EmulatorKind.Pcsx2, "PCSX2 is detected");
    True(EmulatorProfile.Detect(@"C:\Emulation\Dolphin\Dolphin.exe") == EmulatorKind.Dolphin, "Dolphin is detected");
    True(EmulatorProfile.Detect(@"C:\Emulation\xenia_manager\Emulators\Xenia Canary\xenia_canary.exe") == EmulatorKind.XeniaCanary, "Xenia is detected");

    Console.WriteLine("Settings, play stats, version, emulator profile and RetroAchievements tests passed.");
}
finally
{
    try { Directory.Delete(root, true); } catch { }
}

static HttpResponseMessage Json(string json) => new(HttpStatusCode.OK)
{
    Content = new StringContent(json, Encoding.UTF8, "application/json"),
};

static void Equal(string expected, string? actual, string name)
{
    if (expected != actual) throw new Exception($"{name}: expected '{expected}', got '{actual}'");
}

static void EqualNumber(long expected, long? actual, string name)
{
    if (actual != expected) throw new Exception($"{name}: expected {expected}, got {actual?.ToString() ?? "null"}");
}

static void EqualArray(double[] expected, double[] actual, string name)
{
    if (!expected.SequenceEqual(actual))
    {
        throw new Exception($"{name}: expected [{string.Join(", ", expected)}], got [{string.Join(", ", actual)}]");
    }
}

static void True(bool condition, string name)
{
    if (!condition) throw new Exception($"{name}: assertion failed");
}

static void Throws<T>(Action action, string name) where T : Exception
{
    try { action(); }
    catch (T) { return; }
    throw new Exception($"{name}: expected {typeof(T).Name}");
}

static void ThrowsAny(Action action, string name)
{
    try { action(); }
    catch { return; }
    throw new Exception($"{name}: expected a write failure");
}

sealed class FakeHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, HttpResponseMessage> _responder;

    public FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) => _responder = responder;

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        return Task.FromResult(_responder(request));
    }
}
