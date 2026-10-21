using Aisles.App.Bridge;
using Aisles.App.Domain;
using System.Diagnostics;
using System.Globalization;

namespace Aisles.App.Ps3Trophies;

/// <summary>
/// Turns the trophy data RPCS3 keeps on disk into the same ACHIEVEMENTS row the
/// RetroAchievements provider fills. A PS3 game needs no account and no network:
/// the emulator installs <c>TROPCONF.SFM</c> and <c>TROPUSR.DAT</c> under
/// <c>dev_hdd0\home\&lt;user&gt;\trophy\&lt;NPWR&gt;</c> when the game first registers
/// its trophies. Disc games that have not been launched yet fall back to the
/// <c>TROPHY.TRP</c> package beside the game for definitions, with zero progress.
/// </summary>
public sealed class Ps3TrophyService
{
    public const string IconHost = "trophies.aisles.local";

    private static readonly TimeSpan CacheLifetime = TimeSpan.FromSeconds(5);

    private readonly object _gate = new();
    private readonly Dictionary<string, CachedPayload> _cache = new(StringComparer.Ordinal);

    /// <summary>
    /// The folder the web layer may read trophy images from. It maps one virtual host
    /// to RPCS3's home directory, so icon URLs stay relative to the active user.
    /// </summary>
    public static string? TrophyHomeRoot(ConsoleDescriptor console)
    {
        var devHdd0 = FindDevHdd0(console);
        if (devHdd0 is null)
        {
            return null;
        }

        var home = Path.Combine(devHdd0, "home");
        return Directory.Exists(home) ? home : null;
    }

    public AchievementsPayload ForGame(ConsoleDescriptor console, GameEntry game)
    {
        try
        {
            return Read(console, game);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"PS3 trophies for {game.Id} failed ({ex.GetType().Name}).");
            return NoTrophies("RPCS3's trophy data could not be read.");
        }
    }

    private AchievementsPayload Read(ConsoleDescriptor console, GameEntry game)
    {
        if (!string.Equals(console.Id, "ps3", StringComparison.OrdinalIgnoreCase))
        {
            return new AchievementsPayload(
                "notSupported", null, null, null, "PS3 trophy data is only available for PlayStation 3.");
        }

        var devHdd0 = FindDevHdd0(console);
        if (devHdd0 is null)
        {
            return NoTrophies("RPCS3's dev_hdd0 folder was not found.");
        }

        // RPCS3's installed copy is usually newer than the disc's TROPDIR (updates
        // replace trophy sets), so prefer it for definitions. The user's trophy folder
        // is even better and is preferred below when TROPCONF.SFM exists there.
        var trophyDirectory = FindInstalledTrophyDirectory(console, game.Serial)
            ?? FindTrophyDirectory(game.LaunchTarget)
            ?? FindTrophyDirectory(Path.Combine(devHdd0, "game", game.Serial ?? string.Empty));

        if (trophyDirectory is null)
        {
            return NoTrophies("RPCS3 has no trophy set for this game.");
        }

        var trophySet = FindTrophySet(trophyDirectory);
        if (trophySet is null)
        {
            return NoTrophies("RPCS3's trophy folder for this game is empty.");
        }

        var (packDirectory, npwr) = trophySet.Value;
        var userTrophy = FindUserTrophy(devHdd0, npwr);
        var progressPath = userTrophy is null ? null : Path.Combine(userTrophy.Directory, "TROPUSR.DAT");
        var packagePath = Path.Combine(packDirectory, "TROPHY.TRP");
        var userConfigPath = userTrophy is null
            ? null
            : Path.Combine(userTrophy.Directory, "TROPCONF.SFM");
        var configPath = userConfigPath is not null && File.Exists(userConfigPath)
            ? userConfigPath
            : Path.Combine(packDirectory, "TROPCONF.SFM");

        var signature = Signature(configPath, packagePath, progressPath, userTrophy?.Directory);
        lock (_gate)
        {
            if (_cache.TryGetValue(game.Id, out var cached)
                && cached.Signature == signature
                && DateTimeOffset.UtcNow - cached.ReadAt < CacheLifetime)
            {
                return cached.Payload;
            }
        }

        var definitions = File.Exists(configPath)
            ? Ps3TrophyReader.ReadConfiguration(configPath)
            : Ps3TrophyReader.TryReadPackageConfiguration(packagePath);

        if (definitions is null || definitions.Count == 0)
        {
            return NoTrophies("RPCS3 has no trophy set for this game.");
        }

        var progress = progressPath is not null && File.Exists(progressPath)
            ? Ps3TrophyReader.ReadProgress(progressPath)
            : new Dictionary<int, Ps3TrophyProgress>();

        var earned = definitions.Count(definition =>
            progress.TryGetValue(definition.Id, out var record) && record.Unlocked);

        var recent = definitions
            .Select(definition => (Definition: definition, Record: progress.GetValueOrDefault(definition.Id)))
            .Where(item => item.Record is { Unlocked: true })
            .OrderByDescending(item => item.Record!.EarnedAt ?? DateTime.MinValue)
            .ThenBy(item => item.Definition.Id)
            .Take(3)
            .Select(item => Badge(item.Definition, item.Record!, userTrophy))
            .ToList();

        var pending = definitions
            .Where(definition => !progress.TryGetValue(definition.Id, out var record) || !record.Unlocked)
            .Take(3)
            .Select(definition => Badge(definition, null, userTrophy))
            .ToList();

        var note = userTrophy is null || progressPath is null || !File.Exists(progressPath)
            ? "RPCS3 has no trophy progress yet"
            : earned == 0
                ? "RPCS3 trophy data · no unlocks yet"
                : "RPCS3 trophy data";

        var payload = new AchievementsPayload(
            "local",
            earned,
            definitions.Count,
            null,
            note,
            recent.Count > 0 ? recent : null,
            pending.Count > 0 ? pending : null,
            Source: "rpcs3",
            Unit: "trophies");

        lock (_gate)
        {
            _cache[game.Id] = new CachedPayload(signature, payload, DateTimeOffset.UtcNow);
        }

        return payload;
    }

    private static AchievementBadgePayload Badge(
        Ps3TrophyDefinition definition,
        Ps3TrophyProgress? record,
        TrophyUser? userTrophy)
    {
        var unlocked = record is { Unlocked: true };
        var hide = definition.Hidden && !unlocked;
        var icon = userTrophy is null ? null : IconUrl(userTrophy, definition.Id);

        return new AchievementBadgePayload(
            definition.Id,
            hide ? "Hidden trophy" : definition.Name,
            hide ? null : definition.Detail,
            TrophyPoints(definition.Grade),
            icon,
            unlocked ? record!.EarnedAt?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null);
    }

    private static string? IconUrl(TrophyUser userTrophy, int trophyId)
    {
        var file = Path.Combine(
            userTrophy.Directory,
            $"TROP{trophyId.ToString("000", CultureInfo.InvariantCulture)}.PNG");

        if (!File.Exists(file))
        {
            return null;
        }

        return $"https://{IconHost}/{Uri.EscapeDataString(userTrophy.User)}"
            + $"/trophy/{Uri.EscapeDataString(userTrophy.Npwr)}"
            + $"/TROP{trophyId.ToString("000", CultureInfo.InvariantCulture)}.PNG";
    }

    private static int TrophyPoints(char grade) => grade switch
    {
        'P' => 180,
        'G' => 90,
        'S' => 30,
        _ => 15,
    };

    private static AchievementsPayload NoTrophies(string note) =>
        new("noTrophies", null, null, null, note, Source: "rpcs3", Unit: "trophies");

    /// <summary>
    /// RPCS3 is portable on this machine: <c>dev_hdd0</c> sits beside the executable.
    /// The standard install keeps it under <c>%APPDATA%\rpcs3</c>. Either layout is
    /// accepted, and the configured installed-games path is a final hint.
    /// </summary>
    private static string? FindDevHdd0(ConsoleDescriptor console)
    {
        var candidates = new List<string>();

        var exeDirectory = Path.GetDirectoryName(console.EmulatorPath);
        if (!string.IsNullOrWhiteSpace(exeDirectory))
        {
            candidates.Add(Path.Combine(exeDirectory, "dev_hdd0"));
        }

        candidates.Add(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "rpcs3",
            "dev_hdd0"));

        if (!string.IsNullOrWhiteSpace(console.InstalledGamesPath))
        {
            var installed = console.InstalledGamesPath.TrimEnd(
                Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar);

            if (string.Equals(Path.GetFileName(installed), "game", StringComparison.OrdinalIgnoreCase)
                && Path.GetDirectoryName(installed) is { } parent)
            {
                candidates.Add(parent);
            }
        }

        return candidates.FirstOrDefault(Directory.Exists);
    }

    /// <summary>
    /// Installed games keep <c>TROPDIR\NPWR…</c> directly below the title folder.
    /// Disc dumps often wrap PS3_GAME in one more folder, as this library's ISOs do,
    /// so the search is deliberately shallow rather than recursive over a whole dump.
    /// </summary>
    private static string? FindTrophyDirectory(string? gamePath)
    {
        if (string.IsNullOrWhiteSpace(gamePath) || !Directory.Exists(gamePath))
        {
            return null;
        }

        var direct = new[]
        {
            Path.Combine(gamePath, "TROPDIR"),
            Path.Combine(gamePath, "PS3_GAME", "TROPDIR"),
        };

        foreach (var candidate in direct)
        {
            if (Directory.Exists(candidate))
            {
                return candidate;
            }
        }

        try
        {
            foreach (var child in Directory.EnumerateDirectories(gamePath).Take(24))
            {
                foreach (var candidate in new[]
                         {
                             Path.Combine(child, "TROPDIR"),
                             Path.Combine(child, "PS3_GAME", "TROPDIR"),
                         })
                {
                    if (Directory.Exists(candidate))
                    {
                        return candidate;
                    }
                }

                foreach (var grandchild in Directory.EnumerateDirectories(child).Take(12))
                {
                    var candidate = Path.Combine(grandchild, "PS3_GAME", "TROPDIR");
                    if (Directory.Exists(candidate))
                    {
                        return candidate;
                    }
                }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }

        return null;
    }

    private static string? FindInstalledTrophyDirectory(ConsoleDescriptor console, string? serial)
    {
        if (string.IsNullOrWhiteSpace(serial) || string.IsNullOrWhiteSpace(console.InstalledGamesPath))
        {
            return null;
        }

        return FindTrophyDirectory(Path.Combine(console.InstalledGamesPath, serial));
    }

    private static (string Directory, string Npwr)? FindTrophySet(string trophyDirectory)
    {
        try
        {
            var candidates = Directory.EnumerateDirectories(trophyDirectory)
                .Select(directory => new
                {
                    Directory = directory,
                    Npwr = Path.GetFileName(directory),
                    HasConfig = File.Exists(Path.Combine(directory, "TROPCONF.SFM")),
                    HasPackage = File.Exists(Path.Combine(directory, "TROPHY.TRP")),
                })
                .Where(item => item.HasConfig || item.HasPackage)
                .OrderByDescending(item => item.Npwr.StartsWith("NPWR", StringComparison.OrdinalIgnoreCase))
                .ToList();

            if (candidates.Count == 0)
            {
                return null;
            }

            return (candidates[0].Directory, candidates[0].Npwr);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static TrophyUser? FindUserTrophy(string devHdd0, string npwr)
    {
        var home = Path.Combine(devHdd0, "home");
        if (!Directory.Exists(home))
        {
            return null;
        }

        try
        {
            var candidates = Directory.EnumerateDirectories(home)
                .Select(user => new
                {
                    User = Path.GetFileName(user),
                    Directory = Path.Combine(user, "trophy", npwr),
                })
                .Where(item => Directory.Exists(item.Directory))
                .OrderByDescending(item =>
                {
                    var progress = Path.Combine(item.Directory, "TROPUSR.DAT");
                    return File.Exists(progress) ? File.GetLastWriteTimeUtc(progress) : DateTime.MinValue;
                })
                .ThenByDescending(item => item.User == "00000001")
                .ToList();

            return candidates.Count == 0
                ? null
                : new TrophyUser(candidates[0].User, candidates[0].Directory, npwr);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static string Signature(
        string configPath,
        string packagePath,
        string? progressPath,
        string? userDirectory)
    {
        static string Part(string? path)
        {
            if (path is null || !File.Exists(path))
            {
                return "-";
            }

            var file = new FileInfo(path);
            return $"{file.Length}:{file.LastWriteTimeUtc.Ticks}";
        }

        return $"{userDirectory ?? "-"}|{Part(configPath)}|{Part(packagePath)}|{Part(progressPath)}";
    }

    private sealed record TrophyUser(string User, string Directory, string Npwr);

    private sealed record CachedPayload(string Signature, AchievementsPayload Payload, DateTimeOffset ReadAt);
}
