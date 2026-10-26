namespace Aisles.App.Domain;

/// <summary>
/// A local image chosen for one slot, plus how it was found; the match reason keeps a
/// near match from being presented as exact (PLAN.md section 3.3.1).
/// </summary>
/// <param name="FilePath">The image itself, referenced in place.</param>
/// <param name="Source"><c>cover-folder</c> or <c>sidecar</c>.</param>
/// <param name="Match"><c>serial</c>, <c>title</c>, <c>title-contains</c>, <c>title-similar</c> or <c>sidecar</c>.</param>
public sealed record ArtworkReference(string FilePath, string Source, string Match);
