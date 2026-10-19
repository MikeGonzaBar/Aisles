# DS cartridge sticker: extraction review

Reviewed 2026-10-19 against the current `library-workshop-6` pipeline. Scope: what
the DS **cartridge sticker** asset actually is today, what is missing, and the
process required to prepare one. Extends
`docs/disc-cartridge-artwork-audit.md`, which covers the original sample audit.

Measurement method: every numeric claim below was produced by reading the cached
PNGs in `.cache/artwork/` with `sharp` and converting to raw RGBA, not by eye.
Most figures are reproducible from the 20 distinct `cartridgeLabel` candidates
currently in the cache. Figures are saved in `artifacts/artwork-audit/`:
`ds-cart-candidates.png`, `ds-cart-mockup-bodies.png`,
`ds-sticker-prepare-compare.png`.

## 1. There is no extraction step today

`cartridgeLabel` is resolved, downloaded, cached and shown as a selectable
candidate, but the sticker is never produced. What exists is a **UV window onto
the full cart image**, applied at render time:

| Where | What it does |
|---|---|
| `tools/artwork-workshop.cjs:78` | Marks **every** `Cart - Front` image `preparationRequired: true`. |
| `tools/artwork-workshop.cjs:104-113` | `reviewed()` hardcodes `labelRect: [43,20,429,475]` for exactly two image IDs. |
| `tools/artwork-workshop.cjs:35,40` | `eligible()` and `firstUsableArtwork()` refuse any `preparationRequired` candidate. |
| `prototype/library-preview.js:31` | `getArtworkTexture` turns `labelRect` into `texture.repeat` / `texture.offset` - a rectangle sample of the parent image. |
| `prototype/library-preview.js:38` | `makeCartridge` sizes the label plane from the rect's aspect ratio using constants `h*.87` (rect present) / `h*.55` (fallback). |

So: nothing is cropped, nothing is masked, no derived file is written, and no
provenance record exists. The only `prepare` script in the repository is
`tools/prepare-models.cjs`, which prepares console GLBs.

Consequence in the library: **2 of 20** DS cart candidates have a usable rect.
The other 18 are blocked, so **10 of the 12 installed DS games can never show
real cartridge art** - they fall back to the generated navy/yellow label.

## 2. What is actually in the cache

20 distinct `cartridgeLabel` candidates. They are not one kind of image:

| Candidate (image ID) | Size | Alpha | Opaque | Border (5x5 avg) | Family |
|---|---|---|---|---|---|
| 873660, 20131120, 1871902, 19744228, 19744694, 20000506, 9784062 | 517x564 | yes | 99.2% | `rgb(0,0,0)` | real scan |
| 1986779 | 515x567 | yes | 98.9% | `rgb(0,0,0)` | real scan |
| 1933717 | 789x839 | yes | 99.8% | `rgb(0,0,0)` | real scan |
| 2044237 | 956x1009 | yes | 90.0% | `rgb(71,112,76)` | real scan |
| 2042183 | 356x381 | **no** | 100% | `rgb(45,45,43)` | real scan |
| 609166, 620924, 621874, 622713, 640918, 653116, 689763, 690645, 695927 | 260x270 | yes | 89.4% | `rgb(245,245,245)` | **mockup** |

Two findings that change the design:

**19 of 20 are transparent PNGs, but the alpha is only the cart's outer
silhouette.** The cart is tight-cropped to the frame (99.2% opaque for the scan
family), so alpha cannot be used to find the *label* - it only identifies the
*card*. Note the transparent pixels differ by encoder: `rgb(0,0,0)` under alpha
in the scan family, `rgb(245,245,245)` in the mockup family. Any detector that
ignores alpha therefore sees a **white background** on the mockups and a black
one on the scans. This is what broke the first detection attempt in section 4.

**The nine 260x270 candidates are stock cart mockups, not photographs.** Their
cart bodies are pixel-identical (see `artifacts/artwork-audit/ds-cart-mockup-bodies.png`);
only the artwork composited into the label area differs, and that artwork is the
**box front**. Treating these as cartridge stickers would put box art on the
cartridge. `preparationRequired: true` currently blocks them, which is the right
outcome reached for the wrong reason.

## 3. Measured defects in the two live rects

Both reviewed rects are `[43,20,429,475]`. Against the Mario Kart scan (873660):

| Defect | Measurement |
|---|---|
| Rect is too tall | Crop rows average luminance ~235; the **last row averages 40** - a line of dark cart plastic is sampled along the bottom edge. Detection also reports height 474, not 475. |
| Plastic at every corner | Dark region connected to each crop corner: top-left **14x15**, top-right **14x15**, bottom-left **30x32**, bottom-right **6x12**. Total ~695 px = 0.34% of the crop. |
| Masking does not clear it | Sweeping a rounded-rectangle alpha mask 0-44 px leaves 645 (873660) / 750 (20131120) dark pixels inside the 64x64 corner blocks; residual dark pixels within 12 px of an edge are **bottom 418, left 162, right 63, top 0**. The plastic runs along the bottom and left *edges*, not only the corners, so no corner radius removes it. |

`artifacts/artwork-audit/ds-sticker-prepare-compare.png` shows today's raw
rectangle beside a cropped + rounded-mask version over a checkerboard: the
rounded mask removes the square corner but leaves the bottom-left wedge.

At shelf scale these are sub-pixel and invisible. They matter when the sticker is
magnified (the native app's detail view) or when the texture is regenerated.

## 4. Detection: a proposal generator, not an auto-apply

An alpha-aware detector was written (opaque pixels only; a pixel is "label" if
`max(rgb) > 140` and `max-min < 80`; row/column bands above 55% / 45%).

| Behaviour | Result |
|---|---|
| Reproduces the reviewed rects | 873660 -> `[43,20,429,474]` (delta 0,0,0,-1); 20131120 -> `[44,23,427,472]` (delta 1,3,-2,-3). Both within 3 px. |
| Light-framed mockups (9) | All nine return the same `[10,7,241,252]` - effectively the whole card. The silver mockup frame is as bright as the label, so the label is not separable this way. |
| Dark / saturated labels (3) | Not detected at all (1871902 Iron Man, 20000506 Sea Monsters, 2044237 Sea Monsters). |
| Saturated or narrow labels (1) | 19744228 returns a 75 px-wide strip - clearly wrong. |
| Plausible | 1933717, 19744694, 1986779, 2042183, 9784062. |

Verdict: detection is good enough to **propose** a rect (it agrees with both
human-reviewed rects and would seed the other usable scans), but it must never
apply automatically. The mockup family must be excluded by classification, not
by detection.

## 5. Proposed process

**Step 0 - Classify the source at download time.** In `parseImages` /
`cacheImage`, record what arrived instead of assuming `Cart - Front` means
"needs cropping": whether the PNG has a real alpha silhouette, the median border
colour, whether the label touches the border, and whether the card body matches
the known mockup template. This is what separates the three families in section 2.
Replace the unconditional `preparationRequired: true` with a `cartSource` field
(`scan` / `mockup` / `unknown`).

**Step 1 - Propose the rect, do not hardcode it.** Run the section 4 detector,
and store the result as a *proposal* with method and confidence. Keep
`reviewed()` as an explicit override that wins - but store its values as data,
not as source literals.

**Step 2 - One confirmation, then bake.** A human accepts or nudges the proposal
once, in the workshop. Persist `labelRect` plus `rectSource: 'detected' |
'reviewed'` on the candidate.

**Step 3 - Bake one derived asset.** Crop to the accepted rect with a 1-2 px
inset, apply the silhouette as alpha, output an sRGB PNG with alpha next to its
parent. Write a provenance record:
`{parentFile, parentSha256, rect, silhouetteId, silhouetteVersion, prepVersion,
outputFile, outputSha256, size, preparedAt}`. Regenerable, auditable, and it
replaces the current source-code literals.

**Step 4 - Take the silhouette from the geometry, not a magic radius.** Define
the label outline **once**, as the path already built in `makeCartridge`
(`library-preview.js:38`), inset by the measured margin - and use that same path
for both the alpha mask and the label geometry. Section 3 shows why a rounded
rectangle is wrong: the real outline has straight edges plus corner bevels, and
the plastic intrudes along the edges.

**Step 5 - Render from the derived asset.** Remove `labelRect` from
`getArtworkTexture` and size the label plane from the baked asset's own aspect
ratio, replacing the `h*.87` / `h*.55` constants.

**Step 6 - Test it.** Add to `tools/artwork-workshop.test.cjs`:
a detected rect lies inside the parent bounds; the baked asset has alpha and its
corner pixels are transparent; the baked aspect matches the declared label aspect
within tolerance; baking twice produces the same hash; a `mockup` candidate is
never offered as a cartridge sticker.

**Step 7 - Visual acceptance.** Render at shelf distance and at full-screen
detail. `docs/library-workshop.md` already records this as outstanding.

## 6. Open decisions

1. Should `mockup` candidates be rejected outright, or offered with a clear
   "mockup" label? Today they are silently blocked as "sticker preparation
   needed", which is misleading.
2. Should the scan family's rect be detected-and-proposed for all 11, or should
   the two reviewed ones stay authoritative and the rest wait?
3. Where do derived assets live - alongside parents in `.cache/artwork/`, or a
   `.cache/artwork/derived/` subtree keyed by parent hash?
4. Does the native `LibraryScanner` bake on import, or lazily on first display?
   Baking on import keeps the render path a plain file load, which is the
   simpler contract for C#.
