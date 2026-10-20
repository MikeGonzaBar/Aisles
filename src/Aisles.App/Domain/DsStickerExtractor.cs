namespace Aisles.App.Domain;

/// <summary>
/// Recognizes LaunchBox's real Nintendo DS cartridge-scan family and turns the
/// full-card image into a sticker crop. Stock 260 x 270 mockups are deliberately
/// excluded because their label area contains resized box art.
/// </summary>
public static class DsStickerExtractor
{
    // Measured from the common 517 x 564 real-scan template. Scaling the rectangle
    // keeps the extraction stable for the same scan family at other resolutions.
    private const double Left = 43d / 517d;
    private const double Top = 20d / 564d;
    private const double Width = 429d / 517d;
    private const double Height = 474d / 564d;

    public static bool TryPrepare(ArtworkCandidate candidate)
    {
        if (!string.Equals(candidate.Kind, "cartridgeLabel", StringComparison.Ordinal)
            || !string.Equals(candidate.Source, "LaunchBox", StringComparison.OrdinalIgnoreCase)
            || candidate.LabelRect is not null
            || candidate.Width is not int sourceWidth
            || candidate.Height is not int sourceHeight
            || sourceWidth < 350
            || sourceHeight <= sourceWidth)
        {
            return false;
        }

        var aspect = (double)sourceWidth / sourceHeight;
        if (aspect is < 0.90 or > 0.95)
        {
            return false;
        }

        var x = Scale(sourceWidth, Left);
        var y = Scale(sourceHeight, Top);
        var width = Math.Min(Scale(sourceWidth, Width), sourceWidth - x);
        var height = Math.Min(Scale(sourceHeight, Height), sourceHeight - y);

        candidate.LabelRect = [x, y, width, height];
        candidate.PreparationRequired = false;
        return true;
    }

    private static int Scale(int source, double fraction) =>
        Math.Max(1, (int)Math.Round(source * fraction, MidpointRounding.AwayFromZero));
}
