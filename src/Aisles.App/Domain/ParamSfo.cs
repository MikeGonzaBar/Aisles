using System.Text;

namespace Aisles.App.Domain;

/// <summary>
/// Minimal reader for a PlayStation <c>PARAM.SFO</c>.
///
/// Only the two keys Aisles cares about are exposed. <c>TITLE_ID</c> is the useful one:
/// it is exact and stable ("BCUS98148"). <c>TITLE</c> is often an internal abbreviation —
/// on this machine it reads "LittleBigPlanetT" — so it is treated as a last resort for
/// the display name and never as the first choice.
/// </summary>
public sealed class ParamSfo
{
    private const ushort Utf8StringFormat = 0x0204;

    private static readonly byte[] Magic = { 0x00, 0x50, 0x53, 0x46 }; // "\0PSF"

    private readonly Dictionary<string, string> _values;

    private ParamSfo(Dictionary<string, string> values) => _values = values;

    public string? Title => Get("TITLE");

    public string? TitleId => Get("TITLE_ID");

    public string? Get(string key) => _values.TryGetValue(key, out var value) ? value : null;

    /// <summary>Reads the file, returning null rather than throwing when anything is off.</summary>
    public static ParamSfo? TryRead(string path)
    {
        try
        {
            return File.Exists(path) ? Parse(File.ReadAllBytes(path)) : null;
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
        catch (InvalidDataException)
        {
            return null;
        }
    }

    public static ParamSfo Parse(byte[] bytes)
    {
        if (bytes.Length < 20 || !bytes.AsSpan(0, 4).SequenceEqual(Magic))
        {
            throw new InvalidDataException("Not a PARAM.SFO");
        }

        var keyTable = BitConverter.ToUInt32(bytes, 8);
        var dataTable = BitConverter.ToUInt32(bytes, 12);
        var count = BitConverter.ToUInt32(bytes, 16);

        var values = new Dictionary<string, string>(StringComparer.Ordinal);

        for (var index = 0u; index < count; index++)
        {
            // 20-byte header, then a 16-byte index entry per key.
            var entry = 20 + (int)(index * 16);
            if (entry + 16 > bytes.Length)
            {
                break;
            }

            var keyOffset = BitConverter.ToUInt16(bytes, entry);
            var format = BitConverter.ToUInt16(bytes, entry + 2);
            var length = BitConverter.ToUInt32(bytes, entry + 4);
            var dataOffset = BitConverter.ToUInt32(bytes, entry + 12);

            var key = ReadNullTerminated(bytes, keyTable + keyOffset);
            if (key is null || format != Utf8StringFormat)
            {
                continue;
            }

            var start = dataTable + dataOffset;
            if (start + (long)length > bytes.Length)
            {
                continue;
            }

            values[key] = Encoding.UTF8.GetString(bytes, (int)start, (int)length).TrimEnd('\0');
        }

        return new ParamSfo(values);
    }

    private static string? ReadNullTerminated(byte[] bytes, uint offset)
    {
        if (offset >= bytes.Length)
        {
            return null;
        }

        var end = (int)offset;
        while (end < bytes.Length && bytes[end] != 0)
        {
            end++;
        }

        return end == offset ? null : Encoding.ASCII.GetString(bytes, (int)offset, end - (int)offset);
    }
}
