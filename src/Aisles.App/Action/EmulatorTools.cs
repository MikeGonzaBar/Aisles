using System.Diagnostics;
using Aisles.App.Domain;

namespace Aisles.App.Action;

/// <summary>
/// Console-level actions that do not need a game. They deliberately open the emulator,
/// its configuration folder, or a release page rather than driving the emulator's own
/// menus: those menus are GUI state, not a CLI contract.
/// </summary>
public sealed class EmulatorTools
{
    public EmulatorProfile ProfileFor(ConsoleDescriptor console) => EmulatorProfile.For(console);

    public LaunchResult Open(ConsoleDescriptor console)
    {
        if (!console.EmulatorExists)
        {
            return new LaunchResult(false, $"Emulator not found: {console.EmulatorPath}");
        }

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = console.EmulatorPath,
                WorkingDirectory = Path.GetDirectoryName(console.EmulatorPath) ?? string.Empty,
                UseShellExecute = false,
            });

            return new LaunchResult(true, $"Opened {EmulatorProfile.For(console).DisplayName}");
        }
        catch (Exception ex)
        {
            return new LaunchResult(false, $"Could not open the emulator: {ex.Message}");
        }
    }

    public LaunchResult OpenConfigFolder(ConsoleDescriptor console)
    {
        var profile = EmulatorProfile.For(console);

        try
        {
            if (profile.ConfigFile is { } file && File.Exists(file))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "explorer.exe",
                    Arguments = $"/select,\"{file}\"",
                    UseShellExecute = true,
                });

                return new LaunchResult(true, $"Opened {Path.GetFileName(file)}");
            }

            if (profile.ConfigDirectory is { } directory && Directory.Exists(directory))
            {
                Process.Start(new ProcessStartInfo { FileName = directory, UseShellExecute = true });
                return new LaunchResult(true, $"Opened {directory}");
            }

            return new LaunchResult(
                false,
                $"No controller configuration found for {profile.DisplayName}. Open the emulator once so it creates one.");
        }
        catch (Exception ex)
        {
            return new LaunchResult(false, $"Could not open the configuration folder: {ex.Message}");
        }
    }

    public LaunchResult OpenReleasePage(ConsoleDescriptor console)
    {
        var profile = EmulatorProfile.For(console);

        return OpenUrl(profile.ReleasePageUrl, $"No release page is known for {profile.DisplayName}.");
    }

    public LaunchResult OpenXeniaManager(ConsoleDescriptor console)
    {
        var profile = EmulatorProfile.For(console);

        if (profile.ManagerPath is not { } manager || !File.Exists(manager))
        {
            return new LaunchResult(false, "Xenia Manager was not found next to this Xenia installation.");
        }

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = manager,
                WorkingDirectory = Path.GetDirectoryName(manager) ?? string.Empty,
                UseShellExecute = true,
            });

            return new LaunchResult(true, "Opened Xenia Manager");
        }
        catch (Exception ex)
        {
            return new LaunchResult(false, $"Could not open Xenia Manager: {ex.Message}");
        }
    }

    private static LaunchResult OpenUrl(string? url, string missingMessage)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return new LaunchResult(false, missingMessage);
        }

        try
        {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
            return new LaunchResult(true, "Opened the release page");
        }
        catch (Exception ex)
        {
            return new LaunchResult(false, $"Could not open the release page: {ex.Message}");
        }
    }
}
