using System.Text.Json;

namespace Aisles.App.Bridge;

/// <summary>
/// Envelope for every message crossing the host/web boundary (PLAN.md section 5.2).
/// The payload is left as a <see cref="JsonElement"/> so each message type reads
/// only the fields it expects.
/// </summary>
public sealed record BridgeMessage(string Type, JsonElement? Payload)
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public static BridgeMessage? Parse(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<BridgeMessage>(json, Options);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Reads a string property from the payload object, or null if absent.</summary>
    public string? ReadString(string property)
    {
        if (Payload is not { } payload || payload.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return payload.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }
}
