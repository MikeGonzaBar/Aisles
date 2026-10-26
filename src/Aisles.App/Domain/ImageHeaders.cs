namespace Aisles.App.Domain;

/// <summary>
/// Reads an image's dimensions and format from its header without decoding pixels. The
/// resolver needs both for the 384 px review floor and the 32 MP cap.
/// </summary>
public static class ImageHeaders
{
    public static bool TryRead(ReadOnlySpan<byte> bytes, out string format, out int width, out int height)
    {
        format = string.Empty;
        width = 0;
        height = 0;

        if (bytes.Length >= 24 && bytes[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }))
        {
            format = "png";
            width = BigEndian(bytes[16..20]);
            height = BigEndian(bytes[20..24]);
            return width > 0 && height > 0;
        }

        if (bytes.Length >= 4 && bytes[0] == 0xFF && bytes[1] == 0xD8)
        {
            return TryJpeg(bytes, out format, out width, out height);
        }

        if (bytes.Length >= 30 && bytes[0] == (byte)'R' && bytes[1] == (byte)'I' && bytes[2] == (byte)'F' && bytes[3] == (byte)'F'
            && bytes[8] == (byte)'W' && bytes[9] == (byte)'E' && bytes[10] == (byte)'B' && bytes[11] == (byte)'P')
        {
            return TryWebp(bytes, out format, out width, out height);
        }

        return false;
    }

    private static int BigEndian(ReadOnlySpan<byte> bytes) =>
        (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];

    private static int LittleEndian24(ReadOnlySpan<byte> bytes) =>
        bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);

    private static bool TryJpeg(ReadOnlySpan<byte> bytes, out string format, out int width, out int height)
    {
        format = "jpeg";
        width = 0;
        height = 0;

        var offset = 2;

        while (offset + 9 < bytes.Length)
        {
            if (bytes[offset] != 0xFF)
            {
                offset++;
                continue;
            }

            var marker = bytes[offset + 1];
            offset += 2;

            if (marker is 0xD8 or 0xD9)
            {
                continue;
            }

            if (marker == 0xDA)
            {
                return false; // Start of scan: no frame header before the pixels.
            }

            if (offset + 2 > bytes.Length)
            {
                return false;
            }

            var length = (bytes[offset] << 8) | bytes[offset + 1];

            if (length < 2 || offset + length > bytes.Length)
            {
                return false;
            }

            if (marker is >= 0xC0 and <= 0xCF and not 0xC4 and not 0xC8 and not 0xCC)
            {
                if (length < 7)
                {
                    return false;
                }

                height = (bytes[offset + 3] << 8) | bytes[offset + 4];
                width = (bytes[offset + 5] << 8) | bytes[offset + 6];
                return width > 0 && height > 0;
            }

            offset += length;
        }

        return false;
    }

    private static bool TryWebp(ReadOnlySpan<byte> bytes, out string format, out int width, out int height)
    {
        format = "webp";
        width = 0;
        height = 0;

        var chunk = System.Text.Encoding.ASCII.GetString(bytes[12..16]);

        if (chunk == "VP8 ")
        {
            if (bytes.Length < 30)
            {
                return false;
            }

            width = ((bytes[26] | (bytes[27] << 8)) & 0x3FFF);
            height = ((bytes[28] | (bytes[29] << 8)) & 0x3FFF);
            return width > 0 && height > 0;
        }

        if (chunk == "VP8L")
        {
            if (bytes.Length < 25)
            {
                return false;
            }

            var b0 = bytes[21];
            var b1 = bytes[22];
            var b2 = bytes[23];
            var b3 = bytes[24];
            width = 1 + (((b1 & 0x3F) << 8) | b0);
            height = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6));
            return true;
        }

        if (chunk == "VP8X")
        {
            if (bytes.Length < 30)
            {
                return false;
            }

            width = 1 + LittleEndian24(bytes[24..27]);
            height = 1 + LittleEndian24(bytes[27..30]);
            return true;
        }

        return false;
    }
}
