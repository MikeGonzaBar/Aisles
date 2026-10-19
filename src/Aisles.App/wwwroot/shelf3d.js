// Aisles - Phase 4: the shelf.
//
// The selected platform's media as staged rows of a real bookcase: one bay is three
// tiers of six, and a bay is complete furniture - cornice, side panels, boards, plinth,
// back panel. The side panels are not decoration: without them a sideways slide is
// indistinguishable from a scroll, and the whole point of paging is lost.
//
// Only the bays move. The console lineup and the game hero never do, and the camera is
// fixed, so the parallax comes from the bay's own receding tiers and hit testing stays
// simple (PLAN.md section 6).
//
// Like stage3d.js this is a module, so it cannot see stage.js's top-level bindings. The
// contract is window.aislesSnapshot plus the "aisles:update" event going in, and
// window.aislesSelectGame / window.aislesLaunchGame coming back out.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** A bay holds eighteen games: three tiers of six. */
const COLUMNS = 6;
const TIERS = 3;
const PER_BAY = COLUMNS * TIERS;

/** Slot spacing inside a bay, and how far apart two bays stand. */
const SLOT_GAP = 0.016;
const HEADROOM = 0.10;
const BAY_GAP = 0.4;
const BOARD = 0.03;
const PANEL = 0.06;

/** Camera: nearly head-on, a little above, so each tier's board shows its top face. */
const FOV = 32;
const TILT = THREE.MathUtils.degToRad(7);

/** One page of bays, ease-out, no overshoot. */
const SLIDE_MS = 400;

/**
 * Media shapes, keyed by the `media` value in consoles.json. Widths and heights are the
 * real packaging ratios, shrunk: a DVD case is 19 x 13.5 cm, a jewel case 14.2 x 12.5 cm,
 * a GameCube mini-disc case 15 x 13 cm. Sizes differ per platform, never within one, so a
 * bay always reads as a tidy row.
 *
 * The numbers are relative to the case, so a platform's shelf is built around its own
 * packaging: a jewel case gets a shallower bay than a DVD case rather than a bay with a
 * hand's width of empty air over every shelf.
 */
const MEDIA = {
  DvdCase: { width: 0.3, height: 0.42, depth: 0.028 },
  BluRayCase: { width: 0.285, height: 0.4, depth: 0.026 },
  JewelCase: { width: 0.3, height: 0.32, depth: 0.024 },
  MiniDiscCase: { width: 0.28, height: 0.3, depth: 0.044 },
  CartridgeCase: { width: 0.245, height: 0.34, depth: 0.026 },
};

const DEFAULT_MEDIA = MEDIA.DvdCase;

const canvas = document.getElementById('shelf-canvas');
const pagerRoot = document.getElementById('shelf-pager');

if (canvas) {
  try {
    start(canvas);
  } catch (error) {
    fail(error);
  }
} else {
  fail(new Error('shelf markup missing'));
}

function start(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1430);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 40);

  // Reflections with no HDRI file, so the plastic still reads offline.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.3;
  pmrem.dispose();

  // Key from above and left to cast the cases onto their boards; a cool fill on the
  // right and a yellow rim from behind so spines separate from the back panel.
  const key = new THREE.DirectionalLight(0xfff2dd, 2.4);
  key.position.set(-1.9, 3.4, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -2.1;
  key.shadow.camera.right = 2.1;
  key.shadow.camera.top = 1.9;
  key.shadow.camera.bottom = -1.9;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 12;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x9ab6ff, 0.75);
  fill.position.set(2.8, 1.6, 2.4);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffd62e, 0.55);
  rim.position.set(0.4, 1.4, -3.2);
  scene.add(rim);

  /* ---------- materials ---------- */

  // Rebuilt with the furniture, never shared across a rebuild: disposing a bay has to be
  // able to free everything it owns without pulling a material out from under the next bay.
  let wood;
  let back;
  let plastic;
  let outTexture;

  function makeMaterials() {
    // One furniture material for every board, side and cornice, so the shelf reads as a
    // single piece of wood rather than an assembly.
    wood = new THREE.MeshStandardMaterial({ color: 0x4a3c22, roughness: 0.68, metalness: 0.06 });
    back = new THREE.MeshStandardMaterial({ color: 0x0c1220, roughness: 0.9, metalness: 0.02 });

    plastic = new THREE.MeshStandardMaterial({
      color: state.bodyColor,
      roughness: 0.44,
      metalness: 0.06,
    });

    outTexture = labelTexture('OUT');
  }

  /* ---------- scene graph ---------- */

  const shelfRoot = new THREE.Group();
  scene.add(shelfRoot);

  const bays = [];
  const cases = new Map();

  const state = {
    games: [],
    selectedGameId: null,
    media: DEFAULT_MEDIA,
    cartridge: false,
    bodyColor: 0x1b1b1f,
    accentColor: 0xffce00,
    platformId: null,
    bay: 0,
    bayCount: 1,
    bayPitch: 2.4,
  };

  let baySize = { width: 1.9, height: 1.4 };

  /* ---------- furniture ---------- */

  /**
   * Bay dimensions follow from the platform's packaging, so a shelf built for jewel cases
   * is not a DVD shelf with three empty bands in it. One bay is always three tiers of six.
   */
  function measure() {
    const spec = state.media;
    const slot = spec.width + SLOT_GAP;
    const tier = spec.height * (1 + HEADROOM);

    return {
      slot,
      tier,
      innerWidth: COLUMNS * slot,
      innerHeight: TIERS * tier,
      depth: 0.3,
      outerWidth: COLUMNS * slot + PANEL * 2,
    };
  }

  function makeBay() {
    const group = new THREE.Group();
    const plan = measure();

    const innerWidth = plan.innerWidth;
    const innerHeight = plan.innerHeight;
    const halfWidth = innerWidth / 2;
    const depth = plan.depth;

    const backPanel = new THREE.Mesh(new THREE.BoxGeometry(innerWidth, innerHeight, 0.02), back);
    backPanel.position.set(0, innerHeight / 2, -depth / 2 - 0.01);
    backPanel.receiveShadow = true;
    group.add(backPanel);

    // One board under each tier, plus the top board and the plinth.
    for (let tier = 0; tier <= TIERS; tier++) {
      const plinth = tier === 0;
      const top = tier === TIERS;
      const stand = new THREE.Mesh(
        new THREE.BoxGeometry(
          innerWidth + PANEL * 2,
          plinth ? 0.07 : BOARD,
          depth + (plinth ? 0.06 : 0.02),
        ),
        wood,
      );
      stand.position.set(
        0,
        plinth ? -0.035 : top ? innerHeight - BOARD / 2 : tier * plan.tier - BOARD / 2,
        plinth ? 0 : 0.01,
      );
      stand.castShadow = true;
      stand.receiveShadow = true;
      group.add(stand);
    }

    // Side panels, visible on purpose.
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(PANEL, innerHeight + 0.07, depth), wood);
      panel.position.set(side * (halfWidth + PANEL / 2), innerHeight / 2, 0.01);
      panel.castShadow = true;
      panel.receiveShadow = true;
      group.add(panel);
    }

    const cornice = new THREE.Mesh(new THREE.BoxGeometry(innerWidth + PANEL * 2 + 0.05, 0.055, depth + 0.06), wood);
    cornice.position.set(0, innerHeight + 0.045, 0.03);
    cornice.castShadow = true;
    cornice.receiveShadow = true;
    group.add(cornice);

    baySize = { width: plan.outerWidth + 0.05, height: innerHeight + 0.1 };

    return group;
  }

  /* ---------- media ---------- */

  /**
   * Covers arrive at whatever size the person's artwork folder holds - often a thousand
   * pixels square. A case on a shelf is a few hundred pixels at most, and a screenful of
   * full-size covers is enough texture memory to push the compositor over a limit, so the
   * sheet is drawn once into a bounded canvas and the original is dropped.
   */
  function loadCover(url, accept) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';

    image.addEventListener('load', () => {
      const limit = 512;
      const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
      const sheet = document.createElement('canvas');
      sheet.width = Math.max(1, Math.round(image.naturalWidth * scale));
      sheet.height = Math.max(1, Math.round(image.naturalHeight * scale));
      sheet.getContext('2d').drawImage(image, 0, 0, sheet.width, sheet.height);

      const texture = new THREE.CanvasTexture(sheet);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      accept(texture);
    });

    image.addEventListener('error', () => {
      // The generated case stays. A missing file is not a shelf with a hole in it.
    });

    image.src = url;
  }

  /**
   * A case's front face is unlit. Printed art is meant to be read, not lit, and a
   * standard material under a 2.4-intensity key blows highlights out. The body stays lit
   * so the plastic still catches the room.
   */
  function makeCase(game) {
    const spec = state.media;
    const group = new THREE.Group();

    const front = new THREE.MeshBasicMaterial({ map: generatedCover(game) });
    const geometry = new THREE.BoxGeometry(spec.width, spec.height, spec.depth);

    // BoxGeometry material order: +x, -x, +y, -y, +z, -z.
    const mesh = new THREE.Mesh(geometry, [plastic, plastic, plastic, plastic, front, plastic]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.gameId = game.id;
    group.add(mesh);

    if (game.frontCoverUrl) {
      loadCover(game.frontCoverUrl, (texture) => {
        front.map?.dispose();
        front.map = texture;
        front.needsUpdate = true;
      });
    }

    group.userData.gameId = game.id;
    group.userData.case = mesh;
    return group;
  }

  /**
   * The DS/3DS shelf holds the card itself rather than a box, so a card with no artwork
   * is drawn as a blank card: shell, label recess, grip ridges, no print. A sticker is a
   * later pass, and inventing type here would pretend the card already has one.
   */
  function blankCartridge() {
    const width = 320;
    const height = Math.round(width * (state.media.height / state.media.width));
    const body = `#${state.bodyColor.toString(16).padStart(6, '0')}`;

    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const context = source.getContext('2d');

    const shell = context.createLinearGradient(0, 0, width * 0.4, height);
    shell.addColorStop(0, tint(body, 0.18));
    shell.addColorStop(0.52, body);
    shell.addColorStop(1, tint(body, -0.3));
    context.fillStyle = shell;
    context.fillRect(0, 0, width, height);

    // The grip ridges at both ends.
    context.fillStyle = 'rgba(0,0,0,0.16)';
    rounded(context, width / 2 - 46, 20, 92, 11, 5.5);
    rounded(context, width / 2 - 46, height - 31, 92, 11, 5.5);

    // The recess the sticker will eventually sit in. Empty on purpose.
    const panel = { x: 34, y: 58, width: width - 68, height: height - 158 };
    context.fillStyle = 'rgba(255,255,255,0.07)';
    rounded(context, panel.x, panel.y, panel.width, panel.height, 9);
    context.strokeStyle = 'rgba(0,0,0,0.34)';
    context.lineWidth = 3;
    rounded(context, panel.x, panel.y, panel.width, panel.height, 9, true);

    const texture = new THREE.CanvasTexture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function rounded(context, x, y, width, height, radius, stroke = false) {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    if (stroke) {
      context.stroke();
    } else {
      context.fill();
    }
  }

  /** `amount` runs -1 (black) to 1 (white). */
  function tint(hex, amount) {
    const value = Number.parseInt(hex.slice(1), 16);
    const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) =>
      Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount)),
    );
    return `rgb(${channels.join(', ')})`;
  }

  function generatedCover(game) {
    return state.cartridge ? blankCartridge() : titleCase(game);
  }

  /**
   * The "generated" rung of the artwork policy (PLAN.md section 3.3.1): a typographic
   * case in the platform's accent colour, so a game with no local cover is still a case
   * on a shelf rather than a hole.
   */
  function titleCase(game) {
    const width = 320;
    const height = 440;
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;

    const context = source.getContext('2d');
    const accent = `#${state.accentColor.toString(16).padStart(6, '0')}`;

    context.fillStyle = accent;
    context.fillRect(0, 0, width, 46);

    const wash = context.createLinearGradient(0, 46, 0, height);
    wash.addColorStop(0, '#1a2340');
    wash.addColorStop(1, '#0c1220');
    context.fillStyle = wash;
    context.fillRect(0, 46, width, height - 46);

    context.fillStyle = '#f4efe4';
    context.font = '600 26px "Segoe UI", sans-serif';
    context.textBaseline = 'top';

    const words = String(game.title).split(/\s+/);
    let line = '';
    let y = 92;

    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width > width - 56 && line) {
        context.fillText(line, 28, y);
        y += 34;
        line = word;
      } else {
        line = next;
      }
    }
    if (line) {
      context.fillText(line, 28, y);
    }

    // The platform accent as a foot band, so an unlabelled case still says which shelf
    // it belongs to.
    context.fillStyle = accent;
    context.fillRect(0, height - 18, width, 18);

    const texture = new THREE.CanvasTexture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function labelTexture(text) {    // Drawn at the case's real proportion, so the dashes stay square whatever the
    // platform's packaging is.
    const spec = state.media;
    const width = 256;
    const height = Math.round(width * (spec.height / spec.width));

    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;

    const context = source.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.strokeStyle = 'rgba(120,142,196,0.85)';
    context.lineWidth = 4;
    context.setLineDash([14, 10]);
    context.strokeRect(4, 4, width - 8, height - 8);
    context.fillStyle = 'rgba(150,170,220,0.9)';
    context.font = `600 ${Math.round(width * 0.13)}px "Segoe UI", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2);

    const texture = new THREE.CanvasTexture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /* ---------- building a bay's worth of games ---------- */

  function slotPosition(index) {
    // Fills left to right, top to bottom, the way a person fills a shelf.
    const plan = measure();
    const column = index % COLUMNS;
    const tier = TIERS - 1 - Math.floor(index / COLUMNS);

    return {
      x: (column - (COLUMNS - 1) / 2) * plan.slot,
      // A board's top face sits exactly at tier * tier pitch, so the case stands on it
      // rather than floating a board's thickness above it.
      y: tier * plan.tier + state.media.height / 2 + 0.002,
    };
  }

  function placeCase(holder, game) {
    const spec = state.media;
    const group = makeCase(game);

    // The dashed OUT outline that stays behind when the case lifts out. Same footprint
    // as the case, so the gap reads as a missing item, not as a gap in the furniture.
    const outline = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.width, spec.height),
      new THREE.MeshBasicMaterial({ map: outTexture, transparent: true, depthWrite: false }),
    );
    outline.userData.gameId = game.id;
    outline.visible = false;

    return { group, outline };
  }

  function build() {
    for (const bay of bays) {
      shelfRoot.remove(bay.group);
      disposeTree(bay.group);
    }
    bays.length = 0;
    cases.clear();
    shelfRoot.position.x = 0;

    const platform = window.aislesSnapshot?.platform;
    state.games = window.aislesSnapshot?.games ?? [];
    state.platformId = platform?.id ?? null;
    state.media = MEDIA[platform?.media] ?? DEFAULT_MEDIA;
    state.cartridge = platform?.media === 'CartridgeCase';
    state.bodyColor = new THREE.Color(platform?.bodyColor ?? '#1b1b1f').getHex();
    state.accentColor = new THREE.Color(platform?.accentColor ?? '#ffce00').getHex();
    state.bayCount = Math.max(1, Math.ceil(state.games.length / PER_BAY));
    state.bay = 0;

    makeMaterials();

    const plan = measure();
    const bayPitch = plan.outerWidth + BAY_GAP;
    const caseZ = plan.depth / 2 - state.media.depth / 2 - 0.02;

    for (let index = 0; index < state.bayCount; index++) {
      const group = makeBay();
      group.position.x = index * bayPitch;
      shelfRoot.add(group);

      // Every bay is built up front. Paging then moves finished furniture, so the
      // incoming bay is already there to slide in - pre-rendered by construction.
      for (let slot = 0; slot < PER_BAY; slot++) {
        const gameIndex = index * PER_BAY + slot;
        const game = state.games[gameIndex];
        if (!game) {
          continue;
        }

        const { x, y } = slotPosition(slot);
        const { group: caseGroup, outline } = placeCase(group, game);
        caseGroup.position.set(x, y, caseZ);
        outline.position.set(x, y, caseZ - 0.01);
        group.add(caseGroup, outline);
        cases.set(game.id, { group: caseGroup, outline, bay: index, x, y, z: caseZ });
      }

      bays.push({ group });
    }

    baySize = { width: plan.outerWidth + 0.05, height: plan.innerHeight + 0.1 };
    state.bayPitch = bayPitch;
    applySelection();
    frameCamera();
  }

  /* ---------- selection ---------- */

  /**
   * Selecting a game empties its slot - the case is "in your hands" - and the slot keeps
   * its dashed outline wherever it is, so paging away and back still shows which one is
   * out (PLAN.md section 6).
   */
  function applySelection() {
    for (const [gameId, slot] of cases) {
      const chosen = gameId === state.selectedGameId;
      slot.group.visible = !chosen;
      slot.outline.visible = chosen;

      if (chosen) {
        slot.group.position.z = slot.z;
      }
    }
  }

  /* ---------- camera and resizing ---------- */

  function frameCamera() {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const aspect = Math.max(width / height, 0.4);

    // Just enough margin that the cornice and the plinth are inside the frame.
    const halfHeight = baySize.height / 2 + 0.09;
    const halfWidth = baySize.width / 2 + 0.08;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

    const distance = Math.max(halfHeight / tan, halfWidth / (tan * aspect));
    const target = new THREE.Vector3(0, baySize.height / 2 - 0.06, 0);

    camera.position.set(0, target.y + Math.sin(TILT) * distance, Math.cos(TILT) * distance);
    camera.lookAt(target);
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (width === 0 || height === 0) {
      return;
    }

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const bufferWidth = Math.round(width * ratio);
    const bufferHeight = Math.round(height * ratio);

    if (canvas.width === bufferWidth && canvas.height === bufferHeight) {
      return;
    }

    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frameCamera();
  }

  /* ---------- paging ---------- */

  let slideFrom = 0;
  let slideTarget = 0;
  let slideStarted = 0;
  let sliding = false;

  function pageTo(index, animate = true) {
    const clamped = Math.max(0, Math.min(state.bayCount - 1, index));
    state.bay = clamped;

    const target = -clamped * state.bayPitch;
    const position = shelfRoot.position.x;

    if (!animate || Math.abs(target - position) < 1e-4) {
      shelfRoot.position.x = target;
      slideFrom = target;
      slideTarget = target;
      sliding = false;
    } else {
      slideFrom = position;
      slideTarget = target;
      slideStarted = performance.now();
      sliding = true;
    }

    announce();
  }

  function pageBy(delta) {
    pageTo(state.bay + delta);
  }

  function announce() {
    window.dispatchEvent(
      new CustomEvent('aisles:shelf', {
        detail: {
          bay: state.bay + 1,
          bays: state.bayCount,
          games: state.games.length,
          perBay: PER_BAY,
          platformName: window.aislesSnapshot?.platform?.name ?? '',
        },
      }),
    );
  }

  /* ---------- interaction ---------- */

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoveredId = null;
  let dragStart = null;
  let dragged = false;

  function pickAt(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);

    const targets = [];
    for (const slot of cases.values()) {
      // A selected case is out of the shelf, so its dashed slot is the thing a person
      // can still click - to re-select it, or to double-click and launch it.
      targets.push(slot.group.visible ? slot.group : slot.outline);
    }

    const hit = raycaster.intersectObjects(targets, true)[0];
    if (!hit) {
      return null;
    }

    for (let node = hit.object; node; node = node.parent) {
      if (node.userData.gameId) {
        return node.userData.gameId;
      }
    }

    return null;
  }

  function setHovered(gameId) {
    if (gameId === hoveredId) {
      return;
    }

    if (hoveredId) {
      const previous = cases.get(hoveredId);
      if (previous) {
        previous.group.position.z = previous.z;
      }
    }

    hoveredId = gameId;
    canvas.style.cursor = gameId ? 'pointer' : 'default';

    const next = gameId ? cases.get(gameId) : null;
    if (next && next.group.visible) {
      // Pulled a little toward the viewer, the way a hand would tip a case out.
      next.group.position.z = next.z + 0.045;
    }
  }

  canvas.addEventListener('pointermove', (event) => {
    if (dragStart !== null) {
      if (Math.abs(event.clientX - dragStart) > 6) {
        dragged = true;
      }
      return;
    }

    setHovered(pickAt(event));
  });

  canvas.addEventListener('pointerleave', () => setHovered(null));

  canvas.addEventListener('pointerdown', (event) => {
    dragStart = event.clientX;
    dragged = false;
    canvas.setPointerCapture?.(event.pointerId);
  });

  canvas.addEventListener('pointerup', (event) => {
    const start = dragStart;
    dragStart = null;

    if (start === null) {
      return;
    }

    const travel = event.clientX - start;
    if (dragged && Math.abs(travel) > 40) {
      // A drag means the same thing as the wheel and the arrow keys: next or previous.
      pageBy(travel < 0 ? 1 : -1);
      return;
    }

    const gameId = pickAt(event);
    if (gameId) {
      window.aislesSelectGame?.(gameId);
    }
  });

  canvas.addEventListener('dblclick', (event) => {
    const gameId = pickAt(event);
    if (gameId) {
      window.aislesLaunchGame?.(gameId);
    }
  });

  let wheelLock = 0;

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const now = performance.now();
      if (now < wheelLock || Math.abs(event.deltaY) < 4) {
        return;
      }

      wheelLock = now + SLIDE_MS;
      pageBy(event.deltaY > 0 ? 1 : -1);
    },
    { passive: false },
  );

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    // The shelf owns the arrow keys (PLAN.md section 6); the lineup does not use them.
    event.preventDefault();
    pageBy(event.key === 'ArrowRight' ? 1 : -1);
  });

  if (pagerRoot) {
    pagerRoot.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-page]');
      if (button) {
        pageBy(Number(button.dataset.page));
      }
    });
  }

  /* ---------- data flow ---------- */

  function update() {
    const snapshot = window.aislesSnapshot;
    if (!snapshot) {
      return;
    }

    const signature = [
      snapshot.platform?.id ?? '',
      snapshot.platform?.media ?? '',
      (snapshot.games ?? []).map((game) => game.id).join('|'),
    ].join('::');

    if (signature !== builtSignature) {
      build();
      builtSignature = signature;
    }

    state.selectedGameId = snapshot.selectedGameId ?? null;
    applySelection();
    announce();
  }

  let builtSignature = null;

  /* ---------- frame loop ---------- */

  function tick() {
    resize();

    if (sliding) {
      const elapsed = performance.now() - slideStarted;
      const t = Math.min(1, elapsed / SLIDE_MS);
      // Ease-out cubic: fast off the mark, no overshoot, so the snap is exact.
      const eased = 1 - (1 - t) ** 3;
      shelfRoot.position.x = slideFrom + (slideTarget - slideFrom) * eased;

      if (t >= 1) {
        shelfRoot.position.x = slideTarget;
        sliding = false;
      }
    }

    renderer.render(scene, camera);
  }

  window.addEventListener('aisles:update', update);
  update();
  resize();
  renderer.setAnimationLoop(tick);

  window.aislesShelf3d = {
    THREE,
    scene,
    camera,
    renderer,
    state,
    bays,
    cases,
    pageBy,
    pageTo,
    pickAt,
    shelfRoot,
  };
}

/* ---------- helpers ---------- */

/**
 * The room behind the furniture: a warm-to-dark navy wash. Painted here rather than left
 * to the renderer's clear colour so the shelf canvas reads as part of the page.
 */
function roomBackdrop() {
  const source = document.createElement('canvas');
  source.width = 512;
  source.height = 288;

  const context = source.getContext('2d');
  const wash = context.createRadialGradient(256, -60, 20, 256, -60, 430);
  wash.addColorStop(0, '#22305e');
  wash.addColorStop(0.45, '#141c3a');
  wash.addColorStop(1, '#090d1c');
  context.fillStyle = wash;
  context.fillRect(0, 0, source.width, source.height);

  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function disposeTree(root) {
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

function fail(error) {
  console.warn('Aisles: the 3D shelf is unavailable, falling back to the game list', error);
  document.body.classList.add('shelf3d-failed');
}
