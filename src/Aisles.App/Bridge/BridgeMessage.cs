using System.Text.Json;

namespace Aisles.App.Bridge;

/// <summary>
/// Envelope for every host/web message (PLAN.md section 5.2). The payload stays a
/// <see cref="JsonElement"/> so each message reads only the fields it expects.
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

    /// <summary>Reads a boolean property from the payload object, or false if absent.</summary>
    public bool ReadBool(string property)
    {
        if (Payload is not { } payload || payload.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        return payload.TryGetProperty(property, out var value)
            && value.ValueKind is JsonValueKind.True or JsonValueKind.False
            && value.GetBoolean();
    }

    public JsonElement? ReadElement(string property)
    {
        if (Payload is not { } payload || payload.ValueKind != JsonValueKind.Object) return null;
        return payload.TryGetProperty(property, out var value) ? value : null;
    }
}
