using Aisles.App.Domain;

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

    Equal("notLinked", RetroAchievementsSupport.StateFor("ps2"), "PS2 has RetroAchievements support");
    Equal("notLinked", RetroAchievementsSupport.StateFor("gamecube"), "GameCube has RetroAchievements support");
    Equal("notSupported", RetroAchievementsSupport.StateFor("ds"), "DS has no RetroAchievements support");
    Equal("notSupported", RetroAchievementsSupport.StateFor("ps3"), "PS3 has no RetroAchievements support");

    Console.WriteLine("Settings, play stats and DS sticker tests passed (28 assertions).");
}
finally
{
    try { Directory.Delete(root, true); } catch { }
}

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
