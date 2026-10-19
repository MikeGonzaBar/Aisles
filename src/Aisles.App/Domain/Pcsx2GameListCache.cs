namespace Aisles.App.Domain;

/// <summary>
/// Reads PCSX2's <c>cache/gamelist.cache</c>, which carries each disc's serial and its
/// real title ("SLUS-20946", "Grand Theft Auto - San Andreas") — far better than the
/// file name <c>SAN_ANDREAS.ISO</c>.
///
/// Treated as evidence, never as a contract. The file is version-specific binary, so
/// rather than assume a fixed record layout this walks the file looking for
/// length-prefixed string triples: a game path, a serial, a title. Whatever binary
/// fields follow a record are skipped naturally, because scanning resumes after the
/// title. If a future PCSX2 changes the format the worst case is that the cache stops
/// contributing, not that the app breaks.
/// </summary>
public sealed class Pcsx2GameListCache
{
    private const int MinStringLength = 1;
    private const int MaxStringLength = 1024;

    private readonly Dictionary<string, Entry> _byPath;

    public readonly record struct Entry(string Serial, string Title);

    private Pcsx2GameListCache(Dictionary<string, Entry> byPath) => _byPath = byPath;

    public int Count => _byPath.Count;

    public bool TryGet(string path, out Entry entry) => _byPath.TryGetValue(Normalize(path), out entry);

    /// <summary>Finds the cache beside a PCSX2 executable, or null if there isn't one.</summary>
    public static string? Locate(string emulatorPath)
    {
        var root = Path.GetDirectoryName(emulatorPath);
        if (string.IsNullOrEmpty(root))
        {
            return null;
        }

        var candidate = Path.Combine(root, "cache", "gamelist.cache");
        return File.Exists(candidate) ? candidate : null;
    }

    public static Pcsx2GameListCache? TryLoad(string emulatorPath)
    {
        var path = Locate(emulatorPath);
        if (path is null)
        {
            return null;
        }

        try
        {
            return Parse(File.ReadAllBytes(path));
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    public static Pcsx2GameListCache Parse(byte[] bytes)
    {
        var entries = new Dictionary<string, Entry>(StringComparer.OrdinalIgnoreCase);
        var offset = 0;

        while (offset < bytes.Length)
        {
            if (!TryReadString(bytes, offset, out var path, out var afterPath)
                || !LooksLikeGamePath(path))
            {
                offset++;
                continue;
            }

            if (!TryReadString(bytes, afterPath, out var serial, out var afterSerial)
                || !LooksLikeSerial(serial))
            {
                offset++;
                continue;
            }

            if (!TryReadString(bytes, afterSerial, out var title, out var afterTitle)
                || title.Length == 0)
            {
                offset++;
                continue;
            }

            entries[Normalize(path)] = new Entry(serial, title);
            offset = afterTitle;
        }

        return new Pcsx2GameListCache(entries);
    }

    /// <summary>Reads a little-endian uint32 length followed by that many bytes of text.</summary>
    private static bool TryReadString(byte[] bytes, int offset, out string value, out int next)
    {
        value = string.Empty;
        next = offset;

        if (offset < 0 || offset + 4 > bytes.Length)
        {
            return false;
        }

        var length = BitConverter.ToUInt32(bytes, offset);
        if (length < MinStringLength || length > MaxStringLength)
        {
            return false;
        }

        var start = offset + 4;
        if (start + (long)length > bytes.Length)
        {
            return false;
        }

        // Reject anything with control bytes. Bytes above 127 are allowed: titles are
        // UTF-8 and can legitimately carry accents.
        for (var i = 0; i < (int)length; i++)
        {
            var b = bytes[start + i];
            if (b < 32 || b == 127)
            {
                return false;
            }
        }

        value = System.Text.Encoding.UTF8.GetString(bytes, start, (int)length);
        next = start + (int)length;
        return true;
    }

    private static bool LooksLikeGamePath(string value) =>
        value.Length > 3
        && char.IsLetter(value[0])
        && value[1] == ':'
        && (value[2] == '\\' || value[2] == '/')
        && value.Contains('.');

    private static bool LooksLikeSerial(string value) =>
        value.Length is >= 9 and <= 11
        && char.IsAsciiLetterUpper(value[0])
        && value.Contains('-');

    private static string Normalize(string path)
    {
        var trimmed = path.Trim().TrimEnd('\\', '/');

        try
        {
            return Path.GetFullPath(trimmed);
        }
        catch (ArgumentException)
        {
            return trimmed;
        }
        catch (NotSupportedException)
        {
            return trimmed;
        }
        catch (PathTooLongException)
        {
            return trimmed;
        }
    }
}
