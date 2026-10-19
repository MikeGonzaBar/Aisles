namespace Aisles.App.Domain;

/// <summary>
/// A local image file chosen for one artwork slot, plus how it was found.
///
/// The match reason is part of the value on purpose: artwork lookup may fall back
/// to a looser rule, and PLAN.md section 3.3.1 requires that a near match is never
/// presented as an exact one.
/// </summary>
/// <param name="FilePath">The image itself. Files are referenced in place.</param>
/// <param name="Source"><c>cover-folder</c> or <c>sidecar</c>.</param>
/// <param name="Match">
/// <c>serial</c>, <c>title</c>, <c>title-contains</c>, <c>title-similar</c> or
/// <c>sidecar</c>.
/// </param>
public sealed record ArtworkReference(string FilePath, string Source, string Match);
