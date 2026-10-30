using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Aisles.App.Domain;

/// <summary>One resolved artwork slot. A null URL means the generated rung won.</summary>
public sealed record ResolvedArtwork(string? Url, string? Match, string? Source, double[]? LabelRect);

/// <summary>The case front and the medium's printed face, resolved independently.</summary>
public sealed record ArtworkResolution(ResolvedArtwork FrontCover, ResolvedArtwork Medium);

/// <summary>
/// Resolves each artwork role independently. A near match is never presented as exact,
/// and a cover never becomes a disc or cartridge label.
/// </summary>
public sealed class ArtworkResolver
{
    public const string Host = "artwork.aisles.local";

    private const int MaxBytes = 12 * 1024 * 1024;
    private const long MaxPixels = 32L * 1024 * 1024;
    private const int ReviewFloor = 384;
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(12);
    private static readonly TimeSpan RequestGap = TimeSpan.FromMilliseconds(250);

    private static readonly HashSet<string> AllowedHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "gamesdb.launchbox-app.com",
        "images.launchbox-app.com",
        "art.gametdb.com",
    };

    private static readonly Regex FilePattern = new(
        "^[a-f0-9]{64}\\.(png|jpg|jpeg|webp)$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);


    private static readonly Regex StudioPrefix = new(
        "^Disney[ ]*[/-]?[ ]*Pixar[ ]+|^Disney'?s?[ ]+",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex DsNumberPrefix = new(
        "^\\d+\\s*-\\s*",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex DsGroups = new(
        "\\s*\\([^)]*\\)|\\s*\\[[^\\]]*\\]",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex EditionPattern = new(
        "special edition|game of the year|greatest hits|collector.?s? edition|platinum|essentials|extras edition|disc\\s*\\d+",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex GalleryLabel = new(
        " - (Box - Front|Disc|Cart - Front) Image(?: \\(([^)]+)\\))?$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly string _indexPath;
    private readonly ArtworkIndex _index;
    private readonly HttpClient _http;
    private readonly object _gate = new();
    private readonly object _saveGate = new();
    private readonly SemaphoreSlim _requestGate = new(1, 1);
    private readonly ConcurrentDictionary<string, GameIdentity> _identity = new(StringComparer.Ordinal);

    public ArtworkResolver(string cacheRoot)
    {
        CacheRoot = cacheRoot;
        Directory.CreateDirectory(cacheRoot);
        _indexPath = Path.Combine(cacheRoot, "index.json");
        _index = ArtworkIndex.Load(_indexPath);

        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate | DecompressionMethods.Brotli,
        };

        // The per-request token enforces the timeout, because the body is streamed through
        // the app's size cap rather than buffered by HttpClient.
        _http = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("Aisles/0.1");
    }

    public string CacheRoot { get; }

    /// <summary>Resolves both slots for one game. Safe to call while a search is running.</summary>
    public ArtworkResolution Resolve(GameEntry game, ConsoleDescriptor console, string? localCoverUrl)
    {
        lock (_gate)
        {
            var entry = EntryFor(game);
            var context = ContextFor(game, console, entry);
            var mediumKind = game.ConsoleId.Equals("ds", StringComparison.OrdinalIgnoreCase)
                ? "cartridgeLabel"
                : "discLabel";

            return new ArtworkResolution(
                ResolveKind(context, entry, "frontCover", localCoverUrl),
                ResolveKind(context, entry, mediumKind, null));
        }
    }

    /// <summary>
    /// The identity used for artwork lookup, exposed so the rail can show the same game ID
    /// and region. A Wii header not read yet returns a null ID until the console search runs.
    /// </summary>
    public GameIdentity Identity(GameEntry game)
    {
        lock (_gate)
        {
            return IdentityFor(game, EntryFor(game));
        }
    }

    /// <summary>
    /// Discovers identities and searches providers for one console. Slots already resolved
    /// (local art, cached match, chosen fallback) are left alone, so copying a cache is cheap.
    /// </summary>
    public async Task<int> SearchConsoleAsync(
        ConsoleDescriptor console,
        IReadOnlyList<GameEntry> games,
        Func<GameEntry, string?> localCover,
        CancellationToken cancellationToken)
    {
        var searched = 0;

        foreach (var game in games)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var cover = localCover(game);
            GameContext context;

            lock (_gate)
            {
                context = ContextFor(game, console, EntryFor(game));
            }

            if (game.ConsoleId.Equals("wii", StringComparison.OrdinalIgnoreCase) && context.Id is null)
            {
                var identity = await GameIdentityReader
                    .DolphinHeaderAsync(console, game.LaunchTarget, cancellationToken)
                    .ConfigureAwait(false);

                if (identity is { Id: not null })
                {
                    lock (_gate)
                    {
                        var entry = EntryFor(game);
                        entry.IdentityId = identity.Id;
                        entry.IdentityRegion = identity.Region;
                        _identity[game.Id] = identity;
                        context = ContextFor(game, console, entry);
                    }

                    Save();
                }
            }

            if (!WantsSearch(game, context, cover))
            {
                continue;
            }

            await SearchGameAsync(game, console, context, cover, cancellationToken).ConfigureAwait(false);
            searched++;
        }

        Save();
        return searched;
    }

    public void Save()
    {
        string json;

        lock (_gate)
        {
            json = _index.Serialize();
        }

        lock (_saveGate)
        {
            Directory.CreateDirectory(CacheRoot);
            var temporary = _indexPath + ".tmp";
            File.WriteAllText(temporary, json);
            File.Move(temporary, _indexPath, overwrite: true);
        }
    }

    /* Resolution */

    private sealed record GameContext(string? Platform, string Title, string? Id, string? Region);

    private sealed record ProviderRecord(string Page, string Title, string Platform);

    private ResolvedArtwork ResolveKind(
        GameContext context,
        ArtworkIndexEntry entry,
        string kind,
        string? localCoverUrl)
    {
        // Re-apply audited metadata when reading an older cache. This lets fixes to a
        // known scan take effect without forcing another provider download.
        foreach (var candidate in entry.Candidates)
        {
            Review(candidate, context);
            DsStickerExtractor.TryPrepare(candidate);
        }

        if (entry.Selections.TryGetValue(kind, out var selected))
        {
            if (selected == "generated")
            {
                return new ResolvedArtwork(null, "manual generated fallback", "generated", null);
            }

            var manual = entry.Candidates.FirstOrDefault(candidate =>
                candidate.Id == selected && candidate.Kind == kind && FirstUsable(context, candidate));

            if (manual is not null)
            {
                return Summary(manual, "manual selection");
            }
        }

        // The emulator's own case front beats any online candidate.
        if (kind == "frontCover" && !string.IsNullOrWhiteSpace(localCoverUrl))
        {
            return new ResolvedArtwork(localCoverUrl, "existing local artwork", "emulator", null);
        }

        if (kind is "frontCover" or "discLabel")
        {
            var first = entry.Candidates.FirstOrDefault(candidate =>
                candidate.Kind == kind && FirstUsable(context, candidate));

            if (first is not null)
            {
                return Summary(first, $"first available {(kind == "frontCover" ? "box" : "disc")} artwork");
            }
        }

        var candidates = entry.Candidates
            .Where(candidate => candidate.Kind == kind && Eligible(context, candidate))
            .ToList();

        var exact = candidates
            .Where(candidate => candidate.ExactId is not null && Normalize(candidate.ExactId) == Normalize(context.Id))
            .ToList();

        if (exact.Count == 1)
        {
            return Summary(exact[0], "exact game ID");
        }

        if (exact.Count == 0 && candidates.Count == 1)
        {
            return Summary(candidates[0], "title + platform + region");
        }

        return new ResolvedArtwork(
            null,
            exact.Count > 1 || candidates.Count > 1
                ? "multiple matches: choose artwork"
                : "no safe match: generated artwork",
            "generated",
            null);
    }

    private ResolvedArtwork Summary(ArtworkCandidate candidate, string match) =>
        new($"https://{Host}/{candidate.File}", match, candidate.Source, candidate.LabelRect);

    private bool Eligible(GameContext context, ArtworkCandidate candidate)
    {
        if (!string.IsNullOrEmpty(candidate.Platform)
            && Normalize(candidate.Platform) != Normalize(context.Platform))
        {
            return false;
        }

        if (candidate.Conflict is not null || candidate.PreparationRequired)
        {
            return false;
        }

        if (candidate.Width is int width && candidate.Height is int height && Math.Min(width, height) < ReviewFloor)
        {
            return false;
        }

        if (!HasFile(candidate))
        {
            return false;
        }

        if (candidate.ExactId is not null && Normalize(candidate.ExactId) == Normalize(context.Id))
        {
            return true;
        }

        return Comparable(candidate.Title) == Comparable(context.Title)
            && candidate.Region == context.Region
            && Edition(candidate.Title) == Edition(context.Title)
            && !candidate.EditionUnverified;
    }

    /// <summary>
    /// The workshop's "first usable" rule is looser than eligibility: the image must be of
    /// this game on this platform, not the single safe match, but flagged items are rejected.
    /// </summary>
    private bool FirstUsable(GameContext context, ArtworkCandidate candidate)
    {
        if (!HasFile(candidate) || candidate.Conflict is not null || candidate.PreparationRequired)
        {
            return false;
        }

        if (!string.IsNullOrEmpty(candidate.Platform)
            && Normalize(candidate.Platform) != Normalize(context.Platform))
        {
            return false;
        }

        return (candidate.ExactId is not null && Normalize(candidate.ExactId) == Normalize(context.Id))
            || (Comparable(candidate.Title) == Comparable(context.Title) && candidate.Region == context.Region);
    }

    private bool HasFile(ArtworkCandidate candidate) =>
        candidate.File is not null
        && FilePattern.IsMatch(candidate.File)
        && File.Exists(Path.Combine(CacheRoot, candidate.File));

    /* Game context */

    private ArtworkIndexEntry EntryFor(GameEntry game)
    {
        var key = KeyFor(game);

        if (!_index.Games.TryGetValue(key, out var entry))
        {
            entry = new ArtworkIndexEntry();
            _index.Games[key] = entry;
        }

        return entry;
    }

    private GameContext ContextFor(GameEntry game, ConsoleDescriptor console, ArtworkIndexEntry entry)
    {
        var identity = IdentityFor(game, entry);
        return new GameContext(PlatformFor(game.ConsoleId), TitleFor(game), identity.Id, identity.Region);
    }

    private GameIdentity IdentityFor(GameEntry game, ArtworkIndexEntry entry)
    {
        if (_identity.TryGetValue(game.Id, out var cached))
        {
            return cached;
        }

        var id = entry.IdentityId ?? game.Serial;
        var region = entry.IdentityRegion;

        if (game.ConsoleId.Equals("ps1", StringComparison.OrdinalIgnoreCase) && id is null)
        {
            id = GameIdentityReader.Ps1Serial(game.LaunchTarget);
        }

        region ??= GameIdentityReader.RegionFromId(game.ConsoleId, id);

        var identity = new GameIdentity(id, region);

        if (id is not null)
        {
            _identity[game.Id] = identity;
        }

        return identity;
    }

    /// <summary>
    /// The workshop's cache key: platform + resolved path, lowercased, SHA-256. Public so a
    /// diagnostic can prove the two agree.
    /// </summary>
    public static string KeyFor(GameEntry game)
    {
        var path = Path.GetFullPath(game.LaunchTarget).ToLowerInvariant();
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{game.ConsoleId}:{path}")));
    }

    private static string? PlatformFor(string consoleId) => consoleId.ToLowerInvariant() switch
    {
        "ps1" => "Sony Playstation",
        "ps2" => "Sony Playstation 2",
        "ps3" => "Sony Playstation 3",
        "wii" => "Nintendo Wii",
        "ds" => "Nintendo DS",
        "xbox360" => "Microsoft Xbox 360",
        _ => null,
    };

    /// <summary>
    /// The provider search key: title without a marketing prefix, or the DS ROM file name.
    /// The rest of the app keeps the folder's name.
    /// </summary>
    private static string TitleFor(GameEntry game)
    {
        if (!game.ConsoleId.Equals("ds", StringComparison.OrdinalIgnoreCase))
        {
            return StudioPrefix
                .Replace(game.Title.Replace("™", string.Empty).Replace("®", string.Empty).Trim(), string.Empty)
                .Trim();
        }

        var stem = Path.GetFileNameWithoutExtension(game.LaunchTarget);
        stem = DsNumberPrefix.Replace(stem, string.Empty);
        stem = DsGroups.Replace(stem, string.Empty);
        return stem.Trim();
    }

    private static string Normalize(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        var decomposed = value.Normalize(NormalizationForm.FormKD)
            .Replace("™", string.Empty)
            .Replace("®", string.Empty)
            .ToLowerInvariant();

        var builder = new StringBuilder(decomposed.Length);

        foreach (var character in decomposed)
        {
            if (character is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                builder.Append(character);
            }
        }

        return builder.ToString();
    }

    private static string Comparable(string? value) =>
        Normalize(StudioPrefix.Replace(value ?? string.Empty, string.Empty));

    private static string Edition(string? value) =>
        string.Join(
            "|",
            EditionPattern.Matches((value ?? string.Empty).ToLowerInvariant())
                .Select(match => match.Value)
                .OrderBy(value => value, StringComparer.Ordinal));

    /* Provider search */

    private bool WantsSearch(GameEntry game, GameContext context, string? localCover)
    {
        lock (_gate)
        {
            var entry = EntryFor(game);

            if (entry.SearchedAt is not null
                && entry.SearchTitle is not null
                && entry.SearchTitle == context.Title
                && entry.SearchRegion == context.Region)
            {
                return false;
            }

            if (context.Region is null)
            {
                return false;
            }

            return KindsFor(game).Any(kind =>
                ResolveKind(context, entry, kind, kind == "frontCover" ? localCover : null).Source == "generated");
        }
    }

    private async Task SearchGameAsync(
        GameEntry game,
        ConsoleDescriptor console,
        GameContext context,
        string? localCover,
        CancellationToken cancellationToken)
    {
        var errors = new List<string>();
        var kinds = KindsFor(game);

        List<string> Wanted()
        {
            lock (_gate)
            {
                var entry = EntryFor(game);
                return kinds
                    .Where(kind => ResolveKind(context, entry, kind, kind == "frontCover" ? localCover : null).Source == "generated")
                    .ToList();
            }
        }

        try
        {
            var wanted = Wanted();

            // Exact-ID provider first. Never probe an unknown ID or guess a region.
            if (game.ConsoleId is "ps3" or "wii"
                && context.Id is not null
                && Regex.IsMatch(context.Id, "^[A-Z0-9]{6,9}$")
                && context.Region is not null)
            {
                var locale = context.Region switch
                {
                    "North America" => "US",
                    "Europe" => "EN",
                    "Japan" => "JA",
                    _ => null,
                };

                if (locale is not null)
                {
                    foreach (var kind in wanted)
                    {
                        var candidate = new ArtworkCandidate
                        {
                            Id = $"gametdb-{game.ConsoleId}-{context.Id}-{kind}-{locale}",
                            Source = "GameTDB",
                            Platform = context.Platform,
                            Title = context.Title,
                            Region = context.Region,
                            Kind = kind,
                            ExactId = context.Id,
                            Page = $"https://www.gametdb.com/{(game.ConsoleId == "ps3" ? "PS3" : "Wii")}/{context.Id}",
                            SourceUrl = $"https://art.gametdb.com/{game.ConsoleId}/{(kind == "frontCover" ? "cover" : "disc")}/{locale}/{context.Id}.png",
                        };

                        try
                        {
                            Upsert(game, await CacheImageAsync(candidate, cancellationToken).ConfigureAwait(false));
                        }
                        catch (Exception ex)
                        {
                            errors.Add($"{ex.Message} ({kind}, exact ID)");
                        }
                    }
                }
            }

            if (context.Region is not null && context.Platform is not null)
            {
                var missing = Wanted();

                if (missing.Count > 0)
                {
                    var query = context.Title.Split([" - ", ":"], StringSplitOptions.None)[0].Trim();
                    var searchUrl = "https://gamesdb.launchbox-app.com/games/results?id=" + Uri.EscapeDataString(query);
                    var html = Encoding.UTF8.GetString(await RequestAsync(searchUrl, cancellationToken).ConfigureAwait(false));

                    var records = ParseSearch(html)
                        .Where(record => Normalize(record.Platform) == Normalize(context.Platform)
                            && Comparable(record.Title) == Comparable(context.Title))
                        .Take(2)
                        .ToList();

                    if (records.Count == 0)
                    {
                        errors.Add("No exact title + platform search result; generated artwork retained.");
                    }

                    foreach (var record in records)
                    {
                        var page = Encoding.UTF8.GetString(await RequestAsync(record.Page, cancellationToken).ConfigureAwait(false));

                        var candidates = ParseImages(page, record)
                            .Where(candidate => kinds.Contains(candidate.Kind) && candidate.Region == context.Region)
                            .ToList();

                        foreach (var kind in missing)
                        {
                            foreach (var candidate in candidates.Where(candidate => candidate.Kind == kind).Take(3))
                            {
                                try
                                {
                                    Upsert(game, await CacheImageAsync(Review(candidate, context), cancellationToken).ConfigureAwait(false));
                                }
                                catch (Exception ex)
                                {
                                    errors.Add(ex.Message);
                                }
                            }
                        }
                    }
                }
            }

            if (context.Region is null)
            {
                errors.Add("Region is unknown; automatic title matching is unavailable.");
            }
        }
        catch (Exception ex)
        {
            errors.Add(ex.Message);
        }

        lock (_gate)
        {
            var entry = EntryFor(game);
            entry.Errors = errors;
            entry.SearchedAt = DateTimeOffset.UtcNow.ToString("O");
            entry.SearchTitle = context.Title;
            entry.SearchRegion = context.Region;
        }

        Save();
    }

    private static IReadOnlyList<string> KindsFor(GameEntry game) =>
        game.ConsoleId.Equals("ds", StringComparison.OrdinalIgnoreCase)
            ? ["frontCover", "cartridgeLabel"]
            : ["frontCover", "discLabel"];

    private static ArtworkCandidate Review(ArtworkCandidate candidate, GameContext context)
    {
        // Findings from visual inspection, carried over from the workshop.
        if (candidate.Id == "launchbox-308984")
        {
            candidate.PrintedId = "BCUS-98199";
            candidate.ExactId = "BCUS98199";
            candidate.EditionUnverified = false;

            if (Normalize(context.Id) != Normalize(candidate.ExactId))
            {
                candidate.Conflict = $"Printed BCUS-98199; local ID is {context.Id}";
            }
        }

        if (candidate.Id == "launchbox-1980124")
        {
            candidate.Conflict = "Image says Special Edition; verify your edition";
        }

        if (candidate.Id == "launchbox-873660")
        {
            candidate.ExactId = "AMCE";
            candidate.LabelRect = [43, 20, 429, 474];
            candidate.PreparationRequired = false;
        }

        if (candidate.Id == "launchbox-20131120")
        {
            candidate.ExactId = "B3CE";
            candidate.LabelRect = [43, 20, 429, 474];
            candidate.PreparationRequired = false;
        }

        if (candidate.Id == "launchbox-1871902")
        {
            // Same 517 x 564 real-scan family as the two reviewed cards above: the crop
            // keeps the complete NTR-YIMP-EUR sticker and excludes the moulded card body.
            candidate.ExactId = "YIMP";
            candidate.LabelRect = [43, 20, 429, 474];
            candidate.PreparationRequired = false;
        }

        return candidate;
    }

    private static List<ProviderRecord> ParseSearch(string html)
    {
        var records = new List<ProviderRecord>();
        var matches = Regex.Matches(
            html,
            "href=\"(/games/details/\\d+-[^\"?#]+)\"([\\s\\S]*?)(?=<a class=\"list-item|$)",
            RegexOptions.Singleline | RegexOptions.CultureInvariant);

        foreach (Match match in matches)
        {
            var heading = Regex.Match(
                match.Groups[2].Value,
                "<h3\\b[^>]*>([\\s\\S]*?)</h3>\\s*<p\\b[^>]*>([\\s\\S]*?)</p>",
                RegexOptions.Singleline | RegexOptions.CultureInvariant);

            if (!heading.Success)
            {
                continue;
            }

            records.Add(new ProviderRecord(
                "https://gamesdb.launchbox-app.com" + match.Groups[1].Value.Replace("/details/", "/images/"),
                Plain(heading.Groups[1].Value),
                Plain(heading.Groups[2].Value)));
        }

        return records;
    }

    private static List<ArtworkCandidate> ParseImages(string html, ProviderRecord record)
    {
        var candidates = new List<ArtworkCandidate>();
        var matches = Regex.Matches(
            html,
            "href=\"(https://images\\.launchbox-app\\.com/[^\"\\s]+)\"\\s+data-gameimageid=\"(\\d+)\"[\\s\\S]*?data-title=\"([^\"]+)\"",
            RegexOptions.CultureInvariant);

        foreach (Match match in matches)
        {
            var label = WebUtility.HtmlDecode(match.Groups[3].Value);
            var type = GalleryLabel.Match(label);

            if (!type.Success)
            {
                continue;
            }

            candidates.Add(new ArtworkCandidate
            {
                Id = "launchbox-" + match.Groups[2].Value,
                Source = "LaunchBox",
                SourceUrl = match.Groups[1].Value,
                Page = record.Page,
                Title = record.Title,
                Platform = record.Platform,
                Region = type.Groups[2].Success ? type.Groups[2].Value : null,
                Kind = type.Groups[1].Value switch
                {
                    "Box - Front" => "frontCover",
                    "Disc" => "discLabel",
                    _ => "cartridgeLabel",
                },
                // A generic cart photograph needs its sticker cropped; the reviewed
                // candidates above are the only ones allowed to clear this.
                PreparationRequired = type.Groups[1].Value == "Cart - Front",
                EditionUnverified = type.Groups[1].Value == "Disc",
                Label = label,
            });
        }

        return candidates;
    }

    private static string Plain(string value) =>
        Regex.Replace(WebUtility.HtmlDecode(Regex.Replace(value, "<[^>]*>", " ")), "\\s+", " ").Trim();

    /* Cache */

    private async Task<ArtworkCandidate> CacheImageAsync(ArtworkCandidate candidate, CancellationToken cancellationToken)
    {
        var bytes = await RequestAsync(candidate.SourceUrl, cancellationToken).ConfigureAwait(false);

        if (!ImageHeaders.TryRead(bytes, out var format, out var width, out var height))
        {
            throw new InvalidOperationException("Unsupported artwork image");
        }

        if ((long)width * height > MaxPixels)
        {
            throw new InvalidOperationException("Artwork image exceeds 32 MP");
        }

        var extension = format == "jpeg" ? "jpg" : format;
        var file = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(candidate.SourceUrl))) + "." + extension;

        Directory.CreateDirectory(CacheRoot);
        await File.WriteAllBytesAsync(Path.Combine(CacheRoot, file), bytes, cancellationToken).ConfigureAwait(false);

        var cached = candidate.Copy();
        cached.File = file;
        cached.Width = width;
        cached.Height = height;
        cached.QualityNote = Math.Min(width, height) < ReviewFloor ? "Low resolution: review before use" : null;
        DsStickerExtractor.TryPrepare(cached);
        return cached;
    }

    private async Task<byte[]> RequestAsync(string url, CancellationToken cancellationToken)
    {
        var target = new Uri(url);

        if (target.Scheme != Uri.UriSchemeHttps || !AllowedHosts.Contains(target.Host))
        {
            throw new InvalidOperationException("Artwork host is not allowed");
        }

        await _requestGate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(RequestTimeout);

            using var response = await _http
                .GetAsync(target, HttpCompletionOption.ResponseHeadersRead, timeout.Token)
                .ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                throw new HttpRequestException($"{target.Host}: HTTP {(int)response.StatusCode}");
            }

            if (response.Content.Headers.ContentLength > MaxBytes)
            {
                throw new InvalidOperationException("Artwork response exceeds 12 MiB");
            }

            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
            using var memory = new MemoryStream();
            var buffer = new byte[64 * 1024];
            int read;

            while ((read = await stream.ReadAsync(buffer, timeout.Token).ConfigureAwait(false)) > 0)
            {
                if (memory.Length + read > MaxBytes)
                {
                    throw new InvalidOperationException("Artwork response exceeds 12 MiB");
                }

                memory.Write(buffer, 0, read);
            }

            return memory.ToArray();
        }
        finally
        {
            // Serialize the providers, not just the sockets: the workshop found that
            // bursts get throttled, and 250 ms between requests stays under that.
            await Task.Delay(RequestGap, CancellationToken.None).ConfigureAwait(false);
            _requestGate.Release();
        }
    }

    private void Upsert(GameEntry game, ArtworkCandidate candidate)
    {
        lock (_gate)
        {
            var entry = EntryFor(game);
            var index = entry.Candidates.FindIndex(existing => existing.Id == candidate.Id);

            if (index < 0)
            {
                entry.Candidates.Add(candidate);
            }
            else
            {
                entry.Candidates[index] = candidate;
            }
        }
    }
}
