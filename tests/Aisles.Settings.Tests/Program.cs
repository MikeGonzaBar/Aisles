using System.Buffers.Binary;
using System.Net;
using System.Text;
using Aisles.App.Bridge;
using Aisles.App.Domain;
using Aisles.App.Ps3Trophies;
using Aisles.App.RetroAchievements;

var root = Path.Combine(Path.GetTempPath(), "aisles-settings-tests", Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
try
{
    var defaults = new ConsoleCatalog { Consoles = [new ConsoleDescriptor
    {
        Id = "ps1", Name = "PlayStation", GamesPath = @"C:\Games", EmulatorPath = @"C:\Emu\emu.exe",
        ArtworkPath = @"C:\Covers", CorePath = @"C:\Emu\cores\core.dll"
    }] };
    var path = Path.Combine(root, "settings.json");
    var store = new ConsoleSettingsStore(path);

    store.Save(defaults, new Dictionary<string, ConsolePathDraft>
    {
        ["ps1"] = new(@"D:\Games", @"C:\Emu\emu.exe", @"C:\Covers", @"D:\Cores\core.dll")
    });
    var merged = store.Apply(defaults);
    Equal(@"D:\Games", merged.Catalog.Consoles[0].GamesPath, "override merging");
    Equal(@"D:\Cores\core.dll", merged.Catalog.Consoles[0].CorePath, "core path override merging");
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

    var retroArchStats = PlayStatsReader.ParseRetroArch(
        "{\"version\":\"1.0\",\"runtime\":\"1:02:03\",\"last_played\":\"2026-10-21 15:00:16\"}");
    EqualNumber(3723, retroArchStats.Seconds, "RetroArch runtime becomes seconds");
    Equal("21 Oct 2026", retroArchStats.LastPlayed, "RetroArch last played is a date");
    Equal("RetroArch runtime log", retroArchStats.Source, "RetroArch runtime source is named");

    var retroArchRoot = Path.Combine(root, "RetroArch");
    var retroArchLogDirectory = Path.Combine(retroArchRoot, "playlists", "logs", "melonDS DS");
    Directory.CreateDirectory(retroArchLogDirectory);
    File.WriteAllText(
        Path.Combine(retroArchLogDirectory, "Mario Kart DS.lrtl"),
        "{\"runtime\":\"0:00:27\",\"last_played\":\"2026-10-21 15:00:16\"}");
    var discoveredRetroArchStats = new PlayStatsReader().For(
        new ConsoleDescriptor { Id = "ds", EmulatorPath = Path.Combine(retroArchRoot, "retroarch.exe") },
        null,
        Path.Combine(root, "Mario Kart DS.nds"));
    EqualNumber(27, discoveredRetroArchStats.Seconds, "RetroArch runtime log is discovered by ROM name");

    var ps1Support = new ConsoleDescriptor { Id = "ps1" };
    var ps2Support = new ConsoleDescriptor { Id = "ps2" };
    var gameCubeSupport = new ConsoleDescriptor { Id = "gamecube" };
    var wiiSupport = new ConsoleDescriptor { Id = "wii" };
    var standaloneDs = new ConsoleDescriptor { Id = "ds", EmulatorPath = @"C:\Emulation\DeSmuME.exe" };
    var retroArchDs = new ConsoleDescriptor
    {
        Id = "ds",
        EmulatorPath = @"C:\RetroArch-Win64\retroarch.exe",
        CorePath = @"C:\RetroArch-Win64\cores\melondsds_libretro.dll",
    };
    var ps3Support = new ConsoleDescriptor { Id = "ps3" };
    Equal("notLinked", RetroAchievementsSupport.StateFor(ps2Support), "PS2 has RetroAchievements support");
    Equal("notLinked", RetroAchievementsSupport.StateFor(gameCubeSupport), "GameCube has RetroAchievements support");
    Equal("notSupported", RetroAchievementsSupport.StateFor(standaloneDs), "standalone DS has no RetroAchievements support");
    Equal("notLinked", RetroAchievementsSupport.StateFor(retroArchDs), "RetroArch DS has RetroAchievements support");
    Equal("notSupported", RetroAchievementsSupport.StateFor(ps3Support), "PS3 has no RetroAchievements support");
    EqualNumber(12, RetroAchievementsSupport.SystemIdFor(ps1Support) ?? -1, "PS1 RetroAchievements system ID");
    EqualNumber(21, RetroAchievementsSupport.SystemIdFor(ps2Support) ?? -1, "PS2 RetroAchievements system ID");
    EqualNumber(16, RetroAchievementsSupport.SystemIdFor(gameCubeSupport) ?? -1, "GameCube RetroAchievements system ID");
    EqualNumber(19, RetroAchievementsSupport.SystemIdFor(wiiSupport) ?? -1, "Wii RetroAchievements system ID");
    EqualNumber(18, RetroAchievementsSupport.SystemIdFor(retroArchDs) ?? -1, "DS RetroAchievements system ID");
    True(RetroAchievementsSupport.SystemIdFor(standaloneDs) is null, "standalone DS has no RetroAchievements system ID");

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
                    "1":{"ID":1,"Title":"First Win","Description":"Win your first race.","Points":100,"BadgeName":"1001","DisplayOrder":10,"DateEarned":"2025-01-01 10:00:00","DateEarnedHardcore":null},
                    "2":{"ID":2,"Title":"Hardcore Win","Description":"Win without assists.","Points":50,"BadgeName":"1002","DisplayOrder":20,"DateEarned":null,"DateEarnedHardcore":"2025-01-02 10:00:00"},
                    "3":{"ID":3,"Title":"Third Place","Description":"Finish on the podium.","Points":25,"BadgeName":"1003","DisplayOrder":30,"DateEarned":null,"DateEarnedHardcore":null},
                    "4":{"ID":4,"Title":"Collector","Description":"Find every shortcut.","Points":25,"BadgeName":"1004","DisplayOrder":40,"DateEarned":null,"DateEarnedHardcore":null},
                    "5":{"ID":5,"Title":"Champion","Description":"Win the championship.","Points":100,"BadgeName":"1005","DisplayOrder":50,"DateEarned":null,"DateEarnedHardcore":null}
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
    EqualNumber(5, progress.Achievements.Count, "per-achievement details are retained");
    Equal("Hardcore Win", progress.Achievements.Single(item => item.Id == 2).Title, "achievement titles are parsed");
    Equal(
        "https://media.retroachievements.org/Badge/1002.png",
        progress.Achievements.Single(item => item.Id == 2).BadgeUrl,
        "earned badges use the colour image");
    Equal(
        "https://media.retroachievements.org/Badge/1003_lock.png",
        progress.Achievements.Single(item => item.Id == 3).BadgeUrl,
        "pending badges use the locked image");
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

    var throttled = new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.TooManyRequests));
    using var throttledHttp = new HttpClient(throttled);
    var rateLimited = new RetroAchievementsClient(
        throttledHttp,
        Path.Combine(root, "ra-throttled"),
        raSettings,
        TimeSpan.Zero);
    var rateLimitSurfaced = false;
    var rateLimitWasAuth = false;
    try
    {
        _ = await rateLimited.GetProgressAsync(101, CancellationToken.None);
    }
    catch (RetroAchievementsException ex)
    {
        rateLimitSurfaced = true;
        rateLimitWasAuth = ex.IsAuthFailure;
    }
    True(rateLimitSurfaced, "429 is surfaced to the rail");
    True(!rateLimitWasAuth, "429 leaves the saved account linked");

    var offline = new FakeHandler(_ => throw new HttpRequestException("offline"));
    using var offlineHttp = new HttpClient(offline);
    var offlineClient = new RetroAchievementsClient(
        offlineHttp,
        Path.Combine(root, "ra-offline"),
        raSettings,
        TimeSpan.Zero);
    var offlineSurfaced = false;
    var offlineWasAuth = false;
    try
    {
        _ = await offlineClient.GetProgressAsync(101, CancellationToken.None);
    }
    catch (RetroAchievementsException ex)
    {
        offlineSurfaced = true;
        offlineWasAuth = ex.IsAuthFailure;
    }
    True(offlineSurfaced, "offline failures are surfaced to the rail");
    True(!offlineWasAuth, "offline failures leave the saved account linked");

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
    True(linkedWithoutProgress.Recent is null && linkedWithoutProgress.Pending is null, "no badges are invented before progress resolves");
    Equal("notSupported", service.ForLibrary(ds, cars).State, "unsupported console stays notSupported");

    var serviceProgress = await service.GetForGameAsync(ps2, cars, CancellationToken.None);
    Equal("linked", serviceProgress.State, "service returns linked progress");
    EqualNumber(2, serviceProgress.Earned, "service returns earned count");
    EqualNumber(5, serviceProgress.Total, "service returns total count");
    EqualNumber(150, serviceProgress.Points, "service returns earned points");
    EqualNumber(2, serviceProgress.Recent?.Count ?? -1, "service returns recent unlocks");
    Equal("Hardcore Win", serviceProgress.Recent![0].Title, "recent unlocks are newest first");
    Equal("2025-01-02", serviceProgress.Recent[0].EarnedOn, "recent unlocks carry their earned date");
    EqualNumber(3, serviceProgress.Pending?.Count ?? -1, "service returns a sample of pending achievements");
    Equal("Third Place", serviceProgress.Pending![0].Title, "pending achievements keep display order");
    Equal(
        "https://media.retroachievements.org/Badge/1003_lock.png",
        serviceProgress.Pending[0].BadgeUrl,
        "pending badge payload keeps the lock image");
    var cachedProgress = service.ForLibrary(ps2, cars);
    EqualNumber(2, cachedProgress.Earned, "library reuses cached progress");
    EqualNumber(2, cachedProgress.Recent?.Count ?? -1, "library reuses cached achievement badges");

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
    Equal("1.22.2", EmulatorVersion.ParseRetroArch("Version: 1.22.2 (Git 69a4f0e)"), "RetroArch version parses");
    Equal("0.9.13", EmulatorVersion.FromFileName(@"C:\Emulation\Desmume\DeSmuME_0.9.13_x64.exe"), "DeSmuME file version");
    True(EmulatorVersion.ParseFlexible("release_0_9_13") == new Version(0, 9, 13), "DeSmuME release tag parses");

    True(EmulatorProfile.Detect(@"C:\Emulation\Duckstation\duckstation-qt-x64-ReleaseLTCG.exe") == EmulatorKind.DuckStation, "DuckStation is detected");
    True(EmulatorProfile.Detect(@"C:\Emulation\PCSX2\pcsx2-qt.exe") == EmulatorKind.Pcsx2, "PCSX2 is detected");
    True(EmulatorProfile.Detect(@"C:\Emulation\Dolphin\Dolphin.exe") == EmulatorKind.Dolphin, "Dolphin is detected");
    True(EmulatorProfile.Detect(@"C:\RetroArch-Win64\retroarch.exe") == EmulatorKind.RetroArch, "RetroArch is detected");
    True(EmulatorProfile.Detect(@"C:\Emulation\xenia_manager\Emulators\Xenia Canary\xenia_canary.exe") == EmulatorKind.XeniaCanary, "Xenia is detected");

    var trophyConfigXml =
        "<trophyconf><trophy id=\"1\" ttype=\"P\" hidden=\"no\" pid=\"0\">"
        + "<name>Platinum</name><detail>Finish everything</detail></trophy>"
        + "<trophy id=\"2\" ttype=\"S\" hidden=\"no\" pid=\"0\">"
        + "<name>Silver</name><detail>Halfway</detail></trophy>"
        + "<trophy id=\"3\" ttype=\"G\" hidden=\"yes\" pid=\"0\">"
        + "<name>Secret</name><detail>Do not spoil</detail></trophy></trophyconf>";
    var trophyConfigBytes = Encoding.UTF8.GetBytes(trophyConfigXml);

    using (var configStream = new MemoryStream(trophyConfigBytes))
    {
        var definitions = Ps3TrophyReader.ParseConfiguration(configStream);
        EqualNumber(3, definitions.Count, "TROPCONF lists every trophy");
        Equal("Platinum", definitions[0].Name, "TROPCONF reads trophy names");
        True(definitions[0].Grade == 'P', "TROPCONF reads trophy grades");
        True(definitions[2].Hidden, "TROPCONF reads hidden flags");
    }

    var packageConfigXml =
        "<trophyconf><trophy id=\"1\" ttype=\"P\" hidden=\"no\" pid=\"0\" />"
        + "<trophy id=\"2\" ttype=\"S\" hidden=\"no\" pid=\"0\" />"
        + "<trophy id=\"3\" ttype=\"G\" hidden=\"yes\" pid=\"0\" /></trophyconf>";
    var packageConfigBytes = Encoding.UTF8.GetBytes(packageConfigXml);

    var packagePath = Path.Combine(root, "TROPHY.TRP");
    using (var package = new MemoryStream())
    {
        var packageHeader = new byte[0x40];
        BinaryPrimitives.WriteUInt32BigEndian(packageHeader, 0xDCA24D00);
        BinaryPrimitives.WriteInt32BigEndian(packageHeader.AsSpan(16), 2);
        BinaryPrimitives.WriteInt32BigEndian(packageHeader.AsSpan(20), 0x40);
        package.Write(packageHeader);

        var configEntry = new byte[0x40];
        Encoding.ASCII.GetBytes("TROPCONF.SFM").CopyTo(configEntry, 0);
        BinaryPrimitives.WriteUInt64BigEndian(configEntry.AsSpan(32), 0xC0);
        BinaryPrimitives.WriteUInt64BigEndian(configEntry.AsSpan(40), (ulong)packageConfigBytes.Length);
        package.Write(configEntry);

        var localisationOffset = 0xC0 + packageConfigBytes.Length;
        var localisationEntry = new byte[0x40];
        Encoding.ASCII.GetBytes("TROP.SFM").CopyTo(localisationEntry, 0);
        BinaryPrimitives.WriteUInt64BigEndian(localisationEntry.AsSpan(32), (ulong)localisationOffset);
        BinaryPrimitives.WriteUInt64BigEndian(localisationEntry.AsSpan(40), (ulong)trophyConfigBytes.Length);
        package.Write(localisationEntry);

        package.Write(packageConfigBytes);
        package.Write(trophyConfigBytes);
        File.WriteAllBytes(packagePath, package.ToArray());
    }

    var packagedDefinitions = Ps3TrophyReader.TryReadPackageConfiguration(packagePath);
    True(packagedDefinitions is { Count: 3 }, "TROPHY.TRP fallback reads definitions");
    Equal("Platinum", packagedDefinitions![0].Name, "TROPHY.TRP names come from TROP.SFM");
    True(packagedDefinitions[2].Hidden, "TROPHY.TRP keeps hidden flags");

    var unlockedAt = new DateTime(2025, 2, 14, 12, 30, 0);
    var progressData = new byte[0x110];
    BinaryPrimitives.WriteUInt32BigEndian(progressData, 0x818F54AD);
    BinaryPrimitives.WriteUInt32BigEndian(progressData.AsSpan(8), 1);
    BinaryPrimitives.WriteUInt32BigEndian(progressData.AsSpan(0x30), 6);
    BinaryPrimitives.WriteUInt32BigEndian(progressData.AsSpan(0x34), 0x30);
    BinaryPrimitives.WriteUInt32BigEndian(progressData.AsSpan(0x3C), 3);
    BinaryPrimitives.WriteUInt64BigEndian(progressData.AsSpan(0x40), 0x50);

    BinaryPrimitives.WriteInt32BigEndian(progressData.AsSpan(0x60), 1);
    BinaryPrimitives.WriteUInt32BigEndian(progressData.AsSpan(0x64), 1);
    BinaryPrimitives.WriteUInt64BigEndian(
        progressData.AsSpan(0x78),
        (ulong)(unlockedAt.Ticks / 10));
    BinaryPrimitives.WriteInt32BigEndian(progressData.AsSpan(0xA0), 2);
    BinaryPrimitives.WriteInt32BigEndian(progressData.AsSpan(0xE0), 3);

    var trophyProgress = Ps3TrophyReader.ParseProgress(progressData);
    True(trophyProgress[1].Unlocked, "TROPUSR marks an unlocked trophy");
    Equal(
        unlockedAt.ToString("yyyy-MM-dd"),
        trophyProgress[1].EarnedAt?.ToString("yyyy-MM-dd"),
        "TROPUSR unlock timestamps are CellRtc dates");
    True(!trophyProgress[2].Unlocked && trophyProgress[2].EarnedAt is null, "TROPUSR leaves locked trophies dateless");
    Equal(
        "2025-02-14",
        Ps3TrophyReader.CellRtcDate((ulong)(unlockedAt.Ticks / 10))?.ToString("yyyy-MM-dd"),
        "CellRtc ticks become dates");

    var trophyRoot = Path.Combine(root, "rpcs3");
    var devHdd0 = Path.Combine(trophyRoot, "dev_hdd0");
    var gameDirectory = Path.Combine(root, "ps3-games", "BCUS98148");
    var trophyDirectory = Path.Combine(gameDirectory, "TROPDIR", "NPWR00001_00");
    Directory.CreateDirectory(trophyDirectory);
    File.WriteAllBytes(Path.Combine(trophyDirectory, "TROPCONF.SFM"), trophyConfigBytes);

    var userTrophyDirectory = Path.Combine(devHdd0, "home", "00000001", "trophy", "NPWR00001_00");
    Directory.CreateDirectory(userTrophyDirectory);
    File.WriteAllBytes(Path.Combine(userTrophyDirectory, "TROPUSR.DAT"), progressData);
    File.WriteAllBytes(Path.Combine(userTrophyDirectory, "TROP001.PNG"), [0x89, 0x50, 0x4E, 0x47]);

    var ps3 = new ConsoleDescriptor
    {
        Id = "ps3",
        Name = "PlayStation 3",
        EmulatorPath = Path.Combine(trophyRoot, "rpcs3.exe"),
        GamesPath = Path.Combine(root, "ps3-games"),
    };
    var littleBigPlanet = new GameEntry
    {
        Id = "ps3:littlebigplanet",
        ConsoleId = "ps3",
        Title = "LittleBigPlanet",
        LaunchTarget = gameDirectory,
        Serial = "BCUS98148",
    };

    Equal(
        Path.Combine(devHdd0, "home"),
        Ps3TrophyService.TrophyHomeRoot(ps3),
        "RPCS3 trophy home is the icon root");

    var local = new Ps3TrophyService().ForGame(ps3, littleBigPlanet);
    Equal("local", local.State, "PS3 trophies use the local state");
    EqualNumber(1, local.Earned, "PS3 earned trophy count");
    EqualNumber(3, local.Total, "PS3 total trophy count");
    True(local.Points is null, "PS3 does not invent RetroAchievements points");
    Equal("rpcs3", local.Source, "PS3 names its source");
    Equal("trophies", local.Unit, "PS3 counts trophies");
    Equal("RPCS3 trophy data", local.Note, "PS3 names the local source in the note");
    Equal("Platinum", local.Recent?[0].Title, "PS3 recent unlocks are read from TROPUSR");
    Equal("2025-02-14", local.Recent?[0].EarnedOn, "PS3 recent unlocks carry their date");
    EqualNumber(180, local.Recent?[0].Points ?? -1, "Platinum trophy points");
    Equal(
        "https://trophies.aisles.local/00000001/trophy/NPWR00001_00/TROP001.PNG",
        local.Recent?[0].BadgeUrl,
        "PS3 trophy icon URL");
    Equal("Hidden trophy", local.Pending?[1].Title, "PS3 hides locked trophy names");
    EqualNumber(90, local.Pending?[1].Points ?? -1, "Gold trophy points");

    var missingTrophies = new Ps3TrophyService().ForGame(ps3, new GameEntry
    {
        Id = "ps3:no-trophies",
        ConsoleId = "ps3",
        Title = "No Trophies",
        LaunchTarget = Path.Combine(root, "ps3-games", "BLUS00000"),
        Serial = "BLUS00000",
    });
    Equal("noTrophies", missingTrophies.State, "a game without trophy data says so");
    True(
        missingTrophies.Earned is null && missingTrophies.Total is null,
        "noTrophies does not fabricate counts");

    Console.WriteLine("Settings, play stats, version, emulator profile, RetroAchievements and PS3 trophy tests passed.");
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
