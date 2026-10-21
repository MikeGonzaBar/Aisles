namespace Aisles.App.Domain;

public enum EmulatorKind
{
    Unknown,
    DuckStation,
    Pcsx2,
    Rpcs3,
    Dolphin,
    Desmume,
    Citra,
    XeniaCanary,
}

/// <summary>
/// The emulator-specific facts Aisles needs for its console actions. Executable names
/// identify the emulator because <c>consoles.json</c> only stores a path; the entries
/// are deliberately small and can be extended without touching the catalog schema.
/// </summary>
public sealed record EmulatorProfile(
    EmulatorKind Kind,
    string DisplayName,
    string? ConfigDirectory,
    string? ConfigFile,
    string? ReleasePageUrl,
    string? ManagerPath)
{
    public static EmulatorProfile For(ConsoleDescriptor console)
    {
        var kind = Detect(console.EmulatorPath);
        var exeDirectory = Path.GetDirectoryName(console.EmulatorPath) ?? string.Empty;

        return kind switch
        {
            EmulatorKind.DuckStation => DuckStation(exeDirectory),
            EmulatorKind.Pcsx2 => Pcsx2(exeDirectory),
            EmulatorKind.Rpcs3 => Rpcs3(exeDirectory),
            EmulatorKind.Dolphin => Dolphin(exeDirectory),
            EmulatorKind.Desmume => DeSmuMe(exeDirectory),
            EmulatorKind.Citra => Citra(exeDirectory),
            EmulatorKind.XeniaCanary => Xenia(exeDirectory),
            _ => Unknown(),
        };
    }

    public static EmulatorKind Detect(string? emulatorPath)
    {
        var name = Path.GetFileNameWithoutExtension(emulatorPath) ?? string.Empty;

        if (name.Contains("duckstation", StringComparison.OrdinalIgnoreCase)) return EmulatorKind.DuckStation;
        if (name.Contains("pcsx2", StringComparison.OrdinalIgnoreCase)) return EmulatorKind.Pcsx2;
        if (name.Contains("rpcs3", StringComparison.OrdinalIgnoreCase)) return EmulatorKind.Rpcs3;
        if (name.Contains("dolphin", StringComparison.OrdinalIgnoreCase)) return EmulatorKind.Dolphin;
        if (name.Contains("desmume", StringComparison.OrdinalIgnoreCase)) return EmulatorKind.Desmume;
        if (name.Contains("citra", StringComparison.OrdinalIgnoreCase)) return EmulatorKind.Citra;
        if (name.Contains("xenia", StringComparison.OrdinalIgnoreCase)) return EmulatorKind.XeniaCanary;

        return EmulatorKind.Unknown;
    }

    private static EmulatorProfile DuckStation(string exeDirectory)
    {
        var documents = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "DuckStation",
            "settings.ini");
        var config = FirstExistingFile(
            Path.Combine(exeDirectory, "portable", "settings.ini"),
            Path.Combine(exeDirectory, "settings.ini"),
            documents);

        return new(
            EmulatorKind.DuckStation,
            "DuckStation",
            config is not null ? Path.GetDirectoryName(config) : FirstExistingDirectory(
                Path.Combine(exeDirectory, "portable"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "DuckStation")),
            config,
            "https://github.com/stenzek/duckstation/releases",
            null);
    }

    private static EmulatorProfile Pcsx2(string exeDirectory)
    {
        var config = FirstExistingFile(
            Path.Combine(exeDirectory, "inis", "PCSX2.ini"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "PCSX2", "inis", "PCSX2.ini"));

        return new(
            EmulatorKind.Pcsx2,
            "PCSX2",
            config is not null ? Path.GetDirectoryName(config) : FirstExistingDirectory(
                Path.Combine(exeDirectory, "inis"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "PCSX2", "inis")),
            config,
            "https://github.com/PCSX2/pcsx2/releases",
            null);
    }

    private static EmulatorProfile Rpcs3(string exeDirectory)
    {
        var config = FirstExistingFile(
            Path.Combine(exeDirectory, "config", "config.yml"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "rpcs3", "config", "config.yml"));

        return new(
            EmulatorKind.Rpcs3,
            "RPCS3",
            config is not null ? Path.GetDirectoryName(config) : FirstExistingDirectory(
                Path.Combine(exeDirectory, "config"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "rpcs3", "config")),
            config,
            "https://github.com/RPCS3/rpcs3/releases",
            null);
    }

    private static EmulatorProfile Dolphin(string exeDirectory)
    {
        var roaming = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Dolphin Emulator",
            "Config");
        var portable = Path.Combine(exeDirectory, "User", "Config");
        var config = FirstExistingFile(
            Path.Combine(roaming, "Dolphin.ini"),
            Path.Combine(portable, "Dolphin.ini"));

        return new(
            EmulatorKind.Dolphin,
            "Dolphin",
            config is not null ? Path.GetDirectoryName(config) : FirstExistingDirectory(roaming, portable),
            config,
            "https://dolphin-emu.org/download/",
            null);
    }

    private static EmulatorProfile DeSmuMe(string exeDirectory)
    {
        var config = FirstExistingFile(
            Path.Combine(exeDirectory, "desmume.ini"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "DeSmuME", "desmume.ini"));

        return new(
            EmulatorKind.Desmume,
            "DeSmuME",
            config is not null ? Path.GetDirectoryName(config) : FirstExistingDirectory(exeDirectory),
            config,
            "https://github.com/TASEmulators/desmume/releases",
            null);
    }

    private static EmulatorProfile Citra(string exeDirectory)
    {
        var roaming = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Citra",
            "config");
        var config = FirstExistingFile(
            Path.Combine(roaming, "qt-config.ini"),
            Path.Combine(exeDirectory, "user", "config", "qt-config.ini"));

        return new(
            EmulatorKind.Citra,
            "Citra",
            config is not null ? Path.GetDirectoryName(config) : FirstExistingDirectory(roaming, Path.Combine(exeDirectory, "user", "config")),
            config,
            "https://citra-emu.org/",
            null);
    }

    private static EmulatorProfile Xenia(string exeDirectory)
    {
        var config = FirstExistingFile(
            Path.Combine(exeDirectory, "xenia-canary.config.toml"),
            Path.Combine(exeDirectory, "config", "xenia-canary.config.toml"));
        var manager = FindXeniaManager(exeDirectory);

        return new(
            EmulatorKind.XeniaCanary,
            "Xenia Canary",
            config is not null ? Path.GetDirectoryName(config) : FirstExistingDirectory(exeDirectory, Path.Combine(exeDirectory, "config")),
            config,
            "https://github.com/xenia-canary/xenia-canary/releases",
            manager);
    }

    private static EmulatorProfile Unknown() => new(
        EmulatorKind.Unknown,
        "Emulator",
        null,
        null,
        null,
        null);

    /// <summary>Xenia Manager usually sits two folders above the emulator it installed.</summary>
    private static string? FindXeniaManager(string exeDirectory)
    {
        var directory = new DirectoryInfo(exeDirectory);

        for (var depth = 0; depth < 5 && directory is not null; depth++, directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "XeniaManager.exe");

            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
    }

    private static string? FirstExistingFile(params string?[] candidates) =>
        candidates.FirstOrDefault(candidate => !string.IsNullOrWhiteSpace(candidate) && File.Exists(candidate));

    private static string? FirstExistingDirectory(params string?[] candidates) =>
        candidates.FirstOrDefault(candidate => !string.IsNullOrWhiteSpace(candidate) && Directory.Exists(candidate));
}
