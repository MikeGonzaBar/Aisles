using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Aisles.App.Domain;

namespace Aisles.App.Action;

public sealed record EmulatorUpdateResult(
    string ConsoleId,
    string EmulatorName,
    string? CurrentVersion,
    string? LatestVersion,
    bool? UpdateAvailable,
    string? ReleasePageUrl,
    string? ManagerPath,
    string? Note,
    string? Error);

/// <summary>
/// Best-effort update checks that never install anything, only report whether a newer
/// release exists. Xenia is delegated to Xenia Manager, its existing update owner.
/// </summary>
public sealed class EmulatorUpdateService
{
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromMinutes(10);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private static readonly HttpClient Http = CreateHttpClient();
    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new(StringComparer.Ordinal);

    public async Task<EmulatorUpdateResult> CheckAsync(
        ConsoleDescriptor console,
        CancellationToken cancellationToken = default)
    {
        var profile = EmulatorProfile.For(console);
        var current = await ReadCurrentVersionAsync(console, profile, cancellationToken);
        var cacheKey = $"{console.Id}|{profile.Kind}|{current ?? "unknown"}";

        if (_cache.TryGetValue(cacheKey, out var cached)
            && DateTimeOffset.UtcNow - cached.CheckedAt < CacheLifetime)
        {
            return cached.Result;
        }

        EmulatorUpdateResult result;

        try
        {
            result = await CheckCoreAsync(console, profile, current, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            result = Failure(console, profile, current, $"Could not check for updates: {ex.Message}");
        }

        _cache[cacheKey] = new CacheEntry(DateTimeOffset.UtcNow, result);
        return result;
    }

    private async Task<EmulatorUpdateResult> CheckCoreAsync(
        ConsoleDescriptor console,
        EmulatorProfile profile,
        string? current,
        CancellationToken cancellationToken) =>
        profile.Kind switch
        {
            EmulatorKind.Pcsx2 => await CheckPcsx2Async(console, profile, current, cancellationToken),
            EmulatorKind.DuckStation => await CheckDuckStationAsync(console, profile, current, cancellationToken),
            EmulatorKind.Rpcs3 => await CheckRpcs3Async(console, profile, current, cancellationToken),
            EmulatorKind.Dolphin => await CheckDolphinAsync(console, profile, current, cancellationToken),
            EmulatorKind.RetroArch => await CheckRetroArchAsync(console, profile, current, cancellationToken),
            EmulatorKind.Desmume => await CheckDeSmuMeAsync(console, profile, current, cancellationToken),
            EmulatorKind.Citra => new EmulatorUpdateResult(
                console.Id,
                profile.DisplayName,
                current,
                null,
                null,
                profile.ReleasePageUrl,
                null,
                "Citra is no longer maintained upstream; there are no new builds to check for.",
                null),
            EmulatorKind.XeniaCanary => new EmulatorUpdateResult(
                console.Id,
                profile.DisplayName,
                current,
                null,
                null,
                profile.ManagerPath is null ? profile.ReleasePageUrl : null,
                profile.ManagerPath,
                profile.ManagerPath is null
                    ? "Xenia Canary updates are managed by Xenia Manager, which Aisles could not find next to this installation."
                    : "Xenia Canary updates are managed by Xenia Manager.",
                null),
            _ => new EmulatorUpdateResult(
                console.Id,
                profile.DisplayName,
                current,
                null,
                null,
                profile.ReleasePageUrl,
                profile.ManagerPath,
                "Aisles does not know this emulator's update source.",
                null),
        };

    private async Task<EmulatorUpdateResult> CheckPcsx2Async(
        ConsoleDescriptor console,
        EmulatorProfile profile,
        string? current,
        CancellationToken cancellationToken)
    {
        // Nightlies are frequent enough to push the last stable release out of the
        // first page, so ask GitHub for the current stable separately.
        var stable = await GetLatestReleaseAsync("PCSX2/pcsx2", cancellationToken);
        var releases = await GetReleasesAsync("PCSX2/pcsx2", cancellationToken);
        stable ??= releases
            .Where(release => !release.Draft && !release.Prerelease && EmulatorVersion.Parse(release.TagName) is not null)
            .OrderByDescending(release => release.PublishedAt)
            .FirstOrDefault();
        var newest = releases
            .Where(release => !release.Draft && EmulatorVersion.Parse(release.TagName) is not null)
            .OrderByDescending(release => release.PublishedAt)
            .FirstOrDefault();

        if (newest is null)
        {
            return Failure(console, profile, current, "PCSX2 published no readable releases.");
        }

        var currentVersion = EmulatorVersion.Parse(current);
        var stableVersion = stable is null ? null : EmulatorVersion.Parse(stable.TagName);
        var useNightly = currentVersion is not null
            && stableVersion is not null
            && EmulatorVersion.Compare(currentVersion, stableVersion) > 0;
        var target = useNightly ? newest : stable ?? newest;
        var targetVersion = EmulatorVersion.Parse(target.TagName);
        bool? updateAvailable = currentVersion is null || targetVersion is null
            ? null
            : EmulatorVersion.Compare(targetVersion, currentVersion) > 0;
        var channel = useNightly ? "nightly" : "stable";

        return new EmulatorUpdateResult(
            console.Id,
            profile.DisplayName,
            current,
            $"{target.TagName} ({channel})",
            updateAvailable,
            target.HtmlUrl,
            null,
            $"PCSX2 {channel} channel.",
            null);
    }

    private async Task<EmulatorUpdateResult> CheckDuckStationAsync(
        ConsoleDescriptor console,
        EmulatorProfile profile,
        string? current,
        CancellationToken cancellationToken)
    {
        var releases = await GetReleasesAsync("stenzek/duckstation", cancellationToken);
        var stable = releases
            .Where(release => !release.Draft && !release.Prerelease && EmulatorVersion.ParseDuckStationBuild(release.TagName) is not null)
            .OrderByDescending(release => release.PublishedAt)
            .FirstOrDefault();
        var rolling = releases
            .Where(release => !release.Draft && release.TagName.Equals("latest", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(release => release.PublishedAt)
            .FirstOrDefault();

        var currentBuild = EmulatorVersion.ParseDuckStationBuild(current);
        var stableBuild = stable is null ? null : EmulatorVersion.ParseDuckStationBuild(stable.TagName);
        var useRolling = currentBuild is not null && stableBuild is not null && currentBuild > stableBuild;

        if (useRolling && rolling is not null)
        {
            var localWrite = LastWriteTime(console.EmulatorPath);
            bool? updateAvailable = rolling.PublishedAt is { } published && localWrite is { } written
                ? published > written
                : null;

            return new EmulatorUpdateResult(
                console.Id,
                profile.DisplayName,
                current,
                $"rolling release · {rolling.PublishedAt:dd MMM yyyy}",
                updateAvailable,
                rolling.HtmlUrl,
                null,
                stable is null
                    ? "DuckStation rolling build; compared by release date."
                    : $"DuckStation rolling build; stable build is {stable.TagName}.",
                null);
        }

        if (stable is not null)
        {
            bool? updateAvailable = currentBuild is null || stableBuild is null
                ? null
                : stableBuild > currentBuild;

            return new EmulatorUpdateResult(
                console.Id,
                profile.DisplayName,
                current,
                stable.TagName,
                updateAvailable,
                stable.HtmlUrl,
                null,
                "DuckStation stable channel.",
                null);
        }

        return Failure(console, profile, current, "DuckStation published no readable releases.");
    }

    private async Task<EmulatorUpdateResult> CheckRpcs3Async(
        ConsoleDescriptor console,
        EmulatorProfile profile,
        string? current,
        CancellationToken cancellationToken)
    {
        var stable = await GetLatestReleaseAsync("RPCS3/rpcs3", cancellationToken);
        var releases = await GetReleasesAsync("RPCS3/rpcs3", cancellationToken);
        stable ??= releases
            .Where(release => !release.Draft && !release.Prerelease && EmulatorVersion.Parse(release.TagName) is not null)
            .OrderByDescending(release => release.PublishedAt)
            .FirstOrDefault();

        if (stable is null)
        {
            return Failure(console, profile, current, "RPCS3 published no readable stable release.");
        }

        var currentVersion = EmulatorVersion.Parse(current);
        var stableVersion = EmulatorVersion.Parse(stable.TagName);
        bool? updateAvailable = currentVersion is null || stableVersion is null
            ? null
            : EmulatorVersion.Compare(stableVersion, currentVersion) > 0;

        return new EmulatorUpdateResult(
            console.Id,
            profile.DisplayName,
            current,
            $"{stable.TagName} (stable)",
            updateAvailable,
            stable.HtmlUrl,
            null,
            current?.Contains('-') == true
                ? "Installed nightly build; compared against the current stable release."
                : "RPCS3 stable channel.",
            null);
    }

    private async Task<EmulatorUpdateResult> CheckDolphinAsync(
        ConsoleDescriptor console,
        EmulatorProfile profile,
        string? current,
        CancellationToken cancellationToken)
    {
        var tags = await GetTagsAsync("dolphin-emu/dolphin", cancellationToken);
        (int Number, char Suffix)? latest = null;
        string? latestTag = null;

        foreach (var tag in tags)
        {
            var parsed = EmulatorVersion.ParseDolphin(tag.Name);
            if (parsed is null)
            {
                continue;
            }

            if (latest is null || EmulatorVersion.CompareDolphin(parsed.Value, latest.Value) > 0)
            {
                latest = parsed;
                latestTag = tag.Name;
            }
        }

        if (latest is not { } latestVersion || latestTag is null)
        {
            return Failure(console, profile, current, "Dolphin published no readable release tags.");
        }

        var currentVersion = EmulatorVersion.ParseDolphin(current);
        bool? updateAvailable = currentVersion is null
            ? null
            : EmulatorVersion.CompareDolphin(latestVersion, currentVersion.Value) > 0;

        return new EmulatorUpdateResult(
            console.Id,
            profile.DisplayName,
            current,
            latestTag,
            updateAvailable,
            profile.ReleasePageUrl,
            null,
            "Dolphin publishes releases as Git tags; Aisles compares the latest release tag.",
            null);
    }

    private async Task<EmulatorUpdateResult> CheckRetroArchAsync(
        ConsoleDescriptor console,
        EmulatorProfile profile,
        string? current,
        CancellationToken cancellationToken)
    {
        var latest = await GetLatestReleaseAsync("libretro/RetroArch", cancellationToken);

        if (latest is null)
        {
            return Failure(console, profile, current, "RetroArch published no stable release.");
        }

        var currentVersion = EmulatorVersion.Parse(current);
        var latestVersion = EmulatorVersion.Parse(latest.TagName);
        bool? updateAvailable = currentVersion is null || latestVersion is null
            ? null
            : EmulatorVersion.Compare(latestVersion, currentVersion) > 0;

        return new EmulatorUpdateResult(
            console.Id,
            profile.DisplayName,
            current,
            latest.TagName,
            updateAvailable,
            latest.HtmlUrl,
            null,
            "RetroArch releases are checked against the latest stable GitHub release.",
            null);
    }

    private async Task<EmulatorUpdateResult> CheckDeSmuMeAsync(
        ConsoleDescriptor console,
        EmulatorProfile profile,
        string? current,
        CancellationToken cancellationToken)
    {
        var latest = await GetLatestReleaseAsync("TASEmulators/desmume", cancellationToken);

        if (latest is null)
        {
            return Failure(console, profile, current, "DeSmuME published no releases.");
        }

        var currentVersion = EmulatorVersion.Parse(current);
        var latestVersion = EmulatorVersion.ParseFlexible(latest.TagName);
        bool? updateAvailable = currentVersion is null || latestVersion is null
            ? null
            : EmulatorVersion.Compare(latestVersion, currentVersion) > 0;

        return new EmulatorUpdateResult(
            console.Id,
            profile.DisplayName,
            current,
            latest.TagName,
            updateAvailable,
            latest.HtmlUrl,
            null,
            "DeSmuME releases are infrequent; this checks the latest tagged release.",
            null);
    }

    private static async Task<string?> ReadCurrentVersionAsync(
        ConsoleDescriptor console,
        EmulatorProfile profile,
        CancellationToken cancellationToken)
    {
        try
        {
            return profile.Kind switch
            {
                EmulatorKind.Pcsx2 or EmulatorKind.DuckStation => FileVersion(console.EmulatorPath),
                EmulatorKind.Rpcs3 => EmulatorVersion.ParseRpcs3(await ReadVersionOutputAsync(console.EmulatorPath, cancellationToken))
                    ?? ReadRpcs3UpdateHistory(console.EmulatorPath),
                EmulatorKind.Dolphin => EmulatorVersion.ParseDolphinOutput(await ReadVersionOutputAsync(console.EmulatorPath, cancellationToken)),
                EmulatorKind.RetroArch => EmulatorVersion.ParseRetroArch(await ReadVersionOutputAsync(console.EmulatorPath, cancellationToken)),
                EmulatorKind.Desmume => EmulatorVersion.FromFileName(console.EmulatorPath),
                _ => null,
            };
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return null;
        }
    }

    private static string? FileVersion(string path)
    {
        if (!File.Exists(path))
        {
            return null;
        }

        var info = FileVersionInfo.GetVersionInfo(path);
        return string.IsNullOrWhiteSpace(info.FileVersion) ? info.ProductVersion : info.FileVersion;
    }

    private static async Task<string?> ReadVersionOutputAsync(string path, CancellationToken cancellationToken)
    {
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = path,
                    Arguments = "--version",
                    WorkingDirectory = Path.GetDirectoryName(path) ?? string.Empty,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                },
            };

            if (!process.Start())
            {
                return null;
            }

            var stdout = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var stderr = process.StandardError.ReadToEndAsync(cancellationToken);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));

            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                TryKill(process);
                return null;
            }

            var output = $"{await stdout}\n{await stderr}".Trim();
            return string.IsNullOrWhiteSpace(output) ? null : output;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return null;
        }
    }

    private static string? ReadRpcs3UpdateHistory(string path)
    {
        try
        {
            var log = Path.Combine(Path.GetDirectoryName(path) ?? string.Empty, "update_history.log");
            if (!File.Exists(log))
            {
                return null;
            }

            string? latest = null;

            foreach (var line in File.ReadLines(log))
            {
                var match = Regex.Match(line, "to \"([^\"]+)\"");
                if (match.Success)
                {
                    latest = match.Groups[1].Value;
                }
            }

            return latest;
        }
        catch
        {
            return null;
        }
    }

    private static DateTimeOffset? LastWriteTime(string path)
    {
        try
        {
            return File.Exists(path) ? File.GetLastWriteTimeUtc(path) : null;
        }
        catch
        {
            return null;
        }
    }

    private static void TryKill(Process process)
    {
        try
        {
            process.Kill(entireProcessTree: true);
        }
        catch
        {
            // The process may have exited between the timeout and the kill.
        }
    }

    private static async Task<List<GitHubRelease>> GetReleasesAsync(
        string repository,
        CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync(
            $"https://api.github.com/repos/{repository}/releases?per_page=20",
            cancellationToken);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<List<GitHubRelease>>(JsonOptions, cancellationToken)
            ?? [];
    }

    private static async Task<GitHubRelease?> GetLatestReleaseAsync(
        string repository,
        CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync(
            $"https://api.github.com/repos/{repository}/releases/latest",
            cancellationToken);

        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<GitHubRelease>(JsonOptions, cancellationToken);
    }

    private static async Task<List<GitHubTag>> GetTagsAsync(
        string repository,
        CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync(
            $"https://api.github.com/repos/{repository}/tags?per_page=30",
            cancellationToken);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<List<GitHubTag>>(JsonOptions, cancellationToken)
            ?? [];
    }

    private static EmulatorUpdateResult Failure(
        ConsoleDescriptor console,
        EmulatorProfile profile,
        string? current,
        string message) =>
        new(
            console.Id,
            profile.DisplayName,
            current,
            null,
            null,
            profile.ReleasePageUrl,
            profile.ManagerPath,
            null,
            message);

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Aisles/1.0");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    private sealed record CacheEntry(DateTimeOffset CheckedAt, EmulatorUpdateResult Result);

    private sealed record GitHubRelease(
        [property: JsonPropertyName("tag_name")] string TagName,
        [property: JsonPropertyName("prerelease")] bool Prerelease,
        [property: JsonPropertyName("draft")] bool Draft,
        [property: JsonPropertyName("published_at")] DateTimeOffset? PublishedAt,
        [property: JsonPropertyName("html_url")] string HtmlUrl);

    private sealed record GitHubTag([property: JsonPropertyName("name")] string Name);
}
