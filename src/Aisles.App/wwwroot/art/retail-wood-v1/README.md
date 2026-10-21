# Aisles natural-wood rental-store assets

Direction: natural oak furniture with blue-and-yellow category signage, neutral slatwall and soft cool-white lighting. This supersedes the all-blue shelf in mock v2.

## Files

- carpet-confetti.webp — 1024 × 1024 generated carpet albedo.
- oak-laminate.webp — 1024 × 1024 generated oak albedo; grain runs vertically.
- console-slatwall.svg / .png — 2560 × 320 console-band background. Horizontal slatwall, narrow blue/yellow stripe, lower neutral counter strip; no consoles or baked-in objects.
- category-{platform}.svg / .png — 1600 × 96 signs for the eight platform IDs in consoles.json.
- category-blank.svg / .png — blank category plaque for custom platform names.
- shelf-edge-accent.svg / .png — optional narrow blue strip with yellow underline. Apply sparingly; leave the main boards natural wood.
- materials.json — suggested Three.js material colors and roughness, plus sign mapping.
- preview.html — local asset contact sheet and flat material study.

PNG signage rasterizes its text for predictable runtime rendering without a font download. SVG sources remain editable; their text uses Arial/sans-serif. These signs contain no external resources.

## Use in this project

Assets are already inside wwwroot/art/retail-wood-v1/ and are copied by the existing wwwroot content rule. The running app now references them: the slatwall and the shop-aisle backdrop come in through stage.css (`console-slatwall-warm.svg`, `rental-store-perspective-v1.webp`), `shelf3d.js` maps `oak-laminate.webp` onto the boards, and `stage.js` points the plaque image at `category-<platformId>.png` for the selected console.

### shelf3d.js

Keep makeBay() geometry and its moving group. Change the wood material in makeMaterials() to use oak-laminate.webp. Set map.colorSpace = THREE.SRGBColorSpace, use a white material color initially, roughness 0.72 and metalness 0. Texture color multiplied by the existing brown color would make it too dark. Rotate grain for horizontal shelf boards; use separate texture instances/UV transforms for side panels and boards.

Keep backboards dark charcoal (#252a30). The mock's wood grain and lighting require these material changes; a background image alone cannot produce them.

Attach category signage to the front of each bay's top cornice, as part of that bay's moving group. Use category-{platformId}.png, a thin plane with its natural 1600:96 aspect ratio and a small forward offset to avoid z-fighting. Increase the header fascia/headroom if necessary; do not stretch the lettering onto the existing very shallow cornice. Dispose owned textures/materials when rebuilding bays, matching existing resource ownership.

For carpet, prefer an actual floor plane aligned with the shelf camera and receiving shadows. Current scene.background is opaque, so a CSS carpet background would be hidden. Alternatively explicitly make the renderer transparent and clear scene.background before using a CSS image. Do not place carpet inside shelf backboards.

Generated textures are albedo only; there are no normal, displacement, AO or roughness maps. Do not use the colored carpet as a bump/normal map. Opposite edges were requested to match, but repeat seams have not been certified; begin with one tile across each visible surface and inspect repetition before using RepeatWrapping over a large floor.

### stage3d.js and stage.css

The console renderer is currently opaque (WebGLRenderer constructed without alpha:true); the existing comment about a transparent canvas does not match that constructor. A CSS backdrop requires a transparent renderer and no opaque scene.background, or load the image into the Three.js scene.

Use console-slatwall.png behind the lineup. It has an 8:1 ratio, close to the screenshot's shallow console strip. At other aspect ratios preserve horizontal bands with a deliberate crop or use the SVG as an adaptive CSS background. Keep the bottom counter strip aligned with the console contact plane. For large responsive changes, build wall/floor planes from these colors instead of treating the image horizon as physically fixed.

Switch the warm key (#fff2dd) toward neutral/cool white (#f2f5ff), reduce yellow-rim dominance and retune exposure against the real models. Light intensities in the existing scene are not physically calibrated, so the JSON supplies color direction rather than guaranteed final intensity settings.

### Preserve interaction

Do not replace the shelf or console scene with the full mock screenshot: media selection, slide paging, shadows and console switching still need live 3D geometry. Platform labels should follow the selected catalog entry. Existing console GLBs and game artwork are already supplied elsewhere and are not duplicated in this pack.

## Validation

Exported PNG/WebP files were decoded with Sharp and checked for expected dimensions. Slatwall and category sign were inspected visually. No app integration, live WebView2 check, lighting calibration or seam-free tiling certification is claimed.

## Creation

Carpet and oak originals: built-in image_gen tool, retained in artifacts/retroshelf-backgrounds/.
Slatwall/signs/trim: editable project-native SVGs with PNG exports, built by artifacts/retroshelf-backgrounds/build-wood-assets.cjs using the installed Sharp dependency.
Exact raster-generation prompts: generation-prompts.txt.

