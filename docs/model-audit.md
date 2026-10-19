# Downloaded console model audit

Follow-up: prepared runtime copies, placement settings and a comparison workshop are now implemented. See `docs/model-preparation.md` for current setup, results and verification status. The findings below describe the original downloads before preparation.

Inspected the six GLB files and the source ZIP entry lists in `3d models/` on 2026-10-18. The files were not modified. This assessment compares them with Aisles' WebView2 + Three.js display and media-insertion goals.

## Verdict

All six are sensible source assets in the right runtime format. Keep the originals. PS3 is the strongest candidate to try directly; PS1, PS2 and Xbox 360 need runtime optimization. DS Lite is very lightweight but needs a close-up quality check. Wii uses vertex colors rather than textures and needs a material/detail review.

| Console | GLB size (MiB) | Triangles | Mesh primitives | Texture images | Recommendation |
|---|---:|---:|---:|---|---|
| PS1 | 36.83 | 7,470 | 40 | Four 4096×4096 | Keep; create a 2K runtime version, retain 4K source. Identify lid geometry and set a hinge pivot before promising insertion animation. |
| PS2 | 56.86 | 10,839 | 7 | Three 4096×4096; nineteen 2048×2048 | Keep for personal prototype; largest texture burden. Reduce/atlas maps, review body transparency, identify or separate tray geometry. License limits commercial use. |
| PS3 | 3.44 | 32,689 | 9 | One 2048×2048; one 1024×512 | Good first integration candidate. Separate plastic, chrome, metal and logo materials; assess reflections under the app's lighting. |
| Wii | 1.94 | 32,480 | 5 | None | Keep provisionally. Multiple vertex colors are present, including white, gray and colored details; this is not an uncolored model. One shared double-sided material with roughness 0.6 limits per-surface finish. Assess labels, ports and slot detail visually. |
| DS Lite | 2.88 | 1,186 | 3 | Three 2048×2048 | Excellent geometry budget; low-poly silhouette may show at close range. Separate base/Clamshell/Glass hierarchy supports further animation preparation. Check hinge pivot, glass transparency and unusually metallic body material (metallic factor ~0.74). |
| Xbox 360 | 27.72 | 186,732 | 4 | Three 4096×4096 | Usable desktop source, heaviest geometry. Consider simplification toward roughly 30–60K triangles if appearance survives; use 2K maps initially. Entire shared material uses BLEND; check whether opacity is needed. Mesh chunks are not named as functional parts. |

Triangle counts count each mesh definition once; primitive counts are not measured draw-call counts. Files have GLB v2 headers with matching declared lengths, embedded buffers/images, and no mandatory glTF extensions. PS1 and PS3 declare optional KHR_materials_specular. These are compatibility signals, not full glTF-validator results.

## Memory and animation

Approximate uncompressed RGBA8 image memory including mipmaps: PS1 341 MiB, PS2 661 MiB, Xbox 360 256 MiB, DS 64 MiB, PS3 24 MiB. These estimates assume each image is uploaded once, exclude geometry/render targets and other scene resources, and are not measured GPU allocations. They explain why download size alone is misleading. Reducing both image dimensions by half cuts this estimate to a quarter. Keep only the active console resident where practical; dispose GPU resources when replacing it.

None of the six GLBs contains animation clips or skins. Rigid console movement can be implemented in code; lids/trays need correctly separated parts and pivots. DS has an explicitly named clamshell group. PS1 has many generic Cube/Cylinder objects; their physical roles are unconfirmed. PS2 has a tray-logo material, but that does not establish an independent working tray. Wii/PS3 can use moving discs plus clipping/occlusion at their slots once slot positions are established. Xbox chunks span broad body bounds and do not demonstrate a separately animatable tray.

## Source files and attribution

The downloaded ZIPs contain: PS1 Blender source; DS FBX; Wii IGES CAD source; Xbox GLB source; PS2 and PS3 nested source ZIPs. Nested archives were not extracted or audited. ZIP entry lists contain no separate license file; the GLBs themselves embed the following attribution metadata.

| Asset | Creator | Embedded license | Source |
|---|---|---|---|
| SONY PlayStation One | Vladimir_Sofyanov | CC BY 4.0 | https://sketchfab.com/3d-models/sony-playstation-one-4afd87cc153346f8a8400a1e8517a6c9 |
| PlayStation 2 | Smoggybeard | CC BY-NC-SA 4.0 | https://sketchfab.com/3d-models/playstation-2-8c992e9f5c86496ca7bd7dfe109d3cc2 |
| classic ps3 | jei3323 | CC BY 4.0 | https://sketchfab.com/3d-models/classic-ps3-7c3e84e5bf514bd1be45788f74dc3d1f |
| Nintendo Wii (RVL-001) | Djsigksj | CC BY 4.0 | https://sketchfab.com/3d-models/nintendo-wii-rvl-001-84d7958819f34ab6ad4d30dbbaed11c3 |
| Nintendo DS Lite | Cianon | CC BY 4.0 | https://sketchfab.com/3d-models/nintendo-ds-lite-ca529eb7208746e89b7a28fd2246659d |
| Classic Xbox 360 - White Edition | Anand Stephen | CC BY 4.0 | https://sketchfab.com/3d-models/classic-xbox-360-white-edition-a88f93403ba64726a4b68611db420a67 |

CC BY requires attribution, a license link and identification of changes when sharing. PS2 additionally prohibits commercial use and requires distributed adaptations to retain its license. This concerns the licensed asset/adaptations; it is not a finding that the entire application must have that license. A commercial release needs a different PS2 asset or separate permission. References: https://creativecommons.org/licenses/by/4.0/ and https://creativecommons.org/licenses/by-nc-sa/4.0/ . Metadata is evidence of the downloaded files' declared licenses, not an independent rights-clearance audit.

## Verification limits and reproducibility

`node tools/inspect-models.cjs` produces the structural JSON saved as `docs/model-audit-data.json`. The inspector reads GLB headers, JSON scene structure and embedded image headers; it is not a complete glTF validator.

A local comparison viewer is prepared at `prototype/model-audit.html`, served with `node tools/serve-model-audit.cjs` on http://127.0.0.1:8766/prototype/model-audit.html . It uses pinned Three.js 0.180.0 from jsDelivr, requires network access for that library, and reads the model files locally. Visual testing could not run: browser navigation was blocked twice because the automatic approval service was at capacity. No screenshots, frame-rate measurements, rendering success or final visual-quality claims are asserted. WebView2 behavior remains untested.

GameCube and Nintendo 3DS models are missing from this downloaded set. DS Lite represents DS, not 3DS. The project plan still describes procedural assets; it has not been changed by this audit.
