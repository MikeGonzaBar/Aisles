using System.Text.Json;

namespace Aisles.App.Domain;

public sealed record ConsolePathDraft(string GamesPath, string EmulatorPath, string ArtworkPath);

public sealed record PathValidation(string State, string? Error = null);

public sealed class ConsoleSettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public ConsoleSettingsStore(string path) => Path = path;

    public string Path { get; }

    public (ConsoleCatalog Catalog, string? Error) Apply(ConsoleCatalog defaults)
    {
        var catalog = Clone(defaults);
        if (!File.Exists(Path)) return (catalog, null);

        try
        {
            var file = JsonSerializer.Deserialize<SettingsFile>(File.ReadAllText(Path), JsonOptions)
                ?? throw new InvalidDataException("Settings file was empty.");
            if (file.SchemaVersion != 1) throw new InvalidDataException($"Unsupported settings schema {file.SchemaVersion}.");

            foreach (var console in catalog.Consoles)
            {
                if (!file.Consoles.TryGetValue(console.Id, out var item)) continue;
                if (item.GamesPath is not null) console.GamesPath = item.GamesPath;
                if (item.EmulatorPath is not null) console.EmulatorPath = item.EmulatorPath;
                if (item.ArtworkPath is not null) console.ArtworkPath = item.ArtworkPath;
            }
            return (catalog, null);
        }
        catch (Exception ex) when (ex is IOException or JsonException or InvalidDataException)
        {
            return (catalog, $"Could not read saved settings: {ex.Message}");
        }
    }

    public IReadOnlyDictionary<string, IReadOnlyDictionary<string, PathValidation>> Validate(
        ConsoleCatalog defaults,
        IReadOnlyDictionary<string, ConsolePathDraft> drafts)
    {
        var known = defaults.Consoles.Select(c => c.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var result = new Dictionary<string, IReadOnlyDictionary<string, PathValidation>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (id, draft) in drafts)
        {
            if (!known.Contains(id)) continue;
            result[id] = new Dictionary<string, PathValidation>
            {
                ["gamesPath"] = ValidatePath(draft.GamesPath, false),
                ["emulatorPath"] = ValidatePath(draft.EmulatorPath, true),
                ["artworkPath"] = ValidatePath(draft.ArtworkPath, false),
            };
        }
        return result;
    }

    public void Save(ConsoleCatalog defaults, IReadOnlyDictionary<string, ConsolePathDraft> drafts)
    {
        var known = defaults.Consoles.Select(c => c.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var unknown = drafts.Keys.FirstOrDefault(id => !known.Contains(id));
        if (unknown is not null) throw new InvalidDataException($"Unknown console: {unknown}");
        var validation = Validate(defaults, drafts);
        var invalid = validation.SelectMany(c => c.Value.Select(f => (Console: c.Key, Field: f.Key, Result: f.Value)))
            .FirstOrDefault(x => x.Result.State == "invalid");
        if (invalid.Result is not null)
            throw new InvalidDataException($"{invalid.Console}.{invalid.Field}: {invalid.Result.Error}");

        var file = new SettingsFile();
        foreach (var original in defaults.Consoles)
        {
            if (!drafts.TryGetValue(original.Id, out var draft)) continue;
            var item = new PathOverrides
            {
                GamesPath = Different(draft.GamesPath, original.GamesPath),
                EmulatorPath = Different(draft.EmulatorPath, original.EmulatorPath),
                ArtworkPath = Different(draft.ArtworkPath, original.ArtworkPath ?? string.Empty),
            };
            if (item.GamesPath is not null || item.EmulatorPath is not null || item.ArtworkPath is not null)
                file.Consoles[original.Id] = item;
        }

        var directory = System.IO.Path.GetDirectoryName(Path)!;
        Directory.CreateDirectory(directory);
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

    private static string? Different(string value, string original) => value == original ? null : value;

    private static PathValidation ValidatePath(string value, bool file)
    {
        if (string.IsNullOrWhiteSpace(value)) return new("notConfigured");
        try
        {
            if (!System.IO.Path.IsPathFullyQualified(value)) return new("invalid", "Enter an absolute Windows path.");
            if (value.IndexOfAny(['*', '?', '"', '<', '>', '|']) >= 0) return new("invalid", "This is not a valid Windows path.");
            _ = System.IO.Path.GetFullPath(value);
            return new((file ? File.Exists(value) : Directory.Exists(value)) ? "found" : "notFound");
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return new("invalid", "This is not a valid Windows path.");
        }
    }

    private static ConsoleCatalog Clone(ConsoleCatalog source) => JsonSerializer.Deserialize<ConsoleCatalog>(
        JsonSerializer.Serialize(source, JsonOptions), JsonOptions)!;

    private sealed class SettingsFile
    {
        public int SchemaVersion { get; set; } = 1;
        public Dictionary<string, PathOverrides> Consoles { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private sealed class PathOverrides
    {
        public string? GamesPath { get; set; }
        public string? EmulatorPath { get; set; }
        public string? ArtworkPath { get; set; }
    }
}
