using System.Text.Json;
using System.Text.Json.Serialization;

namespace Aisles.App.Domain;

/// <summary>
/// The artwork cache's index, in the same shape the workshop wrote it
/// (<c>tools/artwork-workshop.cjs</c>). Keeping the shape means an existing
/// <c>.cache/artwork</c> can be copied into the app without a migration, and the
/// workshop remains usable as a review tool.
///
/// One entry per game, keyed by a hash of platform and resolved launch target, so a
/// rescanned library finds its candidates again even when the display title changes.
/// The extra <see cref="ArtworkIndexEntry.SearchTitle"/> and
/// <see cref="ArtworkIndexEntry.SearchRegion"/> fields are Aisles' addition: if the
/// user renames a folder, the next pass knows the old search no longer describes it.
/// </summary>
public sealed class ArtworkIndex
{
    public int Version { get; set; } = 1;

    public Dictionary<string, ArtworkIndexEntry> Games { get; set; } = new(StringComparer.Ordinal);

    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true,
    };

    public static ArtworkIndex Load(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                return JsonSerializer.Deserialize<ArtworkIndex>(File.ReadAllText(path), Options)
                    ?? new ArtworkIndex();
            }
        }
        catch (Exception)
        {
            // A corrupt index is a cold cache, not a failure to start.
        }

        return new ArtworkIndex();
    }

    public string Serialize() => JsonSerializer.Serialize(this, Options);

    public void Save(string path)
    {
        var folder = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(folder);

        var temporary = path + ".tmp";
        File.WriteAllText(temporary, Serialize());
        File.Move(temporary, path, overwrite: true);
    }
}

public sealed class ArtworkIndexEntry
{
    public List<ArtworkCandidate> Candidates { get; set; } = new();

    public Dictionary<string, string> Selections { get; set; } = new(StringComparer.Ordinal);

    public string? SearchedAt { get; set; }

    public List<string> Errors { get; set; } = new();

    /// <summary>When the last provider pass ran, and under which title and region.</summary>
    public string? SearchTitle { get; set; }

    public string? SearchRegion { get; set; }

    /// <summary>
    /// The disc serial or ROM game code used for exact-ID providers. PS1 and Wii need
    /// disk reads or a DolphinTool call to discover theirs, so the answer is kept.
    /// </summary>
    public string? IdentityId { get; set; }

    public string? IdentityRegion { get; set; }
}

/// <summary>One candidate image, before or after it is cached.</summary>
public sealed class ArtworkCandidate
{
    public string Id { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public string SourceUrl { get; set; } = string.Empty;
    public string? Page { get; set; }
    public string? Title { get; set; }
    public string? Platform { get; set; }
    public string? Region { get; set; }
    public string Kind { get; set; } = string.Empty;
    public string? ExactId { get; set; }
    public string? PrintedId { get; set; }
    public string? File { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public string? Match { get; set; }
    public string? Conflict { get; set; }
    public string? QualityNote { get; set; }
    public bool EditionUnverified { get; set; }
    public bool PreparationRequired { get; set; }

    /// <summary>Source-image rectangle for a sticker crop: x, y, width, height.</summary>
    public double[]? LabelRect { get; set; }

    public string? Label { get; set; }

    public ArtworkCandidate Copy() => (ArtworkCandidate)MemberwiseClone();
}
