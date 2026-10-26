using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Aisles.App.Domain;

/// <summary>The serial/ROM code a provider matches on, plus the region it implies.</summary>
public sealed record GameIdentity(string? Id, string? Region);

/// <summary>
/// Recovers identities some platforms only store on disk: PS1's serial in the data track,
/// Wii's game ID and region in the disc header. Both run outside the scan because both cost I/O.
/// </summary>
public static class GameIdentityReader
{
    private static readonly Regex PsSerialPattern = new(
        "(S[A-Z]{3})[_-]?(\\d{3})[._-]?(\\d{2})",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>
    /// Maps an ID prefix to the provider's region wording. The DS game code carries its
    /// region in the last character, while PlayStation serials carry it in the prefix.
    /// </summary>
    public static string? RegionFromId(string consoleId, string? id)
    {
        var value = (id ?? string.Empty).Trim().ToUpperInvariant();

        if (value.Length == 0)
        {
            return null;
        }

        if (consoleId.Equals("ds", StringComparison.OrdinalIgnoreCase) && value.Length == 4)
        {
            return value[3] switch
            {
                'E' => "North America",
                'P' => "Europe",
                'J' => "Japan",
                _ => null,
            };
        }

        if (value.StartsWith("SCUS", StringComparison.Ordinal)
            || value.StartsWith("SLUS", StringComparison.Ordinal)
            || value.StartsWith("BCUS", StringComparison.Ordinal)
            || value.StartsWith("BLUS", StringComparison.Ordinal)
            || value.StartsWith("NPUA", StringComparison.Ordinal)
            || value.StartsWith("NPEA", StringComparison.Ordinal))
        {
            return "North America";
        }

        if (value.StartsWith("SCES", StringComparison.Ordinal)
            || value.StartsWith("SLES", StringComparison.Ordinal)
            || value.StartsWith("BCES", StringComparison.Ordinal)
            || value.StartsWith("BLES", StringComparison.Ordinal)
            || value.StartsWith("NPEB", StringComparison.Ordinal)
            || value.StartsWith("NPEE", StringComparison.Ordinal))
        {
            return "Europe";
        }

        if (value.StartsWith("SCPS", StringComparison.Ordinal)
            || value.StartsWith("SLPS", StringComparison.Ordinal)
            || value.StartsWith("SLPM", StringComparison.Ordinal)
            || value.StartsWith("SLED", StringComparison.Ordinal)
            || value.StartsWith("BCJS", StringComparison.Ordinal)
            || value.StartsWith("BLJS", StringComparison.Ordinal)
            || value.StartsWith("BLJM", StringComparison.Ordinal)
            || value.StartsWith("NPJB", StringComparison.Ordinal)
            || value.StartsWith("NPJA", StringComparison.Ordinal))
        {
            return "Japan";
        }

        return null;
    }

    /// <summary>Maps a DolphinTool header region or country to the provider's wording.</summary>
    public static string? RegionFromHeader(string? region, string? country)
    {
        var value = $"{region} {country}".ToUpperInvariant();

        if (Regex.IsMatch(value, "NTSC-U|USA|NORTH AMERICA"))
        {
            return "North America";
        }

        if (Regex.IsMatch(value, "PAL|EUROPE"))
        {
            return "Europe";
        }

        if (Regex.IsMatch(value, "NTSC-J|JAPAN"))
        {
            return "Japan";
        }

        return null;
    }

    /// <summary>
    /// Reads the first megabytes of a PS1 data track for its serial. The cue's FILE line
    /// wins when rips keep several bins; the folder's first bin is the fallback.
    /// </summary>
    public static string? Ps1Serial(string cuePath)
    {
        try
        {
            var folder = Path.GetDirectoryName(cuePath);

            if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder))
            {
                return null;
            }

            string? bin = null;

            if (File.Exists(cuePath))
            {
                var cue = File.ReadAllText(cuePath);
                var match = Regex.Match(cue, "FILE\\s+\"([^\"]+\\.bin)\"", RegexOptions.IgnoreCase);
                if (match.Success)
                {
                    var named = Path.Combine(folder, match.Groups[1].Value);
                    if (File.Exists(named))
                    {
                        bin = named;
                    }
                }
            }

            bin ??= Directory.EnumerateFiles(folder, "*.bin").FirstOrDefault();

            if (bin is null)
            {
                return null;
            }

            using var stream = File.OpenRead(bin);
            var length = (int)Math.Min(stream.Length, 8L * 1024 * 1024);
            var buffer = new byte[length];
            stream.ReadExactly(buffer);

            var text = Encoding.Latin1.GetString(buffer);
            var serial = PsSerialPattern.Match(text);

            return serial.Success
                ? $"{serial.Groups[1].Value}-{serial.Groups[2].Value}{serial.Groups[3].Value}"
                : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>
    /// Asks DolphinTool for an RVZ/WIA header; it ships beside Dolphin.exe, so the configured
    /// emulator path is the only place worth looking. A missing tool leaves generated artwork.
    /// </summary>
    public static async Task<GameIdentity?> DolphinHeaderAsync(
        ConsoleDescriptor console,
        string file,
        CancellationToken cancellationToken)
    {
        var tool = Path.Combine(
            Path.GetDirectoryName(console.EmulatorPath) ?? string.Empty,
            "DolphinTool.exe");

        if (!File.Exists(tool) || !File.Exists(file))
        {
            return null;
        }

        var start = new ProcessStartInfo(tool)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        start.ArgumentList.Add("header");
        start.ArgumentList.Add("-i");
        start.ArgumentList.Add(file);
        start.ArgumentList.Add("-j");

        using var process = Process.Start(start);

        if (process is null)
        {
            return null;
        }

        var output = process.StandardOutput.ReadToEndAsync(cancellationToken);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(8));

        try
        {
            await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            try
            {
                process.Kill(entireProcessTree: true);
            }
            catch (Exception)
            {
                // Already gone.
            }

            return null;
        }

        if (process.ExitCode != 0)
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(await output.ConfigureAwait(false));
            var root = document.RootElement;

            var id = root.TryGetProperty("game_id", out var idElement) ? idElement.GetString() : null;
            var region = root.TryGetProperty("region", out var regionElement) ? regionElement.GetString() : null;
            var country = root.TryGetProperty("country", out var countryElement) ? countryElement.GetString() : null;

            return new GameIdentity(id, RegionFromHeader(region, country));
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
