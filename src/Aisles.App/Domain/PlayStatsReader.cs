using System.Globalization;
using System.Text.Json;

namespace Aisles.App.Domain;

/// <summary>
/// Play time for the details rail. A null <see cref="Seconds"/> means the emulator
/// exposes no value; <see cref="Reason"/> is the text shown instead.
/// </summary>
public sealed record PlayStats(long? Seconds, string? LastPlayed, string? Source, string? Reason);

/// <summary>
/// Reads the emulator-owned play-time caches: PCSX2 and DuckStation
/// playtime.dat, Dolphin TimePlayed.ini, RPCS3 persistent_settings.dat, RetroArch .lrtl.
/// </summary>
public sealed class PlayStatsReader
{
    private const string Pcsx2Source = "PCSX2 playtime.dat";
    private const string DuckStationSource = "DuckStation playtime.dat";
    private const string DolphinSource = "Dolphin TimePlayed.ini";
    private const string Rpcs3Source = "RPCS3 persistent_settings.dat";
    private const string RetroArchSource = "RetroArch runtime log";

    private readonly Dictionary<string, Dictionary<string, PlayedTimeRecord>> _playtimeFiles = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Dictionary<string, long>> _dolphinFiles = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Dictionary<string, Rpcs3Record>> _rpcs3Files = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Dictionary<string, RetroArchRecord>> _retroArchFiles = new(StringComparer.OrdinalIgnoreCase);

    public PlayStats For(ConsoleDescriptor console, string? gameId, string? launchTarget = null)
    {
        if (EmulatorProfile.Detect(console.EmulatorPath) == EmulatorKind.RetroArch)
        {
            return ForRetroArch(console, launchTarget);
        }

        var id = (gameId ?? string.Empty).Trim().ToUpperInvariant();

        return console.Id.ToLowerInvariant() switch
        {
            "ps2" => ForPcsx2(console, id),
            "wii" or "gamecube" => ForDolphin(console, id),
            "ps1" => ForDuckStation(console, id),
            "ps3" => ForRpcs3(console, id),
            "ds" => Unavailable("DeSmuME does not record play time."),
            "3ds" => Unavailable("Citra does not record play time."),
            "xbox360" => Unavailable("Xenia does not record play time."),
            _ => Unavailable("This emulator does not expose play time."),
        };
    }

    /// <summary>
    /// PCSX2 writes one fixed-width record per line, e.g.
    /// <c>SLUS-21151    32387    1765476533</c>: serial, seconds, last-played Unix time.
    /// </summary>
    public static PlayStats ParsePcsx2(string text, string? gameId) =>
        ParsePlayedTimeFile(
            text,
            gameId,
            Pcsx2Source,
            "The game has no disc serial, so PCSX2 cannot match a play-time record.",
            "PCSX2 has not recorded a session for this game.",
            "PCSX2 has no playtime record for this game.");

    /// <summary>
    /// DuckStation uses the same fixed-width shape in
    /// <c>Documents\DuckStation\playtime.dat</c>: serial, seconds, last-played Unix time.
    /// </summary>
    public static PlayStats ParseDuckStation(string text, string? gameId) =>
        ParsePlayedTimeFile(
            text,
            gameId,
            DuckStationSource,
            "The game has no disc serial, so DuckStation cannot match a play-time record.",
            "DuckStation has not recorded a session for this game.",
            "DuckStation has no playtime record for this game.");

    private static PlayStats ParsePlayedTimeFile(
        string text,
        string? gameId,
        string source,
        string noIdReason,
        string zeroReason,
        string noRecordReason)
    {
        var id = (gameId ?? string.Empty).Trim().ToUpperInvariant();
        if (id.Length == 0)
        {
            return new PlayStats(null, null, null, noIdReason);
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
                return new PlayStats(0, null, source, zeroReason);
            }

            return new PlayStats(seconds, FormatLastPlayed(lastPlayedUnix), source, null);
        }

        return new PlayStats(null, null, source, noRecordReason);
    }

    /// <summary>
    /// Dolphin writes a <c>[TimePlayed]</c> section of milliseconds in hex
    /// (<c>RMCE01 = 0x00000000004bfafc</c>) and no last-played time.
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

    /// <summary>
    /// RPCS3's <c>persistent_settings.dat</c> maps a TITLE_ID to milliseconds in
    /// <c>[Playtime]</c> and to a local ISO 8601 date in <c>[LastPlayed]</c>.
    /// </summary>
    public static PlayStats ParseRpcs3(string text, string? gameId)
    {
        var id = (gameId ?? string.Empty).Trim().ToUpperInvariant();
        if (id.Length == 0)
        {
            return new PlayStats(null, null, null, "The game has no title ID, so RPCS3 cannot match a play-time record.");
        }

        var records = ParseRpcs3Records(text);

        if (!records.TryGetValue(id, out var record))
        {
            return new PlayStats(null, null, Rpcs3Source, "RPCS3 has no playtime record for this game.");
        }

        var seconds = record.Milliseconds / 1000;
        return seconds <= 0
            ? new PlayStats(0, record.LastPlayed, Rpcs3Source, "RPCS3 has not recorded a session for this game.")
            : new PlayStats(seconds, record.LastPlayed, Rpcs3Source, null);
    }

    /// <summary>
    /// RetroArch writes one JSON file per content name, with <c>runtime</c> as
    /// hours:minutes:seconds and <c>last_played</c> as local time.
    /// </summary>
    public static PlayStats ParseRetroArch(string text)
    {
        if (!TryParseRetroArchRecord(text, out var record))
        {
            return new PlayStats(null, null, RetroArchSource, "RetroArch's runtime log is not readable.");
        }

        return record.Seconds <= 0
            ? new PlayStats(0, null, RetroArchSource, "RetroArch has not recorded a session for this game.")
            : new PlayStats(record.Seconds, FormatRetroArchLastPlayed(record.LastPlayed), RetroArchSource, null);
    }

    private PlayStats ForRetroArch(ConsoleDescriptor console, string? launchTarget)
    {
        if (string.IsNullOrWhiteSpace(launchTarget))
        {
            return Unavailable("RetroArch's runtime log needs the game file name.");
        }

        var directory = RetroArchLogsDirectory(console);
        if (directory is null)
        {
            return Unavailable("RetroArch's runtime logs folder was not found.");
        }

        if (!_retroArchFiles.TryGetValue(directory, out var records))
        {
            records = ReadRetroArchLogs(directory);
            _retroArchFiles[directory] = records;
        }

        var contentName = Path.GetFileNameWithoutExtension(
            launchTarget.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        if (string.IsNullOrWhiteSpace(contentName))
        {
            return Unavailable("RetroArch's runtime log needs the game file name.");
        }

        if (!records.TryGetValue(contentName, out var record))
        {
            return new PlayStats(null, null, RetroArchSource, "RetroArch has no runtime log for this game yet.");
        }

        return record.Seconds <= 0
            ? new PlayStats(0, null, RetroArchSource, "RetroArch has not recorded a session for this game.")
            : new PlayStats(record.Seconds, FormatRetroArchLastPlayed(record.LastPlayed), RetroArchSource, null);
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

        if (!_playtimeFiles.TryGetValue(file, out var records))
        {
            records = ReadPlayedTimeFile(file);
            _playtimeFiles[file] = records;
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

    private PlayStats ForDuckStation(ConsoleDescriptor console, string id)
    {
        if (id.Length == 0)
        {
            return new PlayStats(null, null, null, "The game has no disc serial, so DuckStation cannot match a play-time record.");
        }

        var file = DuckStationFile(console);
        if (file is null)
        {
            return Unavailable("DuckStation's playtime.dat was not found.");
        }

        if (!_playtimeFiles.TryGetValue(file, out var records))
        {
            records = ReadPlayedTimeFile(file);
            _playtimeFiles[file] = records;
        }

        if (!records.TryGetValue(id, out var record))
        {
            return new PlayStats(null, null, DuckStationSource, "DuckStation has no playtime record for this game.");
        }

        if (record.Seconds <= 0)
        {
            return new PlayStats(0, null, DuckStationSource, "DuckStation has not recorded a session for this game.");
        }

        return new PlayStats(record.Seconds, FormatLastPlayed(record.LastPlayedUnix), DuckStationSource, null);
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

    private PlayStats ForRpcs3(ConsoleDescriptor console, string id)
    {
        if (id.Length == 0)
        {
            return new PlayStats(null, null, null, "The game has no title ID, so RPCS3 cannot match a play-time record.");
        }

        var file = Rpcs3File(console);
        if (file is null)
        {
            return Unavailable("RPCS3's persistent_settings.dat was not found.");
        }

        if (!_rpcs3Files.TryGetValue(file, out var records))
        {
            records = ReadRpcs3File(file);
            _rpcs3Files[file] = records;
        }

        if (!records.TryGetValue(id, out var record))
        {
            return new PlayStats(null, null, Rpcs3Source, "RPCS3 has no playtime record for this game.");
        }

        var seconds = record.Milliseconds / 1000;
        return seconds <= 0
            ? new PlayStats(0, record.LastPlayed, Rpcs3Source, "RPCS3 has not recorded a session for this game.")
            : new PlayStats(seconds, record.LastPlayed, Rpcs3Source, null);
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

    /// <summary>
    /// DuckStation keeps <c>playtime.dat</c> in <c>Documents\DuckStation</c>; portable
    /// builds keep it beside the executable, sometimes nested in a portable folder.
    /// </summary>
    private static string? DuckStationFile(ConsoleDescriptor console)
    {
        var emulatorDirectory = Path.GetDirectoryName(console.EmulatorPath);
        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);

        return FirstFile(
            Path.Combine(documents, "DuckStation", "playtime.dat"),
            string.IsNullOrEmpty(emulatorDirectory) ? null : Path.Combine(emulatorDirectory, "playtime.dat"),
            string.IsNullOrEmpty(emulatorDirectory) ? null : Path.Combine(emulatorDirectory, "portable", "playtime.dat"));
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

    /// <summary>
    /// RPCS3 keeps this beside the executable in a portable install; the folder is spelled
    /// <c>GuiConfigs</c> or <c>gui_configs</c> across releases.
    /// </summary>
    private static string? Rpcs3File(ConsoleDescriptor console)
    {
        var emulatorDirectory = Path.GetDirectoryName(console.EmulatorPath);
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

        return FirstFile(
            string.IsNullOrEmpty(emulatorDirectory) ? null : Path.Combine(emulatorDirectory, "GuiConfigs", "persistent_settings.dat"),
            string.IsNullOrEmpty(emulatorDirectory) ? null : Path.Combine(emulatorDirectory, "gui_configs", "persistent_settings.dat"),
            Path.Combine(appData, "rpcs3", "GuiConfigs", "persistent_settings.dat"));
    }

    /// <summary>
    /// Portable RetroArch keeps playlists and logs under its own folder; installed builds
    /// may use %APPDATA%\RetroArch, so both layouts are checked.
    /// </summary>
    private static string? RetroArchLogsDirectory(ConsoleDescriptor console)
    {
        var emulatorDirectory = Path.GetDirectoryName(console.EmulatorPath);
        var appData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "RetroArch");
        var profile = EmulatorProfile.For(console);

        return FirstDirectory(
            string.IsNullOrEmpty(emulatorDirectory) ? null : Path.Combine(emulatorDirectory, "playlists", "logs"),
            profile.ConfigDirectory is null ? null : Path.Combine(profile.ConfigDirectory, "playlists", "logs"),
            Path.Combine(appData, "playlists", "logs"));
    }

    private static Dictionary<string, RetroArchRecord> ReadRetroArchLogs(string directory)
    {
        var records = new Dictionary<string, RetroArchRecord>(StringComparer.OrdinalIgnoreCase);

        try
        {
            foreach (var path in Directory.EnumerateFiles(directory, "*.lrtl", SearchOption.AllDirectories))
            {
                RetroArchRecord record;

                try
                {
                    if (!TryParseRetroArchRecord(File.ReadAllText(path), out record))
                    {
                        continue;
                    }
                }
                catch (IOException)
                {
                    continue;
                }
                catch (UnauthorizedAccessException)
                {
                    continue;
                }

                var contentName = Path.GetFileNameWithoutExtension(path);

                if (!records.TryGetValue(contentName, out var existing))
                {
                    records[contentName] = record;
                    continue;
                }

                // The same content can have a log under more than one core. Total time
                // is the sum; the latest session provides the last-played date.
                var lastPlayed = existing.LastPlayed is null
                    ? record.LastPlayed
                    : record.LastPlayed is null || existing.LastPlayed >= record.LastPlayed
                        ? existing.LastPlayed
                        : record.LastPlayed;
                records[contentName] = new RetroArchRecord(existing.Seconds + record.Seconds, lastPlayed);
            }
        }
        catch (IOException)
        {
            // RetroArch may be writing the folder. The rail reports no record and the
            // next scan tries again.
        }
        catch (UnauthorizedAccessException)
        {
        }

        return records;
    }

    private static bool TryParseRetroArchRecord(string text, out RetroArchRecord record)
    {
        record = new RetroArchRecord(0, null);

        try
        {
            using var document = JsonDocument.Parse(text);
            var root = document.RootElement;

            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("runtime", out var runtimeElement)
                || runtimeElement.ValueKind != JsonValueKind.String
                || !TimeSpan.TryParse(runtimeElement.GetString(), CultureInfo.InvariantCulture, out var runtime)
                || runtime < TimeSpan.Zero)
            {
                return false;
            }

            DateTime? lastPlayed = null;

            if (root.TryGetProperty("last_played", out var lastPlayedElement)
                && lastPlayedElement.ValueKind == JsonValueKind.String
                && DateTime.TryParseExact(
                    lastPlayedElement.GetString(),
                    "yyyy-MM-dd HH:mm:ss",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out var parsed))
            {
                lastPlayed = parsed;
            }

            record = new RetroArchRecord((long)runtime.TotalSeconds, lastPlayed);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static string? FormatRetroArchLastPlayed(DateTime? lastPlayed) =>
        lastPlayed?.ToString("d MMM yyyy", CultureInfo.InvariantCulture);

    private static string? FirstFile(params string?[] paths)
        => paths.FirstOrDefault(path => !string.IsNullOrWhiteSpace(path) && File.Exists(path));

    private static string? FirstDirectory(params string?[] paths)
        => paths.FirstOrDefault(path => !string.IsNullOrWhiteSpace(path) && Directory.Exists(path));

    /// <summary>
    /// PCSX2 and DuckStation share the same fixed-width line, so one reader serves both.
    /// </summary>
    private static Dictionary<string, PlayedTimeRecord> ReadPlayedTimeFile(string path)
    {
        var records = new Dictionary<string, PlayedTimeRecord>(StringComparer.OrdinalIgnoreCase);

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

                records[parts[0].ToUpperInvariant()] = new PlayedTimeRecord(seconds, lastPlayedUnix);
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

    private static Dictionary<string, Rpcs3Record> ReadRpcs3File(string path)
    {
        if (!File.Exists(path))
        {
            return new Dictionary<string, Rpcs3Record>(StringComparer.OrdinalIgnoreCase);
        }

        try
        {
            return ParseRpcs3Records(File.ReadAllText(path));
        }
        catch (IOException)
        {
            // The emulator may be writing the file. The rail says "not found" and a
            // later rescan tries again.
            return new Dictionary<string, Rpcs3Record>(StringComparer.OrdinalIgnoreCase);
        }
        catch (UnauthorizedAccessException)
        {
            return new Dictionary<string, Rpcs3Record>(StringComparer.OrdinalIgnoreCase);
        }
    }

    private static Dictionary<string, Rpcs3Record> ParseRpcs3Records(string text)
    {
        var playtime = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        var lastPlayed = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var section = string.Empty;

        foreach (var rawLine in text.Split('\n'))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith(';') || line.StartsWith('#'))
            {
                continue;
            }

            if (line.StartsWith('['))
            {
                section = line.Trim('[', ']').Trim();
                continue;
            }

            var equals = line.IndexOf('=');
            if (equals <= 0)
            {
                continue;
            }

            var key = line[..equals].Trim();
            var value = line[(equals + 1)..].Trim();

            if (section.Equals("Playtime", StringComparison.OrdinalIgnoreCase))
            {
                if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var milliseconds))
                {
                    playtime[key] = milliseconds;
                }
            }
            else if (section.Equals("LastPlayed", StringComparison.OrdinalIgnoreCase))
            {
                lastPlayed[key] = value;
            }
        }

        var records = new Dictionary<string, Rpcs3Record>(StringComparer.OrdinalIgnoreCase);

        foreach (var (id, milliseconds) in playtime)
        {
            records[id] = new Rpcs3Record(
                milliseconds,
                lastPlayed.TryGetValue(id, out var value) ? FormatRpcs3Date(value) : null);
        }

        return records;
    }

    private static string? FormatRpcs3Date(string value) =>
        DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed)
            ? parsed.ToString("d MMM yyyy", CultureInfo.InvariantCulture)
            : null;

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

    private sealed record PlayedTimeRecord(long Seconds, long LastPlayedUnix);

    private sealed record Rpcs3Record(long Milliseconds, string? LastPlayed);

    private sealed record RetroArchRecord(long Seconds, DateTime? LastPlayed);
}
