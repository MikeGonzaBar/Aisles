// Aisles - the shelf's and the hero's physical media.
//
// One table of real packaging, in millimetres, drives both views. The workshop in
// prototype/media-preview.js established these numbers; keeping them in one module means
// a case cannot be one shape on the shelf and another in the hero.
//
// The shelf renders at 0.0022 scene units per millimetre (a DVD case is 0.30 x 0.42, the
// size the bay was tuned around); the hero uses 0.01, the workshop's 1 unit = 100 mm.
//
// Two details are easy to get wrong and are encoded here rather than guessed per call:
// a jewel case is landscape (142 x 125) with a square 120 mm booklet, and a DS game card
// is portrait (33 x 35) while a 3DS card is landscape (35 x 33).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const HERO_UNIT = 0.01;
export const SHELF_UNIT = 0.0022;

/** Real packaging in millimetres: [width, height, depth]. */
export const PRESETS = {
  jewel: {
    case: [142, 125, 10],
    inlay: [120, 120],
    clear: true,
    medium: { kind: 'disc', size: [120, 1.2] },
    mediumName: 'CD-ROM',
  },
  dvd: {
    case: [135, 190, 14],
    inlay: [129, 183],
    medium: { kind: 'disc', size: [120, 1.2] },
    mediumName: 'DVD-ROM',
  },
  bluray: {
    case: [135, 171.5, 13],
    inlay: [129, 166],
    medium: { kind: 'disc', size: [120, 1.2] },
    mediumName: 'Blu-ray',
  },
  gamecube: {
    case: [135, 190, 14],
    inlay: [129, 183],
    medium: { kind: 'disc', size: [80, 1.2] },
    mediumName: 'miniDVD',
  },
  ds: {
    case: [122, 135, 15],
    inlay: [118, 131],
    mediumBody: '#2b2b31',
    medium: { kind: 'card', size: [33, 35, 3.8] },
    mediumName: 'Game card',
  },
  '3ds': {
    case: [122, 135, 14],
    inlay: [118, 131],
    mediumBody: '#2b2b31',
    medium: { kind: 'card', size: [35, 33, 3.8] },
    mediumName: 'Game card',
  },
  xbox360: {
    case: [135, 190, 14],
    inlay: [129, 183],
    medium: { kind: 'disc', size: [120, 1.2] },
    mediumName: 'DVD-ROM',
  },
};

/** consoles.json still names the packaging, so a hand-added platform needs no code. */
const BY_MEDIA = {
  JewelCase: 'jewel',
  DvdCase: 'dvd',
  BluRayCase: 'bluray',
  MiniDiscCase: 'gamecube',
  CartridgeCase: 'ds',
};

export function presetFor(console) {
  return PRESETS[console?.id] ?? PRESETS[BY_MEDIA[console?.media]] ?? PRESETS.dvd;
}

export function mediumNameFor(console) {
  return presetFor(console).mediumName;
}

/** The object a shelf actually holds: the card itself for DS/3DS, the closed case elsewhere. */
export function shelfItemFor(preset, unit = SHELF_UNIT) {
  if (preset.medium.kind === 'card') {
    const [width, height, depth] = preset.medium.size;
    return { width: width * unit, height: height * unit, depth: depth * unit };
  }

  const [width, height, depth] = preset.case;
  return { width: width * unit, height: height * unit, depth: depth * unit };
}

/* ---------- colour and type ---------- */

const FONT = '"Segoe UI", sans-serif';
const MONO = '"Cascadia Mono", Consolas, monospace';

export function hexToRgb(hex) {
  const digits = String(hex ?? '').replace('#', '').trim();
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const value = Number.parseInt(full, 16);

  return full.length === 6 && Number.isFinite(value)
    ? { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
    : { r: 27, g: 27, b: 31 };
}

/** `amount` runs -1 (black) to 1 (white); 0 leaves the colour alone. */
export function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value) =>
    Math.round(amount >= 0 ? value + (255 - value) * amount : value * (1 + amount));

  return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
}

/** The ink that stays readable on a field: cream on dark, near-black on light. */
export function inkFor(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#141824' : '#f4efe4';
}

/** Words wrapped to fit, with an ellipsis rather than a line nobody can read. */
function wrap(context, text, maxWidth, maxLines) {
  const words = String(text ?? '')
    .replace(/[®™©]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) {
    return ['Untitled'];
  }

  const lines = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }

  if (line) {
    lines.push(line);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
  return kept;
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  draw(canvas.getContext('2d'), canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/* ---------- generated artwork ---------- */

/**
 * The generated rung of the artwork policy: a typographic case front in the platform's
 * accent, sized to the real inlay so the game still reads as a designed object.
 */
export function generatedCoverTexture(preset, console, game, width = 320) {
  const [inlayWidth, inlayHeight] = preset.inlay;
  const height = Math.round(width * (inlayHeight / inlayWidth));
  const accent = console?.accentColor ?? '#0b4ea2';

  return canvasTexture(width, height, (context, w, h) => {
    const band = Math.round(h * 0.105);
    context.fillStyle = accent;
    context.fillRect(0, 0, w, band);

    const wash = context.createLinearGradient(0, band, 0, h);
    wash.addColorStop(0, '#1a2340');
    wash.addColorStop(1, '#0c1220');
    context.fillStyle = wash;
    context.fillRect(0, band, w, h - band);

    context.fillStyle = '#f4efe4';
    context.textBaseline = 'top';
    context.font = `650 ${Math.round(w * 0.082)}px ${FONT}`;

    const lines = wrap(context, game?.title ?? 'Untitled', w - w * 0.18, 3);
    const lineHeight = w * 0.096;
    let y = band + h * 0.11;

    for (const line of lines) {
      context.fillText(line, w * 0.09, y);
      y += lineHeight;
    }

    if (game?.serial) {
      context.fillStyle = 'rgba(244,239,228,0.55)';
      context.font = `600 ${Math.round(w * 0.048)}px ${MONO}`;
      context.fillText(game.serial, w * 0.09, h - band - w * 0.06);
    }

    context.fillStyle = accent;
    context.fillRect(0, h - Math.round(h * 0.045), w, Math.round(h * 0.045));
  });
}

/**
 * A disc is printed from the clamping ring out to the edge. The leader is always
 * generated: a cover is not a disc label (PLAN.md section 3.3).
 */
export function generatedDiscLabelTexture(preset, console, game, size = 1024) {
  const accent = console?.accentColor ?? '#0b4ea2';
  const ink = inkFor(accent);
  const radius = size / 2;

  return canvasTexture(size, size, (context, w, h) => {
    const print = context.createLinearGradient(w * 0.18, 0, w * 0.82, h);
    print.addColorStop(0, shade(accent, 0.22));
    print.addColorStop(0.58, shade(accent, 0));
    print.addColorStop(1, shade(accent, -0.28));
    context.fillStyle = print;
    context.fillRect(0, 0, w, h);

    // The sheen a pressed disc carries under a shop light.
    const sheen = context.createLinearGradient(0, 0, w * 0.55, h);
    sheen.addColorStop(0, 'rgba(255,255,255,0.26)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.02)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = sheen;
    context.fillRect(0, 0, w, h);

    // The clear clamping ring: no print on the hub, the way a real disc is made.
    const hub = context.createRadialGradient(w / 2, h / 2, radius * 0.06, w / 2, h / 2, radius * 0.36);
    hub.addColorStop(0, '#0b101a');
    hub.addColorStop(0.32, '#8b97a7');
    hub.addColorStop(0.6, '#d7dee7');
    hub.addColorStop(1, 'rgba(215,222,231,0)');
    context.fillStyle = hub;
    context.beginPath();
    context.arc(w / 2, h / 2, radius * 0.37, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = 'rgba(255,206,0,0.55)';
    context.lineWidth = Math.max(2, size * 0.004);
    context.beginPath();
    context.arc(w / 2, h / 2, radius * 0.365, 0, Math.PI * 2);
    context.stroke();

    context.strokeStyle = 'rgba(255,255,255,0.22)';
    context.lineWidth = Math.max(1.5, size * 0.0025);
    context.beginPath();
    context.arc(w / 2, h / 2, radius * 0.2, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = '#05080f';
    context.beginPath();
    context.arc(w / 2, h / 2, radius * 0.125, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = ink;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `700 ${Math.round(size * 0.052)}px ${FONT}`;

    const lines = wrap(context, game?.title ?? 'Untitled', w * 0.56, 3);
    const top = h * 0.3 - ((lines.length - 1) * size * 0.062) / 2;
    lines.forEach((line, index) => context.fillText(line, w / 2, top + index * size * 0.062));

    if (game?.serial) {
      context.fillStyle = ink;
      context.globalAlpha = 0.62;
      context.font = `600 ${Math.round(size * 0.028)}px ${MONO}`;
      context.fillText(game.serial, w / 2, h * 0.72);
      context.globalAlpha = 1;
    }

    context.strokeStyle = 'rgba(255,255,255,0.16)';
    context.lineWidth = Math.max(2, size * 0.004);
    context.beginPath();
    context.arc(w / 2, h / 2, radius * 0.985, 0, Math.PI * 2);
    context.stroke();
  });
}

/** A game card's sticker: a small printed panel on a moulded shell. */
export function generatedStickerTexture(preset, console, game, width = 512) {
  const accent = console?.accentColor ?? '#0b4ea2';
  const ink = inkFor(accent);
  const [cardWidth, cardHeight] = preset.medium.size;
  const height = Math.round(width * (cardHeight / cardWidth));

  return canvasTexture(width, height, (context, w, h) => {
    const field = context.createLinearGradient(0, 0, w * 0.4, h);
    field.addColorStop(0, shade(accent, 0.18));
    field.addColorStop(1, shade(accent, -0.24));
    context.fillStyle = field;
    context.fillRect(0, 0, w, h);

    context.strokeStyle = 'rgba(0,0,0,0.34)';
    context.lineWidth = Math.max(2, w * 0.008);
    context.strokeRect(w * 0.02, h * 0.02, w * 0.96, h * 0.96);

    context.strokeStyle = 'rgba(255,206,0,0.5)';
    context.lineWidth = Math.max(1.5, w * 0.005);
    context.strokeRect(w * 0.05, h * 0.06, w * 0.9, h * 0.88);

    context.fillStyle = ink;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `700 ${Math.round(w * 0.083)}px ${FONT}`;

    const lines = wrap(context, game?.title ?? 'Untitled', w * 0.78, 3);
    const top = h * 0.48 - ((lines.length - 1) * w * 0.098) / 2;
    lines.forEach((line, index) => context.fillText(line, w / 2, top + index * w * 0.098));

    if (game?.serial) {
      context.globalAlpha = 0.62;
      context.font = `600 ${Math.round(w * 0.052)}px ${MONO}`;
      context.fillText(game.serial, w / 2, h * 0.87);
      context.globalAlpha = 1;
    }
  });
}

/** Crops a full-cart photograph down to its sticker, for the audited DS candidates. */
export function stickerFromImage(image, rect, width = 512) {
  const [x, y, w, h] = rect?.length === 4 ? rect : [0, 0, image.naturalWidth, image.naturalHeight];

  return canvasTexture(width, Math.round(width * (h / w)), (context, cw, ch) => {
    context.drawImage(image, x, y, w, h, 0, 0, cw, ch);
  });
}

/* ---------- textures ---------- */

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error(`Could not load ${url}`)));
    image.src = url;
  });
}

/** Bounded once, so a folder of 1200 px covers never becomes a screenful of textures. */
export function textureFromImage(image, limit = 1024) {
  const scale = Math.min(1, limit / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const sheet = document.createElement('canvas');
  sheet.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  sheet.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
  sheet.getContext('2d').drawImage(image, 0, 0, sheet.width, sheet.height);

  const texture = new THREE.CanvasTexture(sheet);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export async function loadTexture(url, limit = 1024) {
  return textureFromImage(await loadImage(url), limit);
}

/**
 * Fits a photograph into a plane without stretching it. A provider box front is usually
 * a full wrap with a spine, so it is a little wider than the inlay; cropping the extra
 * sides is what a printed inlay does, and it keeps the art's own proportions. Anything
 * already drawn at the inlay's aspect is left alone.
 */
export function fitTexture(texture, planeAspect) {
  const image = texture?.image;

  if (!image || !planeAspect) {
    return texture;
  }

  const imageAspect = (image.width || 1) / (image.height || 1);
  texture.repeat.set(1, 1);
  texture.offset.set(0, 0);

  if (imageAspect > planeAspect) {
    const scale = planeAspect / imageAspect;
    texture.repeat.x = scale;
    texture.offset.x = (1 - scale) / 2;
  } else if (imageAspect < planeAspect) {
    const scale = imageAspect / planeAspect;
    texture.repeat.y = scale;
    texture.offset.y = (1 - scale) / 2;
  }

  texture.needsUpdate = true;
  return texture;
}

export function disposeTree(root) {
  root.traverse((node) => {
    if (!node.isMesh && !node.isLine) {
      return;
    }

    node.geometry?.dispose();

    for (const material of [].concat(node.material ?? [])) {
      for (const value of Object.values(material)) {
        if (value && value.isTexture) {
          value.dispose();
        }
      }
      material.dispose();
    }
  });
}

/* ---------- builders ---------- */

function plastic(hex, options = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    roughness: 0.44,
    metalness: 0.05,
    ...options,
  });
}

/**
 * A closed case. The shell carries the platform's plastic; the cover is a separate plane
 * at the real inlay size, so a square PS1 booklet is not stretched across a landscape
 * jewel case. `detail` adds the rounded shell and the PS1 tray/PS3 band the workshop shows.
 */
export function buildCase(preset, unit, { body = '#2E2E34', cover = null, detail = false } = {}) {
  const [caseWidth, caseHeight, caseDepth] = preset.case.map((value) => value * unit);
  const [inlayWidth, inlayHeight] = preset.inlay.map((value) => value * unit);

  const group = new THREE.Group();

  const shellMaterial = preset.clear
    ? new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(body),
        roughness: 0.16,
        metalness: 0,
        transparent: true,
        opacity: detail ? 0.34 : 0.92,
        depthWrite: detail ? false : true,
      })
    : plastic(body, { roughness: 0.4 });

  if (detail && preset.clear) {
    const tray = new THREE.Mesh(
      new RoundedBoxGeometry(caseWidth * 0.955, caseHeight * 0.93, caseDepth * 0.55, 3, 0.7 * unit),
      plastic('#171d26', { roughness: 0.52 }),
    );
    tray.position.z = -caseDepth * 0.14;
    group.add(tray);
  }

  const geometry = detail
    ? new RoundedBoxGeometry(caseWidth, caseHeight, caseDepth, 3, 0.9 * unit)
    : new THREE.BoxGeometry(caseWidth, caseHeight, caseDepth);

  const shell = new THREE.Mesh(geometry, shellMaterial);
  group.add(shell);

  const coverMaterial = new THREE.MeshBasicMaterial({
    map: cover,
    color: 0xffffff,
  });
  const coverMesh = new THREE.Mesh(new THREE.PlaneGeometry(inlayWidth, inlayHeight), coverMaterial);
  coverMesh.position.z = caseDepth / 2 + 0.15 * unit;
  group.add(coverMesh);

  if (detail && preset.mediumName === 'Blu-ray') {
    // The translucent blue band across the top of a PS3 case.
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(caseWidth * 0.985, caseHeight * 0.075),
      new THREE.MeshStandardMaterial({
        color: 0x226bb3,
        transparent: true,
        opacity: 0.85,
        roughness: 0.24,
      }),
    );
    band.position.set(0, caseHeight * 0.455, caseDepth / 2 + 0.2 * unit);
    group.add(band);
  }

  return { group, coverMaterial, width: caseWidth, height: caseHeight, depth: caseDepth };
}

/**
 * A 12 cm (or 8 cm) optical disc: an extrusion with a real spindle hole and the label
 * mapped onto the pressed face. The UVs of the caps are remapped to the disc's diameter
 * so a square label image reads as a circle, centred on the hub.
 */
export function buildDisc(preset, unit, { label = null } = {}) {
  const [diameterMm, thicknessMm] = preset.medium.size;
  const diameter = diameterMm * unit;
  const thickness = thicknessMm * unit;
  const radius = diameter / 2;

  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);

  const hole = new THREE.Path();
  hole.absarc(0, 0, 7.5 * unit, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 96,
  });
  geometry.translate(0, 0, -thickness / 2);

  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  const normals = geometry.attributes.normal;

  for (let index = 0; index < positions.count; index++) {
    if (Math.abs(normals.getZ(index)) > 0.9) {
      uvs.setXY(index, positions.getX(index) / diameter + 0.5, positions.getY(index) / diameter + 0.5);
    }
  }
  uvs.needsUpdate = true;

  const face = new THREE.MeshStandardMaterial({
    map: label,
    roughness: 0.34,
    metalness: 0.22,
  });
  const rim = new THREE.MeshStandardMaterial({ color: 0x8d99a8, metalness: 0.72, roughness: 0.2 });

  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, [face, rim]));
  group.userData.spinAxis = 'z';

  return { group, faceMaterial: face, width: diameter, height: diameter, depth: thickness };
}

/**
 * A DS/3DS game card: the moulded outline with its clipped top corners, a bevel, and a
 * sticker plane. `face` is the sticker only; a card without one stays a blank body.
 */
export function buildCartridge(preset, unit, { body = '#20252c', face = null, detail = false, labelAspect = null } = {}) {
  const [widthMm, heightMm, depthMm] = preset.medium.size;
  const width = widthMm * unit;
  const height = heightMm * unit;
  const depth = depthMm * unit;

  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, height * 0.32);
  shape.lineTo(width * 0.36, height / 2);
  shape.lineTo(-width * 0.32, height / 2);
  shape.lineTo(-width / 2, height * 0.36);
  shape.closePath();

  const bevelThickness = Math.min(0.6 * unit, depth * 0.3);
  const coreDepth = Math.max(depth - bevelThickness * 2, depth * 0.4);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: coreDepth,
    bevelEnabled: true,
    bevelSize: Math.min(0.8 * unit, width * 0.03),
    bevelThickness,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geometry.translate(0, 0, -coreDepth / 2);

  const group = new THREE.Group();
  const shell = new THREE.Mesh(geometry, plastic(body, { roughness: 0.56 }));
  group.add(shell);

  if (detail) {
    for (let index = -2; index <= 2; index++) {
      const groove = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.022, height * 0.13, depth * 0.18),
        plastic('#11151a', { roughness: 0.62 }),
      );
      groove.position.set(index * width * 0.095, height * 0.355, depth / 2 + 0.05 * unit);
      group.add(groove);
    }
  }

  let faceMaterial = null;
  let sticker = null;

  if (face !== undefined) {
    // The printed label is its own rectangle, not the card's: it is inset, and a DS
    // sticker is portrait while a 3DS one is landscape. When a labelled candidate comes
    // with a source rectangle, its aspect wins so the crop is never stretched.
    const aspect = labelAspect ?? width / height;
    const stickerWidth = width * 0.76;
    const stickerHeight = Math.min(stickerWidth / aspect, height * 0.72);
    const stickerW = Math.min(stickerWidth, stickerHeight * aspect);

    faceMaterial = new THREE.MeshBasicMaterial({ map: face });
    sticker = new THREE.Mesh(new THREE.PlaneGeometry(stickerW, stickerHeight), faceMaterial);
    sticker.position.set(0, -height * 0.045, depth / 2 + 0.15 * unit);
    sticker.visible = Boolean(face);
    group.add(sticker);
  }

  if (!faceMaterial) {
    // A blank card still needs a material the shelf can print on later.
    faceMaterial = new THREE.MeshBasicMaterial({ map: null });
  }

  group.userData.spinAxis = 'y';

  return { group, faceMaterial, sticker, width, height, depth };
}
