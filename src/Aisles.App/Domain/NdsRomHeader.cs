using System.Text;

namespace Aisles.App.Domain;

/// <summary>
/// The first 16 bytes of a DS ROM: a 12-byte internal title and a 4-byte game code.
/// The internal title is an abbreviation, so the folder name is shown; the code is the stable key.
/// </summary>
public static class NdsRomHeader
{
    public const int HeaderLength = 16;

    public static NdsHeader? TryRead(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            var buffer = new byte[HeaderLength];

            if (stream.Read(buffer, 0, HeaderLength) < HeaderLength)
            {
                return null;
            }

            return Parse(buffer);
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

    public static NdsHeader Parse(byte[] buffer)
    {
        if (buffer.Length < HeaderLength)
        {
            throw new ArgumentException($"A DS header is {HeaderLength} bytes.", nameof(buffer));
        }

        var title = Encoding.ASCII.GetString(buffer, 0, 12).TrimEnd('\0', ' ');
        var gameCode = Encoding.ASCII.GetString(buffer, 12, 4).TrimEnd('\0', ' ');

        return new NdsHeader(title, gameCode);
    }
}

public readonly record struct NdsHeader(string InternalTitle, string GameCode);
