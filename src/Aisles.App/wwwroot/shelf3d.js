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
import {
  SHELF_UNIT,
  presetFor,
  shelfItemFor,
  buildCase,
  buildCartridge,
  generatedCoverTexture,
  stickerFromImage,
  loadImage,
  loadTexture,
  fitTexture,
  disposeTree,
} from './media.js';

/** A bay holds eighteen games: three tiers of six. */
const COLUMNS = 6;
const TIERS = 3;
const PER_BAY = COLUMNS * TIERS;

/** Furniture is proportional to the media, so a shelf of DS cards is not a DVD shelf. */
const SLOT_GAP_RATIO = 0.05;
const HEADROOM = 0.10;
const BAY_GAP_RATIO = 1.27;

/** Camera: nearly head-on, a little above, so each tier's board shows its top face. */
const FOV = 32;
const TILT = THREE.MathUtils.degToRad(7);

/** One page of bays, ease-out, no overshoot. */
const SLIDE_MS = 400;

/**
 * The shelf stands at 0.0022 units per millimetre, so a DVD case is the 0.30 x 0.42 the
 * bay was originally tuned around. Everything else - jewel case, Blu-ray, DS card -
 * follows from the one real table in media.js. A DS shelf therefore holds the 33 x 35 mm
 * card itself, and the bay becomes a card shelf rather than a DVD shelf with small props.
 */

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
  // The carpet remains scenery around the live, paged shelf rather than an image of it.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 40);

  // Reflections with no HDRI file, so the plastic still reads offline.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.25;
  pmrem.dispose();

  // Warm shop lighting gives the shelving a lived-in rental-store character; the cool
  // fill keeps printed covers accurate and prevents the dark bays from closing up. The
  // levels sit below the workshop's studio setup so the wood reads as furniture and the
  // covers stay the brightest thing in the room.
  const key = new THREE.DirectionalLight(0xfff0dc, 2.0);
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

  const fill = new THREE.DirectionalLight(0x9ab6ff, 0.6);
  fill.position.set(2.8, 1.6, 2.4);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffd62e, 0.34);
  rim.position.set(0.4, 1.4, -3.2);
  scene.add(rim);

  /* ---------- materials ---------- */

  // Rebuilt with the furniture, never shared across a rebuild: disposing a bay has to be
  // able to free everything it owns without pulling a material out from under the next bay.
  let wood;
  let back;
  let outTexture;

  function makeMaterials() {
    const loader = new THREE.TextureLoader();
    const oak = loader.load('art/retail-wood-v1/oak-laminate.webp');
    oak.colorSpace = THREE.SRGBColorSpace;
    oak.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // The fixture is walnut-stained wood, kept darker than the cover art so the media is
    // still the first thing someone sees when browsing a shelf.
    wood = new THREE.MeshStandardMaterial({ map: oak, color: 0x744c35, roughness: 0.72, metalness: 0.02 });
    back = new THREE.MeshStandardMaterial({ color: 0x1b120d, roughness: 0.92, metalness: 0 });

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
    preset: null,
    // The object the shelf holds: the closed case, or the card itself for DS/3DS.
    media: { width: 0.3, height: 0.42, depth: 0.028 },
    cartridge: false,
    body: '#2E2E34',
    accent: '#FFCE00',
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
    const item = state.media;
    const slot = item.width * (1 + SLOT_GAP_RATIO);
    const tier = item.height * (1 + HEADROOM);
    const panel = item.height * 0.14;

    return {
      item,
      slot,
      tier,
      panel,
      board: item.height * 0.07,
      plinth: item.height * 0.165,
      cornice: item.height * 0.13,
      depth: item.height * 0.71,
      margin: item.height * 0.048,
      bayGap: slot * BAY_GAP_RATIO,
      innerWidth: COLUMNS * slot,
      innerHeight: TIERS * tier,
      outerWidth: COLUMNS * slot + panel * 2,
    };
  }

  function makeBay() {
    const group = new THREE.Group();
    const plan = measure();

    const innerWidth = plan.innerWidth;
    const innerHeight = plan.innerHeight;
    const halfWidth = innerWidth / 2;
    const depth = plan.depth;
    const board = plan.board;
    const panelWidth = plan.panel;
    const plinth = plan.plinth;
    const offset = plan.item.height * 0.03;

    const backPanel = new THREE.Mesh(
      new THREE.BoxGeometry(innerWidth, innerHeight, plan.item.height * 0.07),
      back,
    );
    backPanel.position.set(0, innerHeight / 2, -depth / 2 - plan.item.height * 0.035);
    backPanel.receiveShadow = true;
    group.add(backPanel);

    // One board under each tier, plus the top board and the plinth.
    for (let tier = 0; tier <= TIERS; tier++) {
      const isPlinth = tier === 0;
      const isTop = tier === TIERS;
      const stand = new THREE.Mesh(
        new THREE.BoxGeometry(
          innerWidth + panelWidth * 2,
          isPlinth ? plinth : board,
          depth + (isPlinth ? offset * 2 : offset),
        ),
        wood,
      );
      stand.position.set(
        0,
        isPlinth
          ? -plinth / 2
          : isTop
            ? innerHeight - board / 2
            : tier * plan.tier - board / 2,
        isPlinth ? 0 : depth * 0.03,
      );
      stand.castShadow = true;
      stand.receiveShadow = true;
      group.add(stand);
    }

    // Side panels, visible on purpose.
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(panelWidth, innerHeight + plinth, depth),
        wood,
      );
      panel.position.set(side * (halfWidth + panelWidth / 2), innerHeight / 2, depth * 0.03);
      panel.castShadow = true;
      panel.receiveShadow = true;
      group.add(panel);
    }

    const cornice = new THREE.Mesh(
      new THREE.BoxGeometry(
        innerWidth + panelWidth * 2 + offset * 1.6,
        plan.cornice,
        depth + offset * 2,
      ),
      wood,
    );
    cornice.position.set(0, innerHeight + plan.cornice * 0.82, depth * 0.1);
    cornice.castShadow = true;
    cornice.receiveShadow = true;
    group.add(cornice);

    baySize = {
      width: plan.outerWidth + offset * 1.6,
      height: innerHeight + plan.cornice * 1.4,
    };

    return group;
  }

  /* ---------- media ---------- */

  /**
   * One shelf object: the closed case with its cover at the real inlay size, or the card
   * itself for DS/3DS. Printed faces are unlit, so cover art is read rather than lit; the
   * shell keeps the room's light.
   */
  function makeItem(game) {
    const group = new THREE.Group();
    let built;

    if (state.cartridge) {
      built = buildCartridge(state.preset, SHELF_UNIT, {
        body: state.preset.mediumBody ?? '#2b2b31',
        face: null,
        detail: false,
        labelAspect: game.mediumLabelRect ? game.mediumLabelRect[2] / game.mediumLabelRect[3] : null,
      });
    } else {
      built = buildCase(state.preset, SHELF_UNIT, {
        body: state.body,
        cover: generatedCoverTexture(state.preset, { accentColor: state.accent }, game, 320),
        detail: false,
      });
    }

    group.add(built.group);
    group.userData.gameId = game.id;
    group.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });

    if (state.cartridge) {
      // A box cover is not a cartridge label (PLAN.md section 3.3): only a resolved
      // cartridge label may print on the card. Everything else stays a blank body.
      if (game.mediumLabelUrl) {
        loadImage(game.mediumLabelUrl)
          .then((image) => {
            const texture = stickerFromImage(image, game.mediumLabelRect, 512);
            built.faceMaterial.map?.dispose();
            built.faceMaterial.map = texture;
            built.faceMaterial.needsUpdate = true;
            built.sticker.visible = true;
          })
          .catch(() => {});
      }
    } else if (game.frontCoverUrl) {
      loadTexture(game.frontCoverUrl, 512)
        .then((texture) => {
          fitTexture(texture, state.preset.inlay[0] / state.preset.inlay[1]);
          built.coverMaterial.map?.dispose();
          built.coverMaterial.map = texture;
          built.coverMaterial.needsUpdate = true;
        })
        .catch(() => {
          // The generated case stays. A missing file is not a shelf with a hole in it.
        });
    }

    return group;
  }

  function labelTexture(text) {
    // Drawn at the case's real proportion, so the dashes stay square whatever the
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
    const group = makeItem(game);

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
    state.preset = presetFor(platform);
    state.cartridge = state.preset.medium.kind === 'card';
    state.media = shelfItemFor(state.preset, SHELF_UNIT);
    state.body = platform?.bodyColor ?? '#1b1b1f';
    state.accent = platform?.accentColor ?? '#ffce00';
    state.bayCount = Math.max(1, Math.ceil(state.games.length / PER_BAY));
    state.bay = 0;

    makeMaterials();

    const plan = measure();
    const bayPitch = plan.bayGap;
    const caseZ = plan.depth / 2 - state.media.depth / 2 - plan.margin;

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

    // makeBay already sized this from the furniture it built.
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
    const halfHeight = baySize.height / 2 + baySize.height * 0.06;
    const halfWidth = baySize.width / 2 + baySize.width * 0.04;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

    const distance = Math.max(halfHeight / tan, halfWidth / (tan * aspect));
    const target = new THREE.Vector3(0, baySize.height / 2 - baySize.height * 0.04, 0);

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

function fail(error) {
  console.warn('Aisles: the 3D shelf is unavailable, falling back to the game list', error);
  document.body.classList.add('shelf3d-failed');
}
