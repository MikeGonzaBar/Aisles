// Builds the lineup LOD: the tier the console row actually renders (PLAN.md section 5.3).
//
// Geometry is left alone — the full models are already only 1k-160k triangles, which is
// nothing next to their textures. The cost is texture memory: the PS2 runtime model alone
// carries 22 images and an estimated 469 MiB decoded. A console standing in a lineup row
// is roughly 100 px wide, so 256 px per texture is already generous.
//
// Images are re-encoded losslessly as PNG. Normal and occlusion maps are present on PS1
// and PS2, and those do not survive lossy re-encoding, so the only saving applied is size.
//
// Everything that is not an image is copied through untouched and verified byte-for-byte.

const fs = require('fs');
const path = require('path');
const { readGlb, writeGlb, check } = require('./model-lib.cjs');

const root = path.resolve(__dirname, '..');
const maxSize = Number(process.argv[2] ?? 256);

let sharp;
try {
  sharp = require('sharp');
} catch {
  if (!process.env.AISLES_NODE_MODULES) {
    throw new Error('Install dependencies with npm install, or set AISLES_NODE_MODULES to the bundled node_modules directory.');
  }
  sharp = require(path.join(process.env.AISLES_NODE_MODULES, 'sharp'));
}

const catalogPath = path.join(root, 'assets/models/catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

(async () => {
  const rows = [];
  let runtimeTotal = 0;
  let lineupTotal = 0;

  for (const model of catalog.models) {
    const runtimePath = path.join(root, 'assets/models', model.id, 'console.glb');

    if (!fs.existsSync(runtimePath)) {
      console.log(`${model.id}: no runtime model, skipped`);
      continue;
    }

    const { json: g, bin } = readGlb(runtimePath);
    const issues = check(g, bin);
    if (issues.length) throw new Error(`${model.id}: ${issues.join('; ')}`);

    const imageByView = new Map((g.images || []).map((image, index) => [image.bufferView, index]));
    const images = [];
    const chunks = [];
    let offset = 0;

    for (const [index, view] of g.bufferViews.entries()) {
      const start = view.byteOffset || 0;
      let data = bin.subarray(start, start + view.byteLength);

      if (imageByView.has(index)) {
        const image = g.images[imageByView.get(index)];
        const before = await sharp(data).metadata();
        const shrink = Math.max(before.width, before.height) > maxSize;

        data = await sharp(data)
          .resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();

        const after = await sharp(data).metadata();
        image.mimeType = 'image/png';
        images.push({ before: [before.width, before.height], after: [after.width, after.height], shrunk: shrink });
      }

      const pad = (4 - (offset % 4)) % 4;
      if (pad) {
        chunks.push(Buffer.alloc(pad));
        offset += pad;
      }

      view.byteOffset = offset;
      view.byteLength = data.length;
      chunks.push(data);
      offset += data.length;
    }

    const packed = Buffer.concat(chunks);
    g.buffers[0].byteLength = packed.length;

    const target = path.join(root, 'assets/models', model.id, 'lineup.glb');
    writeGlb(target, g, packed);

    // Same guard rail as the runtime build: the LOD must change images and nothing else.
    const original = readGlb(runtimePath);
    for (let i = 0; i < g.bufferViews.length; i++) {
      if (imageByView.has(i)) continue;
      const a = original.json.bufferViews[i];
      const b = g.bufferViews[i];
      const left = original.bin.subarray(a.byteOffset || 0, (a.byteOffset || 0) + a.byteLength);
      const right = packed.subarray(b.byteOffset, b.byteOffset + b.byteLength);
      if (!left.equals(right)) throw new Error(`Geometry changed in ${model.id} at bufferView ${i}`);
    }

    const result = readGlb(target);
    if (check(result.json, result.bin).length) throw new Error(`Lineup output failed validation: ${model.id}`);

    const triangles = g.meshes
      .flatMap((mesh) => mesh.primitives)
      .reduce((sum, primitive) => sum + g.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3, 0);

    const runtimeBytes = fs.statSync(runtimePath).size;
    const lineupBytes = fs.statSync(target).size;

    runtimeTotal += runtimeBytes;
    lineupTotal += lineupBytes;

    rows.push({
      id: model.id,
      name: model.name,
      file: `/assets/models/${model.id}/lineup.glb`,
      bytes: lineupBytes,
      runtimeBytes,
      triangles,
      images,
      estimatedTextureMiB:
        images.reduce((sum, image) => sum + (image.after[0] * image.after[1] * 4 * 4) / 3 / 1048576, 0),
    });

    const shrunk = images.filter((image) => image.shrunk).length;
    console.log(
      `${model.id.padEnd(8)} ${(runtimeBytes / 1048576).toFixed(2)} → ${(lineupBytes / 1048576).toFixed(2)} MiB` +
        `   ${String(images.length).padStart(2)} images, ${shrunk} shrunk to ≤${maxSize}`,
    );
  }

  fs.writeFileSync(
    path.join(root, 'assets/models/lineup-catalog.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        notes: 'Lineup tier for the console row (PLAN.md 5.3). Textures capped; geometry identical to the runtime model.',
        maxTextureSize: maxSize,
        models: rows,
      },
      null,
      2,
    ) + '\n',
  );

  console.log(
    `\ntotal ${(runtimeTotal / 1048576).toFixed(1)} MiB → ${(lineupTotal / 1048576).toFixed(1)} MiB` +
      `  (${((lineupTotal / runtimeTotal) * 100).toFixed(1)}%)`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
