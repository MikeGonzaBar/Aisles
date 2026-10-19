using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Aisles.App.Bridge;

/// <summary>
/// Thin transport over the WebView2 message channel. Owns serialisation only;
/// message dispatch lives with the window so the protocol stays easy to read.
/// </summary>
public sealed class WebBridge
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private CoreWebView2? _core;

    public void Attach(CoreWebView2 core, Action<string> onMessageFromWeb)
    {
        _core = core;
        core.WebMessageReceived += (_, args) => onMessageFromWeb(args.WebMessageAsJson);
    }

    public void Send(string type, object? payload = null)
    {
        var message = JsonSerializer.Serialize(new BridgeOutbound(type, payload), Options);
        _core?.PostWebMessageAsJson(message);
    }

    private sealed record BridgeOutbound(string Type, object? Payload);
}
