# Procedural game media

Open <http://127.0.0.1:8766/prototype/media-preview.html> while `npm run preview` is running. The workshop generates the current platforms' retail cases and playable media in Three.js. It does not depend on downloaded case meshes.

## Encoded dimensions

One scene unit equals 100 mm. This keeps every family in a common scale while remaining convenient for Three.js lighting and camera values.

| Platform | Case | Case dimensions (W x H x D) | Playable medium |
|---|---|---:|---|
| PlayStation | CD jewel case | 142 x 125 x 10 mm | 120 x 1.2 mm CD-ROM |
| PlayStation 2 | black DVD keep case | 135 x 190 x 14 mm | 120 x 1.2 mm DVD-ROM or CD-ROM |
| PlayStation 3 | short Blu-ray case | 135 x 171.5 x 13 mm | 120 x 1.2 mm Blu-ray Disc |
| Wii | white DVD keep case | 135 x 190 x 14 mm | 120 x 1.2 mm Wii optical disc |
| Nintendo DS | compact DS case | 122 x 135 x 15 mm | 33 x 35 x 3.8 mm DS Game Card |
| Nintendo 3DS | compact 3DS case | 122 x 135 x 14 mm | 35 x 33 x 3.8 mm 3DS Game Card |
| Xbox 360 | green DVD keep case | 135 x 190 x 14 mm | 120 x 1.2 mm DVD-ROM |

The DVD geometry is shared by PS2, Wii and Xbox 360; only its shell and label materials change. Optical media share one annular extruded-disc generator with a physical center hole. The DS cartridge is a beveled extruded shape with the characteristic upper corner profile, label recess and molded grooves; the DS card is portrait (33 x 35 mm) while the 3DS card is landscape (35 x 33 mm). Cases include a separate cover plane and spine plane so artwork can change without rebuilding geometry.

## Workshop behavior

- Inspect a case and its playable medium together or separately.
- Compare jewel, DVD, Blu-ray and DS families at true relative scale.
- Rotate the playable medium independently as a display treatment.
- Toggle wireframe and inspect six standard camera views.
- Export the selected case and medium together as a binary GLB.

The generated label textures are placeholders for geometry review. The metadata audit in `docs/emulator-metadata-audit.md` identifies local front art for all PS1 and PS2 games, PS3 menu artwork, one DS cover and embedded DS icons. The final resolver should apply that artwork at runtime, generate missing spines and backs, and retain the platform preset for the physical geometry.

Packaging differs by region and release. These presets intentionally establish one consistent North American shelf format. Per-game exceptions can later override `mediaPreset` without changing the scanner or procedural generators.
