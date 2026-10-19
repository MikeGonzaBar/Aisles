# Phase 3: the 3D console lineup

Verified in the running app by reading the live Three.js scene out of the page and
screenshotting it (`artifacts/phase3/`). Objective state, not just pixels:

```
lineup band 1329x210 · game row 71px
6 models loaded, 2 placeholders (GameCube, 3DS)
80 draw calls · 246,481 triangles · 34 textures · 21 shader programs
selected ps1 · spotlight x=-5.07 (slot x=-5.075) intensity=30
clicking the Wii slot -> selectedConsoleId = wii
0 page problems
```

![The stage with PlayStation selected](../artifacts/phase3/phase3-stage.png)

## What the band does

The console strip is the platform switcher (PLAN.md §6). Every console in
`consoles.json` stands on one floor line with its short name and game count beneath.
The selected one is lifted, scaled 1.22×, given a yellow platform and takes a
spotlight that slides to it. Hover lifts a console slightly and turns the cursor into
a pointer; a click goes back through `window.aislesSelectConsole`, the same path the
list uses. The camera is fixed with a gentle idle drift — no orbit, no zoom (§6).

Consoles with no games folder (GameCube, 3DS) still occupy their slot, drawn as a
dashed ghost box labelled *no games folder*, so the row reflects the catalog rather
than the models that happen to exist.

## The lineup LOD

The plan calls for two model tiers (§5.3). The full runtime models are unusable in a
row of eight: PS2 alone is 42 MiB and carries 22 textures, an estimated 469 MiB
decoded. A console in the lineup is ~100 px wide, so 256 px per texture is already
generous.

`tools/build-lineup-models.cjs` produces `assets/models/<id>/lineup.glb`:

| Console | Runtime | Lineup | Images |
|---|---|---|---|
| PS1 | 9.52 MiB | 1.06 MiB | 4 (all shrunk to ≤256) |
| PS2 | 42.15 MiB | 1.85 MiB | 22 (all shrunk) |
| PS3 | 3.44 MiB | 1.70 MiB | 2 (all shrunk) |
| Wii | 1.94 MiB | 1.94 MiB | 0 |
| DS | 2.88 MiB | 0.19 MiB | 3 (all shrunk) |
| Xbox 360 | 5.94 MiB | 5.94 MiB | 0 |
| **total** | **65.9 MiB** | **12.7 MiB** | 19.3% |

Geometry is untouched. The triangle counts (1k–160k) are irrelevant next to texture
memory, and the build verifies every non-image buffer view is byte-identical to the
runtime model. Images are re-encoded losslessly as PNG because PS1 and PS2 both carry
normal and occlusion maps, which do not survive a lossy pass.

Wii and Xbox 360 have no textures at all, so they are pure geometry and do not shrink.
That is visible in the numbers rather than hidden by them.

Models are normalized at runtime, not baked into the file: the largest dimension is
scaled to 0.82, the model is centred on X/Z and rested on the floor. The source models
ship in wildly different units, and this makes the row consistent regardless.

## Offline bundling

`tools/vendor-three.cjs` copies three.js 0.180.0 out of `node_modules` into
`src/Aisles.App/wwwroot/vendor/` — the module build, `three.core.min.js` (the module
build is a thin re-export over it), `GLTFLoader`, `BufferGeometryUtils`,
`RoomEnvironment` and the MIT licence. 856 KiB committed, no CDN, no npm install needed
to run.

The page uses an import map for `three` and `three/addons/`, so the addons' internal
`from 'three'` imports resolve unchanged. `stage3d.js` is a module; `stage.js` stays a
classic script because its top-level `state` is what the verification harness and any
future debugging session reads.

Reflections come from `RoomEnvironment` through `PMREMGenerator` rather than an HDRI
file, so the gloss reads correctly while staying fully offline.

## Degrading without WebGL

If context creation or the model tier fails, `stage3d-failed` is set on `<body>` and CSS
swaps the canvas for the 2D console list, which `stage.js` still populates. Platform
switching never depends on the 3D path. Proven by toggling the class in the running app
and screenshotting the result (`artifacts/phase3/phase3-fallback.png`).

## Still open

- **Look sign-off.** This is the Phase 3 checkpoint in §7: the console composition
  should be agreed before Phase 4 builds the shelf beside it.
- **The full-model tier.** Only the lineup LOD ships. The plan reserves the full model
  for the selected slot, but at 1.22× in a 100 px row a 42 MiB load would buy nothing;
  it belongs with a hero console view, which does not exist yet. Wiring it now would
  mean copying 66 MiB into every build for no visible gain.
- **GameCube and 3DS models** are still unmodelled, so those slots stay ghosts.
- **Model orientation** is per-console yaw in `YAW` (currently all zero). The renders
  read correctly; if a console later looks like it is facing away, that table is the
  single place to fix it.
