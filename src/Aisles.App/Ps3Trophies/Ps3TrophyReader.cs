using System.Buffers.Binary;
using System.Globalization;
using System.Xml;
using System.Xml.Linq;

namespace Aisles.App.Ps3Trophies;

/// <summary>One trophy from a game's <c>TROPCONF.SFM</c>.</summary>
public sealed record Ps3TrophyDefinition(
    int Id,
    string Name,
    string? Detail,
    char Grade,
    bool Hidden,
    int PlatinumId);

/// <summary>The unlock state RPCS3 stores for one trophy in <c>TROPUSR.DAT</c>.</summary>
public sealed record Ps3TrophyProgress(int Id, bool Unlocked, DateTime? EarnedAt);

/// <summary>
/// Readers for RPCS3's two trophy files: <c>TROPCONF.SFM</c> is XML despite the extension,
/// and <c>TROPUSR.DAT</c> is a big-endian table container. Nothing here talks to PSN.
/// </summary>
public static class Ps3TrophyReader
{
    private const uint UserDataMagic = 0x818F54AD;
    private const uint TrophyPackageMagic = 0xDCA24D00;
    private const int UserDataHeaderSize = 0x30;
    private const int UserDataTableHeaderSize = 0x20;
    private const int TrophyPackageHeaderSize = 0x40;
    private const int TrophyPackageEntrySize = 0x40;
    private const int TrophyPackageMaxTableBytes = 16 * 1024 * 1024;

    /// <summary>Reads a trophy configuration file, returning definitions in display order.</summary>
    public static IReadOnlyList<Ps3TrophyDefinition> ReadConfiguration(string path)
    {
        using var stream = File.OpenRead(path);
        return ParseConfiguration(stream);
    }

    public static IReadOnlyList<Ps3TrophyDefinition> ParseConfiguration(Stream stream, bool nameFallback = true)
    {
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
        };

        using var reader = XmlReader.Create(stream, settings);
        var document = XDocument.Load(reader);
        var root = document.Root;
        if (root is null)
        {
            return Array.Empty<Ps3TrophyDefinition>();
        }

        var trophies = new List<Ps3TrophyDefinition>();
        foreach (var element in root.Elements().Where(item => item.Name.LocalName == "trophy"))
        {
            if (!int.TryParse(
                    element.Attribute("id")?.Value,
                    NumberStyles.Integer,
                    CultureInfo.InvariantCulture,
                    out var id))
            {
                continue;
            }

            var gradeText = element.Attribute("ttype")?.Value;
            var grade = string.IsNullOrEmpty(gradeText) ? 'B' : char.ToUpperInvariant(gradeText[0]);
            if (grade is not ('B' or 'S' or 'G' or 'P'))
            {
                grade = 'B';
            }

            _ = int.TryParse(
                element.Attribute("pid")?.Value,
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out var platinumId);

            var name = element.Elements().FirstOrDefault(item => item.Name.LocalName == "name")?.Value.Trim()
                ?? string.Empty;
            var detail = element.Elements().FirstOrDefault(item => item.Name.LocalName == "detail")?.Value.Trim();

            trophies.Add(new Ps3TrophyDefinition(
                id,
                nameFallback && name.Length == 0 ? $"Trophy {id:000}" : name,
                string.IsNullOrWhiteSpace(detail) ? null : detail,
                grade,
                string.Equals(element.Attribute("hidden")?.Value, "yes", StringComparison.OrdinalIgnoreCase),
                platinumId));
        }

        return trophies;
    }

    /// <summary>
    /// Reads definitions from a <c>TROPHY.TRP</c> package: <c>TROPCONF.SFM</c> holds IDs, grades
    /// and hidden flags, <c>TROP.SFM</c> holds names; a package without names still returns definitions.
    /// </summary>
    public static IReadOnlyList<Ps3TrophyDefinition>? TryReadPackageConfiguration(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            var header = new byte[TrophyPackageHeaderSize];
            stream.ReadExactly(header);

            if (BinaryPrimitives.ReadUInt32BigEndian(header) != TrophyPackageMagic)
            {
                return null;
            }

            var fileCount = BinaryPrimitives.ReadUInt32BigEndian(header.AsSpan(16));
            var entrySize = BinaryPrimitives.ReadUInt32BigEndian(header.AsSpan(20));
            var tableBytes = (ulong)entrySize * fileCount;
            if (entrySize < TrophyPackageEntrySize || fileCount > 4096
                || tableBytes > TrophyPackageMaxTableBytes)
            {
                return null;
            }

            var entries = new byte[(int)tableBytes];
            stream.ReadExactly(entries);

            var files = new Dictionary<string, (ulong Offset, ulong Size)>(StringComparer.Ordinal);
            for (var index = 0; index < fileCount; index++)
            {
                var entry = entries.AsSpan(checked((int)(index * entrySize)), TrophyPackageEntrySize);
                var name = System.Text.Encoding.ASCII.GetString(entry[..32]).Split('\0')[0];
                if (name.Length > 0)
                {
                    files[name] = (
                        BinaryPrimitives.ReadUInt64BigEndian(entry[32..]),
                        BinaryPrimitives.ReadUInt64BigEndian(entry[40..]));
                }
            }

            if (!files.TryGetValue("TROPCONF.SFM", out var configurationEntry)
                || ReadPackageEntry(stream, configurationEntry) is not { } configuration)
            {
                return null;
            }

            using var configStream = new MemoryStream(configuration, writable: false);
            var definitions = ParseConfiguration(configStream, nameFallback: false);
            if (definitions.Count == 0)
            {
                return null;
            }

            if (definitions.Any(definition => definition.Name.Length == 0)
                && files.TryGetValue("TROP.SFM", out var localisationEntry)
                && ReadPackageEntry(stream, localisationEntry) is { } localisation)
            {
                using var localisationStream = new MemoryStream(localisation, writable: false);
                var names = ParseConfiguration(localisationStream)
                    .Where(item => item.Name.Length > 0)
                    .GroupBy(item => item.Id)
                    .ToDictionary(group => group.Key, group => group.First());

                definitions = definitions
                    .Select(definition => definition.Name.Length == 0
                        && names.TryGetValue(definition.Id, out var localised)
                            ? definition with { Name = localised.Name, Detail = localised.Detail }
                            : definition)
                    .ToList();
            }

            return definitions
                .Select(definition => definition.Name.Length == 0
                    ? definition with { Name = $"Trophy {definition.Id:000}" }
                    : definition)
                .ToList();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or XmlException)
        {
            return null;
        }
    }

    private static byte[]? ReadPackageEntry(Stream stream, (ulong Offset, ulong Size) entry)
    {
        if (entry.Size == 0 || entry.Size > int.MaxValue || entry.Offset > (ulong)stream.Length
            || entry.Offset + entry.Size > (ulong)stream.Length)
        {
            return null;
        }

        var data = new byte[(int)entry.Size];
        stream.Position = (long)entry.Offset;
        stream.ReadExactly(data);
        return data;
    }

    /// <summary>Reads RPCS3's per-user trophy state for one trophy set.</summary>
    public static IReadOnlyDictionary<int, Ps3TrophyProgress> ReadProgress(string path)
    {
        try
        {
            return ParseProgress(File.ReadAllBytes(path));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new Dictionary<int, Ps3TrophyProgress>();
        }
    }

    public static IReadOnlyDictionary<int, Ps3TrophyProgress> ParseProgress(byte[] data)
    {
        var progress = new Dictionary<int, Ps3TrophyProgress>();
        if (data.Length < UserDataHeaderSize + UserDataTableHeaderSize
            || BinaryPrimitives.ReadUInt32BigEndian(data) != UserDataMagic)
        {
            return progress;
        }

        var tableCount = BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(8));
        if (tableCount is 0 or > 16)
        {
            return progress;
        }

        for (var tableIndex = 0; tableIndex < tableCount; tableIndex++)
        {
            var headerOffset = UserDataHeaderSize + (tableIndex * UserDataTableHeaderSize);
            if (headerOffset + UserDataTableHeaderSize > data.Length)
            {
                break;
            }

            var type = BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(headerOffset));
            var entrySize = (long)BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(headerOffset + 4)) + 0x10;
            var entryCount = BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(headerOffset + 12));
            var entryOffset = BinaryPrimitives.ReadUInt64BigEndian(data.AsSpan(headerOffset + 16));

            if (type != 6)
            {
                continue;
            }

            if (entrySize < 0x30 || entrySize > 0x200 || entryCount > 128
                || entryOffset > (ulong)data.Length)
            {
                return progress;
            }

            for (var entryIndex = 0; entryIndex < entryCount; entryIndex++)
            {
                var offset = entryOffset + (ulong)(entryIndex * entrySize);
                if (offset + (ulong)entrySize > (ulong)data.Length)
                {
                    break;
                }

                var position = (int)offset;
                var trophyId = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(position + 16));
                var unlocked = BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(position + 20)) != 0;
                var timestamp = BinaryPrimitives.ReadUInt64BigEndian(data.AsSpan(position + 40));

                progress[trophyId] = new Ps3TrophyProgress(
                    trophyId,
                    unlocked,
                    unlocked ? CellRtcDate(timestamp) : null);
            }
        }

        return progress;
    }

    /// <summary>
    /// Converts a CellRtc tick (microseconds elapsed since 0001-01-01) to a date. RPCS3
    /// stores the unlock timestamp in this format, not as Unix seconds.
    /// </summary>
    public static DateTime? CellRtcDate(ulong ticks)
    {
        if (ticks == 0)
        {
            return null;
        }

        var maxTicks = (ulong)(DateTime.MaxValue.Ticks / 10);
        if (ticks > maxTicks)
        {
            return null;
        }

        return new DateTime((long)(ticks * 10), DateTimeKind.Unspecified);
    }
}
