using System.Diagnostics;
using Aisles.App.Domain;

namespace Aisles.App.Action;

public sealed record LaunchResult(bool Started, string Message);

/// <summary>
/// Starts the configured emulator for a game. Arguments come from the console's
/// own <c>{0}</c> template, with optional <c>{core}</c> substitution, so a changed CLI flag is a config edit, not a rebuild
/// (PLAN.md section 8).
/// </summary>
public sealed class EmulatorLauncher
{
    public LaunchResult Launch(ConsoleDescriptor console, GameEntry game)
    {
        if (!console.EmulatorExists)
        {
            return new LaunchResult(false, $"Emulator not found: {console.EmulatorPath}");
        }

        if (string.IsNullOrWhiteSpace(game.LaunchTarget))
        {
            return new LaunchResult(false, "Game has no launch target.");
        }

        if (!File.Exists(game.LaunchTarget) && !Directory.Exists(game.LaunchTarget))
        {
            return new LaunchResult(false, $"Game not found: {game.LaunchTarget}");
        }

        var arguments = console.Arguments;

        if (arguments.Contains("{core}", StringComparison.Ordinal))
        {
            if (string.IsNullOrWhiteSpace(console.CorePath))
            {
                return new LaunchResult(
                    false,
                    $"Core file not configured for {console.Name}. Open Settings to choose a RetroArch core.");
            }

            if (!File.Exists(console.CorePath))
            {
                return new LaunchResult(false, $"Core not found: {console.CorePath}");
            }

            arguments = arguments.Replace("{core}", console.CorePath, StringComparison.Ordinal);
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = console.EmulatorPath,
            Arguments = arguments.Replace("{0}", game.LaunchTarget, StringComparison.Ordinal),
            WorkingDirectory = Path.GetDirectoryName(console.EmulatorPath) ?? string.Empty,
            UseShellExecute = false,
        };

        try
        {
            Process.Start(startInfo);
            return new LaunchResult(true, $"Launched {game.Title} with {Path.GetFileName(console.EmulatorPath)}");
        }
        catch (Exception ex)
        {
            return new LaunchResult(false, $"Launch failed: {ex.Message}");
        }
    }

    /// <summary>Opens the containing folder, for the "reveal in Explorer" affordance.</summary>
    public LaunchResult Reveal(ConsoleDescriptor console, GameEntry game)
    {
        var folder = File.Exists(game.LaunchTarget) || Directory.Exists(game.LaunchTarget)
            ? game.LaunchTarget
            : Path.GetDirectoryName(game.LaunchTarget);

        if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder))
        {
            folder = console.GamesPath;
        }

        if (!Directory.Exists(folder))
        {
            return new LaunchResult(false, $"Folder not found: {folder}");
        }

        try
        {
            Process.Start(new ProcessStartInfo { FileName = folder, UseShellExecute = true });
            return new LaunchResult(true, folder);
        }
        catch (Exception ex)
        {
            return new LaunchResult(false, $"Reveal failed: {ex.Message}");
        }
    }
}
