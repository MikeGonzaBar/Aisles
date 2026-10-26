using System.Security;

namespace Aisles.App.Domain;

/// <summary>Scans each console independently so one unavailable drive leaves the rest usable.</summary>
public sealed class LibraryScanCoordinator
{
    public IReadOnlyList<ConsoleScan> Scan(ConsoleCatalog catalog)
    {
        var scanner = new LibraryScanner();
        var scans = new List<ConsoleScan>(catalog.Consoles.Count);

        foreach (var console in catalog.Consoles)
        {
            try
            {
                scans.Add(new ConsoleScan(console, scanner.Scan(console), null));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or SecurityException)
            {
                scans.Add(new ConsoleScan(console, Array.Empty<GameEntry>(), ex.Message));
            }
        }

        return scans;
    }
}

public sealed record ConsoleScan(ConsoleDescriptor Console, IReadOnlyList<GameEntry> Games, string? Error);
