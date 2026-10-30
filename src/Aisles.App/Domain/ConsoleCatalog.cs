using System.Text.Json;

namespace Aisles.App.Domain;

/// <summary>The user-editable platform list that drives everything.</summary>
public sealed class ConsoleCatalog
{
    public List<ConsoleDescriptor> Consoles { get; set; } = new();

    public static ConsoleCatalog Load(string path)
    {
        var json = File.ReadAllText(path);

        var options = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true,
        };

        return JsonSerializer.Deserialize<ConsoleCatalog>(json, options)
            ?? throw new InvalidDataException($"Consoles file contained no catalog: {path}");
    }
}
