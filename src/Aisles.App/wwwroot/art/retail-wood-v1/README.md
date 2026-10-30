# Aisles natural-wood rental-store assets

> **Archived asset pack.** The active application uses
> `wwwroot/art/pixel-ui/` with `pixel-ui.js`. This directory is excluded from
> application builds and releases.

This study explored natural oak furniture, blue-and-yellow category signage,
neutral slatwall, and cool-white lighting for the retired Three.js interface.
It remains in the repository for asset provenance and visual-history reference.

## Files

- `carpet-confetti.webp` — generated 1024 × 1024 carpet albedo.
- `oak-laminate.webp` — generated 1024 × 1024 oak albedo.
- `console-slatwall*.svg/png` — console-band background studies.
- `category-{platform}.svg/png` — signs for the eight original platform IDs.
- `category-blank.svg/png` — editable plaque for custom platform names.
- `shelf-edge-accent.svg/png` — optional blue/yellow trim study.
- `materials.json` — experimental Three.js material values and sign mapping.
- `preview.html` — local contact sheet and flat material study.

The raster signs contain no external resources. Their SVG sources remain
editable and use Arial/sans-serif text.

## Current status

The retired `stage3d.js`, `shelf3d.js`, and bundled Three.js runtime have
been removed. None of these wood assets are loaded or packaged by the pixel-art
application. If the 3D workshop is revived, use Git history for the old
integration notes; they are not current implementation guidance.

## Validation

PNG and WebP outputs were decoded with Sharp and checked for expected dimensions.
The original study did not complete live WebView2 integration, lighting
calibration, or seam-free tiling certification.

## Creation

Carpet and oak originals were generated with the built-in image tool and retained
in `artifacts/retroshelf-backgrounds/`. Slatwall, signs, and trim were created as
editable SVGs with PNG exports. Exact raster-generation prompts are retained in
`generation-prompts.txt`.
