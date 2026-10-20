using System.Globalization;

namespace Aisles.App.Domain;

/// <summary>
/// What the details rail can honestly say about one game's play time. A null
/// <see cref="Seconds"/> means the emulator does not expose a value; <see cref="Reason"/>
/// carries the sentence the rail shows instead of inventing a zero.
/// </summary>
public sealed record PlayStats(long? Seconds, string? LastPlayed, string? Source, string? Reason);

/// <summary>
/// Reads the two emulator-owned play-time caches that exist on this machine
/// (PLAN.md section 3.5): PCSX2's fixed-width <c>inis\playtime.dat</c> and Dolphin's
/// <c>Config\TimePlayed.ini</c>. Both are read once per payload and never written.
///
/// The formats are deliberately parsed from text rather than treated as our storage
/// contract. PCSX2 stores seconds and a Unix timestamp; Dolphin stores milliseconds in
/// hex and no timestamp. Every other configured emulator stores nothing, and the caller
/// gets the sentence that explains why.
/// </summary>
public sealed class PlayStatsReader
{
    private const string Pcsx2Source = "PCSX2 playtime.dat";
    private const string DolphinSource = "Dolphin TimePlayed.ini";

    private readonly Dictionary<string, Dictionary<string, Pcsx2Record>> _pcsx2Files = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Dictionary<string, long>> _dolphinFiles = new(StringComparer.OrdinalIgnoreCase);

    public PlayStats For(ConsoleDescriptor console, string? gameId)
    {
        var id = (gameId ?? string.Empty).Trim().ToUpperInvariant();

        return console.Id.ToLowerInvariant() switch
        {
            "ps2" => ForPcsx2(console, id),
            "wii" or "gamecube" => ForDolphin(console, id),
            "ps1" => Unavailable("DuckStation does not record play time."),
            "ps3" => Unavailable("RPCS3 stores installed paths, not play time."),
            "ds" => Unavailable("DeSmuME does not record play time."),
            "3ds" => Unavailable("Citra does not record play time."),
            "xbox360" => Unavailable("Xenia does not record play time."),
            _ => Unavailable("This emulator does not expose play time."),
        };
    }

    /// <summary>
    /// PCSX2 writes one fixed-width record per line:
    /// <c>SLUS-21151    32387    1765476533</c>. The serial is the key; the second
    /// column is seconds and the third is the last-played Unix timestamp.
    /// </summary>
    public static PlayStats ParsePcsx2(string text, string? gameId)
    {
        var id = (gameId ?? string.Empty).Trim().ToUpperInvariant();
        if (id.Length == 0)
        {
            return new PlayStats(null, null, null, "The game has no disc serial, so PCSX2 cannot match a play-time record.");
        }

        foreach (var line in text.Split('\n'))
        {
            var parts = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2 || !string.Equals(parts[0], id, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!long.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var seconds))
            {
                continue;
            }

            long lastPlayedUnix = 0;
            if (parts.Length > 2)
            {
                _ = long.TryParse(parts[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out lastPlayedUnix);
            }

            if (seconds <= 0)
            {
                return new PlayStats(0, null, Pcsx2Source, "PCSX2 has not recorded a session for this game.");
            }

            return new PlayStats(seconds, FormatLastPlayed(lastPlayedUnix), Pcsx2Source, null);
        }

        return new PlayStats(null, null, Pcsx2Source, "PCSX2 has no playtime record for this game.");
    }

    /// <summary>
    /// Dolphin writes a single <c>[TimePlayed]</c> section whose values are milliseconds
    /// in hex (<c>RMCE01 = 0x00000000004bfafc</c>). It does not store a last-played time.
    /// </summary>
    public static PlayStats ParseDolphin(string text, string? gameId)
    {
        var id = (gameId ?? string.Empty).Trim().ToUpperInvariant();
        if (id.Length == 0)
        {
            return new PlayStats(null, null, null, "The game ID has not been read yet, so Dolphin's play time cannot be matched.");
        }

        var inSection = false;

        foreach (var rawLine in text.Split('\n'))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith(';') || line.StartsWith('#'))
            {
                continue;
            }

            if (line.StartsWith('['))
            {
                inSection = line.Equals("[TimePlayed]", StringComparison.OrdinalIgnoreCase);
                continue;
            }

            if (!inSection)
            {
                continue;
            }

            var equals = line.IndexOf('=');
            if (equals <= 0)
            {
                continue;
            }

            var key = line[..equals].Trim();
            if (!string.Equals(key, id, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var value = line[(equals + 1)..].Trim();
            if (!TryParseDolphinMilliseconds(value, out var milliseconds))
            {
                return new PlayStats(null, null, DolphinSource, "Dolphin's play-time record is not a valid number.");
            }

            var seconds = milliseconds / 1000;
            return seconds <= 0
                ? new PlayStats(0, null, DolphinSource, "Dolphin has not recorded a session for this game.")
                : new PlayStats(seconds, null, DolphinSource, null);
        }

        return new PlayStats(null, null, DolphinSource, "Dolphin has no play-time record for this game.");
    }

    private PlayStats ForPcsx2(ConsoleDescriptor console, string id)
    {
        if (id.Length == 0)
        {
            return new PlayStats(null, null, null, "The game has no disc serial, so PCSX2 cannot match a play-time record.");
        }

        var file = Pcsx2File(console);
        if (file is null)
        {
            return Unavailable("PCSX2's playtime.dat was not found.");
        }

        if (!_pcsx2Files.TryGetValue(file, out var records))
        {
            records = ReadPcsx2File(file);
            _pcsx2Files[file] = records;
        }

        if (!records.TryGetValue(id, out var record))
        {
            return new PlayStats(null, null, Pcsx2Source, "PCSX2 has no playtime record for this game.");
        }

        if (record.Seconds <= 0)
        {
            return new PlayStats(0, null, Pcsx2Source, "PCSX2 has not recorded a session for this game.");
        }

        return new PlayStats(record.Seconds, FormatLastPlayed(record.LastPlayedUnix), Pcsx2Source, null);
    }

    private PlayStats ForDolphin(ConsoleDescriptor console, string id)
    {
        if (id.Length == 0)
        {
            return new PlayStats(null, null, null, "The game ID has not been read yet, so Dolphin's play time cannot be matched.");
        }

        var file = DolphinFile(console);
        if (file is null)
        {
            return Unavailable("Dolphin's TimePlayed.ini was not found.");
        }

        if (!_dolphinFiles.TryGetValue(file, out var records))
        {
            records = ReadDolphinFile(file);
            _dolphinFiles[file] = records;
        }

        if (!records.TryGetValue(id, out var milliseconds))
        {
            return new PlayStats(null, null, DolphinSource, "Dolphin has no play-time record for this game.");
        }

        var seconds = milliseconds / 1000;
        return seconds <= 0
            ? new PlayStats(0, null, DolphinSource, "Dolphin has not recorded a session for this game.")
            : new PlayStats(seconds, null, DolphinSource, null);
    }

    private static PlayStats Unavailable(string reason) => new(null, null, null, reason);

    private static string? Pcsx2File(ConsoleDescriptor console)
    {
        var emulatorDirectory = Path.GetDirectoryName(console.EmulatorPath);
        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

        return FirstFile(
            string.IsNullOrEmpty(emulatorDirectory) ? null : Path.Combine(emulatorDirectory, "inis", "playtime.dat"),
            Path.Combine(documents, "PCSX2", "inis", "playtime.dat"),
            Path.Combine(appData, "PCSX2", "inis", "playtime.dat"));
    }

    private static string? DolphinFile(ConsoleDescriptor console)
    {
        var emulatorDirectory = Path.GetDirectoryName(console.EmulatorPath);
        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

        // Portable Dolphin keeps User next to Dolphin.exe; the default install uses
        // %APPDATA%\Dolphin Emulator, and older builds used a Documents folder.
        return FirstFile(
            string.IsNullOrEmpty(emulatorDirectory) ? null : Path.Combine(emulatorDirectory, "User", "Config", "TimePlayed.ini"),
            Path.Combine(appData, "Dolphin Emulator", "Config", "TimePlayed.ini"),
            Path.Combine(documents, "Dolphin Emulator", "Config", "TimePlayed.ini"),
            Path.Combine(appData, "Dolphin", "Config", "TimePlayed.ini"));
    }

    private static string? FirstFile(params string?[] paths)
        => paths.FirstOrDefault(path => !string.IsNullOrWhiteSpace(path) && File.Exists(path));

    private static Dictionary<string, Pcsx2Record> ReadPcsx2File(string path)
    {
        var records = new Dictionary<string, Pcsx2Record>(StringComparer.OrdinalIgnoreCase);

        try
        {
            foreach (var line in File.ReadLines(path))
            {
                var parts = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 2
                    || !long.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var seconds))
                {
                    continue;
                }

                long lastPlayedUnix = 0;
                if (parts.Length > 2)
                {
                    _ = long.TryParse(parts[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out lastPlayedUnix);
                }

                records[parts[0].ToUpperInvariant()] = new Pcsx2Record(seconds, lastPlayedUnix);
            }
        }
        catch (IOException)
        {
            // An emulator may be writing the file. The rail says "not found" rather than
            // failing the whole payload; the next rescan will try again.
        }
        catch (UnauthorizedAccessException)
        {
        }

        return records;
    }

    private static Dictionary<string, long> ReadDolphinFile(string path)
    {
        var records = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(path))
        {
            return records;
        }

        try
        {
            var inSection = false;

            foreach (var rawLine in File.ReadLines(path))
            {
                var line = rawLine.Trim();
                if (line.Length == 0 || line.StartsWith(';') || line.StartsWith('#'))
                {
                    continue;
                }

                if (line.StartsWith('['))
                {
                    inSection = line.Equals("[TimePlayed]", StringComparison.OrdinalIgnoreCase);
                    continue;
                }

                if (!inSection)
                {
                    continue;
                }

                var equals = line.IndexOf('=');
                if (equals <= 0 || !TryParseDolphinMilliseconds(line[(equals + 1)..].Trim(), out var milliseconds))
                {
                    continue;
                }

                records[line[..equals].Trim().ToUpperInvariant()] = milliseconds;
            }
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }

        return records;
    }

    private static bool TryParseDolphinMilliseconds(string value, out long milliseconds)
    {
        if (value.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            return long.TryParse(value[2..], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out milliseconds);
        }

        return long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out milliseconds);
    }

    private static string? FormatLastPlayed(long unixSeconds)
    {
        // 0 is PCSX2's "never launched"; dates outside this range are corrupt or sentinel.
        if (unixSeconds <= 0 || unixSeconds > 4_102_444_800)
        {
            return null;
        }

        return DateTimeOffset.FromUnixTimeSeconds(unixSeconds)
            .ToLocalTime()
            .ToString("d MMM yyyy", CultureInfo.InvariantCulture);
    }

    private sealed record Pcsx2Record(long Seconds, long LastPlayedUnix);
}
