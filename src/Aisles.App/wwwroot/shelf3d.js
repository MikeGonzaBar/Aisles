// The shelf: the selected platform's media as a real bookcase, three tiers of six per
// bay. Module bridge: window.aislesSnapshot plus "aisles:update" in, selection and launch out.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  SHELF_UNIT,
  presetFor,
  shelfItemFor,
  buildCase,
  generatedCoverTexture,
  loadTexture,
  fitTexture,
  disposeTree,
} from './media.js';

/** A bay holds eighteen games: three tiers of six. */
const COLUMNS = 6;
const TIERS = 3;
const PER_BAY = COLUMNS * TIERS;
const CASES_PER_FRAME = 3;
const CASES_DURING_CONSOLE_TRANSITION = 1;

/** Furniture is proportional to the media, so a shelf of DS cards is not a DVD shelf. */
const SLOT_GAP_RATIO = 0.05;
const HEADROOM = 0.10;
const BAY_GAP_RATIO = 1.27;

/** Camera: nearly head-on, a little above, so each tier's board shows its top face. */
const FOV = 32;
const TILT = THREE.MathUtils.degToRad(7);

/** One page of bays, ease-out, no overshoot. */
const SLIDE_MS = 400;
const FILTER_CASE_MS = 180;
const CONSOLE_RECEDE_MS = 140;
const CONSOLE_SWIPE_MS = 150;
const CONSOLE_ENTER_MS = 230;
const CONSOLE_DEPTH = 0.48;
const CONSOLE_SWIPE_DISTANCE = 1.8;

/** The shelf stands at 0.0022 units per millimetre; every packaging size comes from
 * the one real table in media.js. */

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

  // Warm shop lighting makes the wood read as furniture; the cool fill keeps printed
  // covers accurate and prevents dark bays from closing up.
  const key = new THREE.DirectionalLight(0xfff0dc, 2.0);
  key.position.set(-1.9, 3.4, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
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

  /* Materials */

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

    // The fixture is walnut-stained wood, kept darker than the cover art so covers stay
    // dominant.
    wood = new THREE.MeshStandardMaterial({ map: oak, color: 0x6f5847, roughness: 0.76, metalness: 0.01 });
    back = new THREE.MeshStandardMaterial({ color: 0x17110e, roughness: 0.94, metalness: 0 });

    outTexture = labelTexture('RETURN');
  }

  /* Scene graph */

  const shelfRoot = new THREE.Group();
  scene.add(shelfRoot);

  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 4),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.24 }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.z = 0.42;
  contactShadow.receiveShadow = true;
  scene.add(contactShadow);

  const bays = [];
  const cases = new Map();
  let buildFrame = 0;
  let buildGeneration = 0;
  let artworkQueue = [];
  let artworkLoading = false;

  const state = {
    games: [],
    selectedGameId: null,
    preset: null,
    // The object the retail shelf holds: the closed case for every platform.
    media: { width: 0.3, height: 0.42, depth: 0.028 },
    body: '#2E2E34',
    accent: '#FFCE00',
    platformId: null,
    // null means every case is in the current shelf; a query supplies matching IDs.
    visibleGameIds: null,
    bay: 0,
    bayCount: 1,
    bayPitch: 2.4,
  };

  let baySize = { width: 1.9, height: 1.4 };

  /* Furniture */

  /**
   * Bay dimensions follow from the platform's packaging, so a jewel-case shelf is not a
   * DVD shelf with empty bands. One bay is always three tiers of six.
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

  /* Media */

  function pumpArtwork() {
    if (artworkLoading || shelfTransition || artworkQueue.length === 0) return;

    artworkLoading = true;
    artworkQueue.shift()().finally(() => {
      artworkLoading = false;
      requestAnimationFrame(pumpArtwork);
    });
  }

  function enqueueArtwork(load) {
    artworkQueue.push(load);
    pumpArtwork();
  }

  /**
   * One shelf object: the closed retail case, cover at real inlay size. Printed faces
   * are unlit so cover art is read rather than lit.
   */
  function makeItem(game, generation) {
    const group = new THREE.Group();
    const built = buildCase(state.preset, SHELF_UNIT, {
      body: state.body,
      // Most games replace this immediately with local artwork. Keep that placeholder
      // cheap so a console switch does not synchronously paint full-size covers.
      cover: generatedCoverTexture(state.preset, { accentColor: state.accent }, game, game.frontCoverUrl ? 96 : 256),
      detail: false,
    });

    group.add(built.group);
    group.userData.gameId = game.id;
    group.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });

    if (game.frontCoverUrl) {
      enqueueArtwork(() => loadTexture(game.frontCoverUrl, 384)
        .then((texture) => {
          if (generation !== buildGeneration) {
            texture.dispose();
            return;
          }
          fitTexture(texture, state.preset.inlay[0] / state.preset.inlay[1]);
          built.coverMaterial.map?.dispose();
          built.coverMaterial.map = texture;
          built.coverMaterial.needsUpdate = true;
        })
        .catch(() => {
          // The generated case stays. A missing file is not a shelf with a hole in it.
        }));
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
    context.fillStyle = 'rgba(18,25,49,0.42)';
    context.fillRect(4, 4, width - 8, height - 8);
    context.strokeStyle = 'rgba(120,142,196,0.85)';
    context.lineWidth = 4;
    context.setLineDash([14, 10]);
    context.strokeRect(4, 4, width - 8, height - 8);

    context.setLineDash([]);
    context.lineWidth = 7;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(width * 0.63, height * 0.40);
    context.lineTo(width * 0.39, height * 0.40);
    context.lineTo(width * 0.47, height * 0.32);
    context.moveTo(width * 0.39, height * 0.40);
    context.lineTo(width * 0.47, height * 0.48);
    context.stroke();

    context.fillStyle = 'rgba(150,170,220,0.9)';
    context.font = `600 ${Math.round(width * 0.105)}px "Segoe UI", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height * 0.62);

    const texture = new THREE.CanvasTexture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /* Building a bay */

  function slotPosition(index) {
    // Fills left to right, top to bottom.
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

  function placeCase(holder, game, generation) {
    const spec = state.media;
    const group = makeItem(game, generation);

    // The return slot that stays behind when the case lifts out. Same footprint as the
    // case, so the gap reads as an intentional place to put the selected item back.
    const outline = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.width, spec.height),
      new THREE.MeshBasicMaterial({ map: outTexture, transparent: true, depthWrite: false }),
    );
    outline.userData.gameId = game.id;
    outline.visible = false;

    return { group, outline };
  }

  function build(snapshot = window.aislesSnapshot) {
    cancelAnimationFrame(buildFrame);
    buildFrame = 0;
    const generation = ++buildGeneration;
    artworkQueue = [];

    for (const bay of bays) {
      shelfRoot.remove(bay.group);
      disposeTree(bay.group);
    }
    bays.length = 0;
    cases.clear();
    shelfRoot.position.x = 0;

    const platform = snapshot?.platform;
    state.games = snapshot?.games ?? [];
    state.platformId = platform?.id ?? null;
    state.preset = presetFor(platform);
    state.media = shelfItemFor(state.preset, SHELF_UNIT);
    state.body = platform?.bodyColor ?? '#1b1b1f';
    state.accent = platform?.accentColor ?? '#ffce00';
    state.bayCount = Math.max(1, Math.ceil(state.games.length / PER_BAY));
    state.bay = 0;

    makeMaterials();

    const plan = measure();
    const bayPitch = plan.bayGap;
    const caseZ = plan.depth / 2 - state.media.depth / 2 - plan.margin;
    contactShadow.position.y = -plan.plinth - 0.003;

    for (let index = 0; index < state.bayCount; index++) {
      const group = makeBay();
      group.position.x = index * bayPitch;
      shelfRoot.add(group);
      bays.push({ group });
    }

    state.bayPitch = bayPitch;
    frameCamera();

    // Building every cover and case in one click handler stalls WebView2's next paint.
    // Three per frame keeps the selection responsive while the shelf fills in.
    let gameIndex = 0;
    const addCases = () => {
      if (generation !== buildGeneration) return;

      // Let the entering shelf stay fluid on slower GPUs. Once it has settled,
      // return to the normal incremental build rate.
      const perFrame = shelfTransition ? CASES_DURING_CONSOLE_TRANSITION : CASES_PER_FRAME;
      const end = Math.min(gameIndex + perFrame, state.games.length);
      for (; gameIndex < end; gameIndex++) {
        const game = state.games[gameIndex];
        const bayIndex = Math.floor(gameIndex / PER_BAY);
        const slot = gameIndex % PER_BAY;
        const { x, y } = slotPosition(slot);
        const { group: caseGroup, outline } = placeCase(bays[bayIndex].group, game, generation);
        caseGroup.position.set(x, y, caseZ);
        outline.position.set(x, y, caseZ - 0.01);
        bays[bayIndex].group.add(caseGroup, outline);
        cases.set(game.id, {
          group: caseGroup,
          outline,
          bay: bayIndex,
          x,
          y,
          z: caseZ,
          filterProgress: 1,
          targetFilterProgress: 1,
        });
      }

      applySelection();
      buildFrame = gameIndex < state.games.length ? requestAnimationFrame(addCases) : 0;
    };

    buildFrame = requestAnimationFrame(addCases);
  }

  /* Selection */

  /**
   * Selection hides the case and leaves a dashed return slot, so paging away and back
   * still shows which game is out (PLAN.md section 6).
   */
  function applySelection() {
    for (const [gameId, slot] of cases) {
      const matchesFilter = state.visibleGameIds === null || state.visibleGameIds.has(gameId);
      slot.targetFilterProgress = matchesFilter ? 1 : 0;

      if (!matchesFilter) {
        slot.outline.visible = false;
        // Keep the case alive until the frame loop has pulled it out of the bay.
        slot.group.visible = slot.filterProgress > 0;
        continue;
      }

      const chosen = gameId === state.selectedGameId;
      slot.group.visible = !chosen;
      slot.outline.visible = chosen;

      if (chosen) {
        // A selected matching game is represented by its RETURN slot, not a
        // case that joins the search animation.
        slot.filterProgress = 1;
        slot.targetFilterProgress = 1;
        slot.group.scale.setScalar(1);
        slot.group.position.z = slot.z;
      }
    }
  }

  function animateFilteredCases(elapsed) {
    const step = Math.min(1, elapsed / FILTER_CASE_MS);

    for (const [gameId, slot] of cases) {
      if (slot.filterProgress === slot.targetFilterProgress || gameId === state.selectedGameId) {
        continue;
      }

      slot.filterProgress += Math.sign(slot.targetFilterProgress - slot.filterProgress) * step;
      slot.filterProgress = THREE.MathUtils.clamp(slot.filterProgress, 0, 1);

      // Non-matching cases slide toward the player, then disappear; restoring a
      // match reverses the same motion. Furniture and matching cases never rebuild.
      const removed = 1 - slot.filterProgress;
      slot.group.visible = slot.filterProgress > 0;
      slot.group.position.z = slot.z + removed * 0.34;
      slot.group.scale.setScalar(0.92 + slot.filterProgress * 0.08);

      if (slot.filterProgress === 0) {
        slot.group.scale.setScalar(1);
      }
    }
  }

  /* Camera and resizing */

  // A console can change while Covers or List has hidden this canvas, so keep the last
  // visible size separate from the WebGL buffer.
  let lastVisibleWidth = 0;
  let lastVisibleHeight = 0;

  function frameCamera() {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const aspect = Math.max(width / height, 0.4);

    // Leave enough room for the aisle and carpet to establish depth around the cabinet.
    const halfHeight = baySize.height / 2 + baySize.height * 0.12;
    const halfWidth = baySize.width / 2 + baySize.width * 0.10;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

    const distance = Math.max(halfHeight / tan, halfWidth / (tan * aspect));
    const target = new THREE.Vector3(0, baySize.height / 2 - baySize.height * 0.07, 0);

    camera.position.set(0, target.y + Math.sin(TILT) * distance, Math.cos(TILT) * distance);
    camera.lookAt(target);
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (width === 0 || height === 0) {
      lastVisibleWidth = 0;
      lastVisibleHeight = 0;
      return;
    }

    const visibilityChanged = width !== lastVisibleWidth || height !== lastVisibleHeight;
    lastVisibleWidth = width;
    lastVisibleHeight = height;

    const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
    const bufferWidth = Math.round(width * ratio);
    const bufferHeight = Math.round(height * ratio);

    if (canvas.width === bufferWidth && canvas.height === bufferHeight) {
      // Returning from a hidden view keeps the existing pixels, but it must not
      // keep the camera that was framed from the hidden canvas's 1 x 1 fallback.
      if (visibilityChanged) frameCamera();
      return;
    }

    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frameCamera();
  }

  /* Paging */

  let slideFrom = 0;
  let slideTarget = 0;
  let slideStarted = 0;
  let sliding = false;

  function pageTo(index, animate = true) {
    if (shelfTransition) return;

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

  /* Interaction */

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
      // A selected case is out of the shelf, so its return slot remains clickable.
      if (slot.targetFilterProgress > 0) {
        targets.push(slot.group.visible ? slot.group : slot.outline);
      }
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
      // Hover moves the case slightly toward the viewer.
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
      if (gameId === state.selectedGameId) {
        window.aislesClearGameSelection?.();
      } else {
        window.aislesSelectGame?.(gameId);
      }
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

    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement || event.target.isContentEditable) {
      return;
    }

    // While the shelf is hidden (Covers or List is up), the arrow keys belong to
    // that view: no paging, and no preventDefault stealing the scroll.
    if (canvas.closest('[hidden]')) {
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

  /* Data flow */

  function snapshotSignature(snapshot) {
    return [
      snapshot.platform?.id ?? '',
      snapshot.platform?.media ?? '',
      (snapshot.games ?? []).map((game) => game.id).join('|'),
    ].join('::');
  }

  function applySnapshotState(snapshot) {
    state.visibleGameIds = snapshot.visibleGameIds ? new Set(snapshot.visibleGameIds) : null;
    state.selectedGameId = snapshot.selectedGameId ?? null;
  }

  function beginConsoleTransition() {
    if (!queuedSnapshot || shelfTransition) return;

    const consoles = queuedSnapshot.consoles ?? [];
    const currentIndex = consoles.findIndex((item) => item.id === state.platformId);
    const nextIndex = consoles.findIndex((item) => item.id === queuedSnapshot.platform?.id);
    const direction = nextIndex > currentIndex ? 1 : -1;

    // Freeze shelf paging while its whole bay moves as one scene.
    sliding = false;
    shelfTransition = {
      phase: 'recede',
      started: performance.now(),
      direction: currentIndex < 0 || nextIndex < 0 ? 1 : direction,
      fromX: shelfRoot.position.x,
    };
    transitionMetrics = { samples: [], lastFrameAt: performance.now() };
  }

  function easeOut(t) {
    return 1 - (1 - t) ** 3;
  }

  function animateConsoleTransition(now) {
    if (!shelfTransition) return;

    const transition = shelfTransition;
    if (transition.phase === 'recede') {
      const t = Math.min(1, (now - transition.started) / CONSOLE_RECEDE_MS);
      shelfRoot.position.x = transition.fromX;
      shelfRoot.position.z = -CONSOLE_DEPTH * easeOut(t);
      if (t < 1) return;
      transition.phase = 'swipe-out';
      transition.started = now;
      return;
    }

    if (transition.phase === 'swipe-out') {
      const t = Math.min(1, (now - transition.started) / CONSOLE_SWIPE_MS);
      shelfRoot.position.x = transition.fromX - transition.direction * CONSOLE_SWIPE_DISTANCE * easeOut(t);
      shelfRoot.position.z = -CONSOLE_DEPTH;
      if (t < 1) return;

      // The old shelf is now fully offscreen. Give the rebuild its own frame so
      // geometry and canvas-texture work cannot interrupt the visible swipe.
      transition.phase = 'prepare-incoming';
      transition.started = now;
      return;
    }

    if (transition.phase === 'prepare-incoming') {
      const incomingSnapshot = queuedSnapshot;
      const incomingSignature = queuedSignature;
      queuedSnapshot = null;
      queuedSignature = null;
      applySnapshotState(incomingSnapshot);
      build(incomingSnapshot);
      builtSignature = incomingSignature;
      shelfRoot.position.set(transition.direction * CONSOLE_SWIPE_DISTANCE, 0, -CONSOLE_DEPTH);
      applySelection();
      announce();
      transition.phase = 'enter';
      transition.started = now;
      return;
    }

    const t = Math.min(1, (now - transition.started) / CONSOLE_ENTER_MS);
    const remaining = 1 - easeOut(t);
    shelfRoot.position.set(
      transition.direction * CONSOLE_SWIPE_DISTANCE * remaining,
      0,
      -CONSOLE_DEPTH * remaining,
    );
    if (t >= 1) {
      shelfRoot.position.set(0, 0, 0);
      shelfTransition = null;
      finishTransitionMetrics();
      pumpArtwork();
      beginConsoleTransition();
    }
  }

  function update() {
    const snapshot = window.aislesSnapshot;
    if (!snapshot) {
      return;
    }

    const signature = snapshotSignature(snapshot);

    // If the user returns to the shelf already on screen before the handoff
    // crosses over, keep it rather than completing an obsolete transition.
    if (shelfTransition && signature === builtSignature) {
      queuedSnapshot = null;
      queuedSignature = null;
      shelfRoot.position.set(shelfTransition.fromX, 0, 0);
      shelfTransition = null;
      finishTransitionMetrics(true);
      pumpArtwork();
    }

    if (signature !== builtSignature) {
      // Only a console change gets the full aisle-to-aisle handoff. A library
      // refresh on the same console can rebuild immediately without decoration.
      if (builtSignature !== null && snapshot.platform?.id !== state.platformId) {
        queuedSnapshot = snapshot;
        queuedSignature = signature;
        beginConsoleTransition();
        return;
      }

      applySnapshotState(snapshot);
      build(snapshot);
      builtSignature = signature;
      applySelection();
      announce();
      return;
    }

    applySnapshotState(snapshot);
    applySelection();
    announce();
  }

  let builtSignature = null;
  let shelfTransition = null;
  let queuedSnapshot = null;
  let queuedSignature = null;
  let transitionMetrics = null;
  let lastTransitionMetrics = null;

  function sampleTransitionFrame(now) {
    if (!transitionMetrics) return;
    const elapsed = now - transitionMetrics.lastFrameAt;
    transitionMetrics.lastFrameAt = now;
    if (elapsed > 0) transitionMetrics.samples.push(elapsed);
  }

  function finishTransitionMetrics(cancelled = false) {
    if (!transitionMetrics) return;
    const samples = transitionMetrics.samples;
    const ordered = [...samples].sort((a, b) => a - b);
    const averageMs = samples.reduce((sum, value) => sum + value, 0) / Math.max(samples.length, 1);
    lastTransitionMetrics = {
      cancelled,
      frames: samples.length,
      averageMs: Number(averageMs.toFixed(2)),
      fps: Number((1000 / averageMs).toFixed(1)),
      p95Ms: Number((ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0).toFixed(2)),
      worstMs: Number((ordered.at(-1) ?? 0).toFixed(2)),
    };
    transitionMetrics = null;
  }

  /* Frame loop */

  let filterAnimationAt = performance.now();

  function tick() {
    resize();

    const now = performance.now();
    sampleTransitionFrame(now);
    animateFilteredCases(now - filterAnimationAt);
    filterAnimationAt = now;
    animateConsoleTransition(now);

    if (sliding) {
      const elapsed = now - slideStarted;
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
    getTransitionMetrics: () => lastTransitionMetrics,
  };
}

/* Helpers */

/** The room behind the furniture: a warm-to-dark navy wash, painted here so the shelf
 * canvas reads as part of the page. */
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
  window.dispatchEvent(new Event('aisles:shelf3d-failed'));
}
