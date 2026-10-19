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

    Console.WriteLine("Settings tests passed (11 assertions).");
}
finally
{
    try { Directory.Delete(root, true); } catch { }
}

static void Equal(string expected, string actual, string name)
{
    if (expected != actual) throw new Exception($"{name}: expected '{expected}', got '{actual}'");
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
