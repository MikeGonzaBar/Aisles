// Builds Aisles.ico from the rich mark at large sizes and the flat vector at small ones;
// the rich mark blends below 48 px. Run with sharp installed and NODE_PATH set.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PROJ = path.resolve(__dirname, '..');

const SOURCES = {
  // AI-generated mark, 1254x1254, transparent background.
  rich: path.join(PROJ, 'prototype', 'icon-rich-source.png'),
  // Flat vector mark, authored on a 512 grid.
  flat: path.join(PROJ, 'prototype', 'icon-concept-a-small.svg'),
};

// prototype/icon-concept-a.svg (the wide "two spines" flat mark) is unused: the rich
// mark supersedes it at every size where it would apply. It stays in the repo as a spare.

const OUT_DIR = path.join(PROJ, 'assets');
const PNG_DIR = path.join(OUT_DIR, 'png');

// The size ladder. Change a line here to move the handoff.
const PLAN = [
  { size: 16, source: 'flat' },
  { size: 24, source: 'flat' },
  { size: 32, source: 'flat' },
  { size: 48, source: 'flat' },
  { size: 64, source: 'rich' },
  { size: 128, source: 'rich' },
  { size: 256, source: 'rich' },
];

function dirEntry(size, len, offset) {
  const b = Buffer.alloc(16);
  b.writeUInt8(size >= 256 ? 0 : size, 0); // width  (0 == 256)
  b.writeUInt8(size >= 256 ? 0 : size, 1); // height
  b.writeUInt8(0, 2); // palette entries
  b.writeUInt8(0, 3); // reserved
  b.writeUInt16LE(1, 4); // colour planes
  b.writeUInt16LE(32, 6); // bits per pixel
  b.writeUInt32LE(len, 8); // bytes in resource
  b.writeUInt32LE(offset, 12); // file offset
  return b;
}

// Classic 32bpp DIB entry (BITMAPINFOHEADER + bottom-up BGRA + AND mask).
// Used for the small sizes because every Windows shell version reads it.
function bmpEntry(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // doubled: XOR bitmap + AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(size * size * 4, 20);
  header.writeInt32LE(0, 24);
  header.writeInt32LE(0, 28);
  header.writeUInt32LE(0, 32);
  header.writeUInt32LE(0, 36);

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4; // stored bottom-up
    const dst = y * size * 4;
    for (let x = 0; x < size; x++) {
      const s = src + x * 4;
      const d = dst + x * 4;
      xor[d] = rgba[s + 2]; // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s]; // R
      xor[d + 3] = rgba[s + 3]; // A
    }
  }

  const maskRow = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskRow * size); // zeros: alpha channel carries transparency

  return Buffer.concat([header, xor, and]);
}

async function render(source, size) {
  if (source === 'rich') {
    return sharp(SOURCES.rich)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .raw()
      .toBuffer();
  }
  const density = (72 * size) / 512; // the flat SVG is authored on a 512 grid
  return sharp(SOURCES.flat, { density })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

(async () => {
  for (const key of Object.keys(SOURCES)) {
    if (!fs.existsSync(SOURCES[key])) throw new Error(`missing source: ${SOURCES[key]}`);
  }
  fs.mkdirSync(PNG_DIR, { recursive: true });

  const entries = [];
  for (const { size, source } of PLAN) {
    const raw = await render(source, size);

    const png = await sharp(raw, { raw: { width: size, height: size, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer();

    fs.writeFileSync(path.join(PNG_DIR, `aisles-${size}.png`), png);

    const asPng = size >= 256; // only the biggest is PNG-compressed, per convention
    entries.push({ size, source, data: asPng ? png : bmpEntry(raw, size), format: asPng ? 'png' : 'bmp' });
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir = entries.map((e) => {
    const entry = dirEntry(e.size, e.data.length, offset);
    offset += e.data.length;
    return entry;
  });

  const ico = Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
  const icoPath = path.join(OUT_DIR, 'Aisles.ico');
  fs.writeFileSync(icoPath, ico);

  console.log(`\n  ${icoPath}  (${ico.length} bytes)\n`);
  for (const e of entries) {
    console.log(
      `    ${String(e.size).padStart(3)}px   ${e.source.padEnd(5)}  ${e.format}   ${String(e.data.length).padStart(6)} bytes`
    );
  }
  console.log('');
})();
