# Console runtime preparation

The originals in `3d models/` are preserved. Prepared GLBs, credits and placement settings are in `assets/models/`.

## Run the workshop

Requires Node.js 22 or newer with a working npm registry connection:

```powershell
npm install
npm run check:models
npm run preview
```

Open http://127.0.0.1:8766/prototype/model-preview.html . If the port is already in use, stop the previous preview or set `$env:AISLES_PREVIEW_PORT='8767'` before launching and use that port in the URL. The preview serves Three.js locally from `node_modules`; after installation it needs no CDN. It binds only to the local machine. The native application is not implemented by this prototype.

Select a console and switch Original/Prepared to compare at the same camera position. Lighting presets, six directional views, orbit/zoom/pan, wireframe and a 36-case representative shelf support inspection. Only one console version remains in the scene; replaced geometry, materials and textures are disposed. Changes in asset version reload the model; timings may be affected by caching. There is no side-by-side double allocation of the original and prepared console textures.

The asset panel reports file size, triangle/primitive counts and an estimated texture allocation. Live counters report observed FPS, the p95 frame interval, rendering draw calls, triangles and resident resource counts. Those are not promises about WebView2 or other computers. The sample shelf uses generic colored cases, not final platform media or cover art.

## Preparation results

| Console | Original MiB | Prepared MiB | Image allocation estimate, MiB (before → after) |
|---|---:|---:|---:|
| PS1 | 36.83 | 9.52 | 341 → 85 |
| PS2 | 56.86 | 42.15 | 661 → 469 |
| PS3 | 3.44 | 3.44 | 24 → 24 |
| Wii | 1.94 | 1.94 | 0 → 0 |
| DS Lite | 2.88 | 2.88 | 64 → 64 |
| Xbox 360 Black | 5.94 | 5.94 | 0 → 0 |

Images larger than 2048 pixels in either dimension were resized with Sharp. Other images were copied byte-for-byte. Resized images retain PNG encoding; no lossy color/normal compression, UV changes, mesh simplification or material changes were introduced. Estimates assume RGBA8 with a full mip chain for each image, not measured GPU memory. PS2 remains large because nineteen images were already 2K; further optimization should follow visual testing rather than an automatic aggressive downgrade.

The replacement Xbox 360 Black is a geometry-only OBJ source with no texture or material file. Import preparation converts its 134,672 vertices and 159,969 triangles to one GLB primitive and assigns an opaque dark PBR material. The previous white Xbox model remains in `3d models/` for provenance but is no longer the runtime asset. Its problematic shared BLEND material is therefore removed from the active pipeline.

The PS2 source archive added as `playstation-2-new.zip` has the same SHA-256 hash as the existing `playstation-2.zip`; it is not a different model. Its separate opacity texture confirms that opacity is intended as a mask. The runtime body material now uses `MASK` with cutoff `0.5`, preserving cutouts while avoiding transparent-object sorting artifacts. Other PS2 materials and all geometry remain unchanged.

`catalog.json` records source/runtime SHA-256 hashes, image dimensions, counts, credits and placement. Bounds are calculated through the original glTF scene transforms. Default placement centers X/Z, places the bounding-box bottom on the floor, and scales the largest dimension to 2.3 preview units. This is consistent presentation size, not true relative physical scale. Orientation remains the imported orientation pending a visual check.

The orientation inputs refit the adjusted console to the floor. Export placement settings downloads a replacement catalog JSON; review it and replace `assets/models/catalog.json` to persist it. The server does not write arbitrary browser changes to disk. The preparation command preserves existing catalog placement settings when rebuilding.

## Rebuild and verify

```powershell
npm run prepare:models
npm run check:models
```

When using the supplied Codex runtime instead of a local Sharp install, set `AISLES_NODE_MODULES` to that runtime's node_modules directory before running preparation. A standard npm install is the portable setup.

Checks verify all six source/runtime hashes, GLB headers and buffer/accessor extents, byte-for-byte preservation of non-image buffer views, unchanged mesh/node/accessor/material data (allowing JSON's negative-zero normalization), embedded image dimensions and the 2K image cap, license preservation and default floor/center placement. This is a focused structural check, not the official glTF validator. The catalog is generated with actual image dimensions read by Sharp.

## Visual work still pending

The preview server now serves the workshop, catalog, and prepared Xbox GLB successfully over localhost. Browser Use cannot observe this origin because a saved permission setting denies access. An offline point render confirmed the replacement Xbox silhouette, orientation, vents, drive, controls, and raised logo geometry. Full material and texture acceptance still needs a manual view in the open workshop; refresh the page after rebuilding.

After browser access is available, compare all six originals/prepared copies from front/back/sides/top/under and at close range. Specifically confirm the PS2 alpha-mask edges, Xbox Black orientation and matte finish, DS body metallic appearance and glass, Wii finish/detail, PS1 labels, and PS3 reflections. Record observed load/frame results with viewport, pixel ratio, browser and shelf state. Validate again in WebView2 during native integration.

No lid, tray or insertion animations are in scope. GameCube and 3DS are still missing. PS2 carries CC BY-NC-SA 4.0, while the other five carry CC BY 4.0; the complete embedded attribution records and modification notices are in `assets/models/ATTRIBUTION.md`.
