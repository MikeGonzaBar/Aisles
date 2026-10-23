// Aisles - Phase 3: the 3D console lineup.
//
// This band is the platform switcher (PLAN.md section 6): every console in
// consoles.json stands on one floor line with its short name beneath, and the
// selected one lifts, grows and takes the spotlight. The camera is fixed with a
// gentle idle drift; there is no free orbit or zoom in v1.
//
// It loads as a module so it can import Three.js, which also means it cannot see
// the top-level bindings in stage.js. The contract between the two files is
// window.aislesSnapshot plus the "aisles:update" event going in, and
// window.aislesSelectConsole coming back out.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Every model is scaled so the larger of its width and height is this. The camera is
 * nearly head-on, so width and height are what decide how big a console looks; scaling
 * by the longest axis instead let depth or height dominate and left the Wii and the
 * Xbox 360 at a fifth of the PlayStation's presence.
 */
const TARGET_SIZE = 0.8;

/** Small optical corrections after silhouette fitting; tall models otherwise dominate. */
const VISUAL_SCALE = {
  ps2: 1.04,
  ps3: 1.04,
  wii: 0.91,
  xbox360: 0.92,
};

/**
 * Depth gets its own cap. A flat console scaled up by width would otherwise stretch a
 * metre toward the camera and off its plinth.
 */
const MAX_DEPTH = 1;

/** Clear space between neighbouring consoles, measured between their bounding boxes. */
const GAP = 0.58;

/**
 * Label bookkeeping for the clamp in updateLabels: .stage-labels .slot sits 7 px below
 * its projected point (stage.css) and needs a few pixels of air under the count line,
 * so the block can never be sliced by .lineup's overflow.
 */
const LABEL_MARGIN = 7;
const LABEL_PAD = 4;

/** How much bigger, and how much higher off the floor, the selected console reads. */
const SELECTED_SCALE = 1.16;
const SELECTED_LIFT = 0.055;
const HOVER_LIFT = 0.02;
const HOVER_SCALE = 1.025;
const SELECTED_BOB = 0.012;
const SELECTED_FORWARD = 0.018;

/** Narrow vertical field of view, so the row reads as a lineup rather than a wide-angle. */
const FOV = 27;
const LOOK_AT = new THREE.Vector3(0, 0.44, 0);

/**
 * The plinth top and the floor must never share a plane, and neither may a console's
 * underside share a plane with its plinth: coincident faces z-fight, and with the camera
 * drifting the fight crawls across the model as a flicker. These offsets are sub-pixel
 * at lineup size but keep every surface strictly ordered in depth.
 */
const PLINTH_TOP = 0.005;
const MODEL_BASE = 0.0065;

/** Yaw per console, in degrees, so each one faces the camera. Tuned against the renders. */
const YAW = {
  // The PS1 model is modelled along X while every other console faces down Z: it is
  // 0.19 wide and 0.29 deep, the inverse of a real PlayStation's 27 x 19 cm footprint.
  ps1: -90,
  ps2: 0,
  ps3: 0,
  wii: 0,
  ds: 0,
  xbox360: 0,
  gamecube: 0,
  '3ds': 0,
};

const canvas = document.getElementById('stage-canvas');
const labelsRoot = document.getElementById('stage-labels');

if (canvas && labelsRoot) {
  try {
    start(canvas, labelsRoot);
  } catch (error) {
    fail(error);
  }
} else {
  fail(new Error('stage markup missing'));
}

function start(canvas, labelsRoot) {
  // Slatwall is supplied by the responsive CSS background behind the live models.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // The light never moves and nothing in the scene animates in the light's space, so the
  // shadow map is baked and refreshed only when the selection changes. Recomputing it
  // every frame made self-shadowing crawl over the consoles while the camera drifted.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60);
  const basePosition = new THREE.Vector3();

  // Reflections with no HDRI file, so the gloss still reads fully offline.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.36;
  pmrem.dispose();

  // Tungsten-like key light and a cooler fill echo a 1990s rental shop without making
  // dark consoles disappear into the walnut counter.
  const key = new THREE.DirectionalLight(0xfff0dc, 2.1);
  key.position.set(-2.6, 4.2, 3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 3.2;
  key.shadow.camera.bottom = -1.2;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 16;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x9ab6ff, 0.64);
  fill.position.set(4.5, 2.2, 3.4);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffd62e, 0.36);
  rim.position.set(0, 1.6, -5);
  scene.add(rim);

  // A single spotlight that slides to whichever console is selected.
  const spot = new THREE.SpotLight(0xffe9ae, 0, 7.5, Math.PI / 6.5, 0.6, 1.4);
  spot.position.set(0, 3.1, 1.5);
  scene.add(spot, spot.target);
  let spotTargetX = 0;

  // There is deliberately no opaque ground plane. The band's slatwall shows through the
  // transparent canvas; an opaque floor would cut it with a hard horizon.
  // A ShadowMaterial plane receives the contact shadows and paints nothing else, so each
  // console appears to stand on its own patch of stage.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 44),
    new THREE.ShadowMaterial({ opacity: 0.42 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // One soft pool per console, built from a shared texture and tinted per slot.
  const poolTexture = radialPoolTexture();

  /* ---------- slots ---------- */

  const slots = new Map();
  const loader = new GLTFLoader();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const labelPoint = new THREE.Vector3();

  const state = { consoles: [], selectedId: null, hoveredId: null };
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let builtSignature = null;
  let modelledIds = null;
  let rowWidth = 0;

  function whenIdle() {
    return new Promise((resolve) => {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(resolve, { timeout: 1000 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  function buildSlot(platform) {
    const root = new THREE.Group();
    root.userData.consoleId = platform.id;

    const holder = new THREE.Group();
    root.add(holder);

    // A unit cylinder, scaled to each model's own footprint once it has loaded.
    const platform3d = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.03, 56),
      new THREE.MeshStandardMaterial({ color: 0x202a52, roughness: 0.62, metalness: 0.18 }),
    );
    platform3d.position.y = PLINTH_TOP - 0.015;
    platform3d.receiveShadow = true;
    root.add(platform3d);

    // Each console gets its own pool of light, so the row never reads as one continuous
    // band of stage shared by everything on it.
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: poolTexture,
        color: 0x5f7ac0,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.0055;
    // The pool is scenery, not a hit target: overlapping pools must never decide which
    // console a click meant.
    pool.raycast = () => {};
    root.add(pool);

    const placeholder = placeholderGroup();
    holder.add(placeholder);

    scene.add(root);

    const label = document.createElement('span');
    label.className = 'slot';
    labelsRoot.append(label);

    const slot = {
      console: platform,
      root,
      holder,
      platform: platform3d,
      pool,
      placeholder,
      label,
      labelHeight: 0,
      model: null,
      x: 0,
      width: TARGET_SIZE,
      depth: 0.5,
      motion: {
        scale: 1,
        y: 0,
        z: 0,
        targetScale: 1,
        targetY: 0,
        targetZ: 0,
        phase: slots.size * 0.83,
      },
    };
    sizePlatform(slot, slot.width, slot.depth);
    slots.set(platform.id, slot);
    renderLabel(slot);
    return slot;
  }

  /** Matches the plinth and the pool to the thing standing on them. */
  function sizePlatform(slot, width, depth) {
    const radiusX = Math.max(width, 0.24) / 2 + 0.07;
    const radiusZ = Math.max(depth, 0.24) / 2 + 0.07;
    slot.platform.scale.set(radiusX / 0.5, 1, radiusZ / 0.5);

    // The pool plane is a unit square rotated flat, so its local X/Y are world X/Z. It
    // stops short of half the gap to the next console so neighbouring pools never merge
    // into one band.
    slot.pool.scale.set(width + 0.42, depth + 0.7, 1);
  }

  function renderLabel(slot) {
    const platform = slot.console;
    slot.label.replaceChildren();

    const name = document.createElement('span');
    name.textContent = platform.shortName;
    slot.label.append(name);

    if (!platform.gamesPathExists || platform.games.length === 0) {
      const note = document.createElement('span');
      note.className = 'pending';
      note.textContent = platform.gamesPathExists ? 'No games' : 'Folder not set';
      slot.label.append(note);
      return;
    }

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${platform.games.length} games`;
    slot.label.append(count);
  }

  /* ---------- models ---------- */

  async function loadModels() {
    if (modelledIds === null) {
      const response = await fetch('models/lineup-catalog.json');
      const catalog = response.ok ? await response.json() : { models: [] };
      modelledIds = new Set((catalog.models ?? []).map((model) => model.id));
    }

    const candidates = [...slots.values()].filter((slot) => modelledIds.has(slot.console.id));
    const selected = candidates.find((slot) => slot.console.id === state.selectedId);

    async function load(slot) {
      try {
        const gltf = await loader.loadAsync(`models/${slot.console.id}/lineup.glb`);
        if (slots.get(slot.console.id) === slot) {
          attachModel(slot, gltf.scene);
        } else {
          disposeTree(gltf.scene);
        }
      } catch (error) {
        // A missing LOD falls back to the placeholder already in the slot.
        console.warn(`Aisles: lineup model ${slot.console.id} failed`, error);
      }
    }

    if (selected) {
      await load(selected);
      layout();
      applyVisualState();
    }

    for (const slot of candidates) {
      if (slot === selected) continue;
      await whenIdle();
      await load(slot);
      layout();
      applyVisualState();
    }

    // Widths are only known once each model has been measured, so the row is packed and
    // framed again here instead of settling on the default widths.
    layout();
    applyVisualState();

    window.aislesStage3d = { THREE, scene, camera, renderer, slots, state };
  }

  function attachModel(slot, model) {
    model.traverse((node) => {
      if (!node.isMesh) {
        return;
      }

      node.castShadow = true;
      node.receiveShadow = true;

      for (const material of [].concat(node.material)) {
        if (material && 'envMapIntensity' in material) {
          material.envMapIntensity = 0.9;
        }
      }
    });

    // Rotate first, so the silhouette is measured facing the camera. The PS1 model is
    // authored along X, and measuring it before the yaw would scale it by the wrong axis.
    model.rotation.y = THREE.MathUtils.degToRad(YAW[slot.console.id] ?? 0);
    model.updateMatrixWorld(true);

    // Then scale on the screen-facing silhouette, not the longest axis. Width and height
    // are what the camera sees; depth is capped separately so a flat console does not
    // stretch toward the viewer just because it is wide.
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    let scale = TARGET_SIZE / Math.max(size.x, size.y, 1e-6);
    scale *= VISUAL_SCALE[slot.console.id] ?? 1;

    if (size.z * scale > MAX_DEPTH) {
      scale = MAX_DEPTH / size.z;
    }

    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);

    const fitted = new THREE.Box3().setFromObject(model);
    const centre = fitted.getCenter(new THREE.Vector3());
    model.position.set(-centre.x, MODEL_BASE - fitted.min.y, -centre.z);

    slot.width = fitted.max.x - fitted.min.x;
    slot.depth = fitted.max.z - fitted.min.z;
    sizePlatform(slot, slot.width, slot.depth);

    slot.holder.add(model);
    slot.model = model;
    slot.placeholder.visible = false;
    renderer.shadowMap.needsUpdate = true;
  }

  function placeholderGroup() {
    const group = new THREE.Group();

    const ghost = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.2, 0.5),
      new THREE.MeshStandardMaterial({
        color: 0x1c2546,
        roughness: 0.4,
        metalness: 0.3,
        transparent: true,
        opacity: 0.5,
      }),
    );
    ghost.position.y = MODEL_BASE + 0.1;
    ghost.castShadow = true;
    group.add(ghost);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(ghost.geometry),
      new THREE.LineDashedMaterial({ color: 0x3f4d7a, dashSize: 0.05, gapSize: 0.04 }),
    );
    edges.computeLineDistances();
    edges.position.copy(ghost.position);
    // Lines are decorative. THREE.Raycaster gives a line a 1 world-unit threshold, which
    // makes a dashed outline pickable from a whole console away and swallows clicks meant
    // for a neighbour, so an outline must never take part in a pick.
    edges.raycast = () => {};
    group.add(edges);

    return group;
  }

  /* ---------- layout, selection, labels ---------- */

  function layout() {
    const count = state.consoles.length;
    if (count === 0) {
      return;
    }

    // Consoles are packed left to right with a fixed gap between their bounding boxes,
    // so the space a person sees is the same everywhere. Even centre spacing would make
    // the gaps look wrong as soon as two consoles are different widths.
    const widths = state.consoles.map((platform) => slots.get(platform.id)?.width ?? TARGET_SIZE);
    const total = widths.reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, count - 1);
    rowWidth = total;

    let cursor = -total / 2;

    state.consoles.forEach((platform, index) => {
      const slot = slots.get(platform.id);
      if (!slot) {
        return;
      }

      slot.x = cursor + widths[index] / 2;
      slot.root.position.x = slot.x;
      cursor += widths[index] + GAP;
    });

    frameCamera();
  }

  function applyVisualState() {
    for (const slot of slots.values()) {
      const selected = slot.console.id === state.selectedId;
      const hovered = !selected && slot.console.id === state.hoveredId;

      // Targets are eased in the frame loop. Hover therefore feels physical rather than
      // snapping upward, while the selected console has a quiet display-case bob.
      slot.motion.targetScale = selected ? SELECTED_SCALE : hovered ? HOVER_SCALE : 1;
      slot.motion.targetY = selected ? SELECTED_LIFT : hovered ? HOVER_LIFT : 0;
      slot.motion.targetZ = selected ? SELECTED_FORWARD : 0;

      slot.platform.material.color.set(selected ? 0x4a3c14 : 0x232c52);
      slot.platform.material.emissive.set(selected ? 0x241a00 : 0x000000);
      slot.pool.material.color.set(selected ? 0xffce66 : 0x5f7ac0);
      slot.pool.material.opacity = selected ? 0.85 : 0.42;
      slot.label.dataset.selected = String(selected);
    }

    spotTargetX = slots.get(state.selectedId)?.x ?? 0;
    spot.intensity = slots.has(state.selectedId) ? 26 : 0;

    // Lift and scale change shadows, so the baked map has to catch up.
    renderer.shadowMap.needsUpdate = true;
  }

  function updateLabels() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    for (const slot of slots.values()) {
      labelPoint.set(slot.x, 0, 0).project(camera);

      // The label hangs from the plinth it names. On a short lineup the plinth can
      // project close enough to the bottom edge that the second line ("12 games",
      // "Folder not set") runs past .lineup's overflow and is clipped, which happens
      // at 1280 wide and never at 2560. Lift the block just enough to keep it whole;
      // at heights where it already fits, this changes nothing.
      slot.labelHeight ||= slot.label.offsetHeight;
      const reserve = LABEL_MARGIN + slot.labelHeight + LABEL_PAD;
      const top = Math.max(
        0,
        Math.min((-labelPoint.y * 0.5 + 0.5) * height, height - reserve),
      );

      slot.label.style.transform =
        `translate(-50%, 0) translate(${((labelPoint.x * 0.5 + 0.5) * width).toFixed(1)}px, ` +
        `${top.toFixed(1)}px)`;
    }
  }

  function frameCamera() {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const aspect = Math.max(width / height, 0.1);

    const halfWidth = Math.max(0.9, rowWidth / 2 + 0.42);
    const halfHeight = 0.72;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

    // The row is framed at the look-at plane, but the console bodies sit in front of it.
    // At a wide aspect the camera is close enough that perspective would push the end
    // consoles past the edge; pull back by half the deepest model plus a little margin.
    const nearHalfDepth = MAX_DEPTH / 2 + 0.08;
    const distance = Math.max(
      halfWidth / (tan * aspect) + nearHalfDepth,
      halfHeight / tan,
    );

    const tilt = THREE.MathUtils.degToRad(10);
    basePosition.set(0, LOOK_AT.y + Math.sin(tilt) * distance, Math.cos(tilt) * distance);
    camera.position.copy(basePosition);
    camera.lookAt(LOOK_AT);
  }

  /* ---------- interaction ---------- */

  /**
   * What a click may hit: the plinth and whichever body the slot is showing. Hidden
   * placeholders stay in the scene — and three raycasts them whether visible or not — so
   * they are excluded rather than left to win a pick against the model standing on top.
   */
  function pickTargets() {
    const targets = [];

    for (const slot of slots.values()) {
      targets.push(slot.platform, slot.model ?? slot.placeholder);
    }

    return targets;
  }

  function consoleIdAt(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);

    const hit = raycaster.intersectObjects(pickTargets(), true)[0];
    if (!hit) {
      return null;
    }

    for (let node = hit.object; node; node = node.parent) {
      if (node.userData.consoleId) {
        return node.userData.consoleId;
      }
    }

    return null;
  }

  canvas.addEventListener('pointermove', (event) => {
    const id = consoleIdAt(event);

    if (id !== state.hoveredId) {
      state.hoveredId = id;
      canvas.style.cursor = id ? 'pointer' : 'default';
      applyVisualState();
    }
  });

  canvas.addEventListener('pointerleave', () => {
    if (state.hoveredId !== null) {
      state.hoveredId = null;
      canvas.style.cursor = 'default';
      applyVisualState();
    }
  });

  canvas.addEventListener('click', (event) => {
    const id = consoleIdAt(event);
    if (id) {
      window.aislesSelectConsole?.(id);
    }
  });

  // The host disables WebView2's default context menu, so the console menu is ours.
  // The module cannot see stage.js's library state; it only reports what was hit.
  canvas.addEventListener('contextmenu', (event) => {
    const id = consoleIdAt(event);
    if (!id) {
      return;
    }

    event.preventDefault();
    window.dispatchEvent(new CustomEvent('aisles:consoleContext', {
      detail: { consoleId: id, x: event.clientX, y: event.clientY },
    }));
  });

  /* ---------- data flow ---------- */

  function update() {
    const snapshot = window.aislesSnapshot;
    if (!snapshot) {
      return;
    }

    state.consoles = snapshot.consoles ?? [];
    state.selectedId = snapshot.selectedConsoleId;

    const signature = state.consoles.map((platform) => platform.id).join('|');
    if (signature !== builtSignature) {
      rebuild();
      builtSignature = signature;
    }

    layout();
    applyVisualState();
  }

  function rebuild() {
    for (const slot of slots.values()) {
      scene.remove(slot.root);
      disposeTree(slot.root);
      slot.label.remove();
    }

    slots.clear();
    state.hoveredId = null;

    for (const platform of state.consoles) {
      buildSlot(platform);
    }

    loadModels().catch((error) => console.warn('Aisles: lineup load failed', error));
  }

  /* ---------- frame loop ---------- */

  function tick(now) {
    // The camera stays where frameCamera put it. It used to drift on a slow sine, which
    // moved every console together and made the row read as one sliding object; a stage
    // that holds still lets each console sit on its own.
    resize();

    spot.position.x += (spotTargetX - spot.position.x) * 0.12;
    spot.target.position.x = spot.position.x;

    for (const slot of slots.values()) {
      const selected = slot.console.id === state.selectedId;
      const bob = selected && !reducedMotion
        ? Math.sin(now / 460 + slot.motion.phase) * SELECTED_BOB
        : 0;
      const easing = reducedMotion ? 1 : 0.15;

      slot.motion.scale += (slot.motion.targetScale - slot.motion.scale) * easing;
      slot.motion.y += (slot.motion.targetY + bob - slot.motion.y) * easing;
      slot.motion.z += (slot.motion.targetZ - slot.motion.z) * easing;
      slot.holder.scale.setScalar(slot.motion.scale);
      slot.holder.position.y = slot.motion.y;
      slot.holder.position.z = slot.motion.z;
    }

    updateLabels();
    renderer.render(scene, camera);
  }

  /**
   * Sized from the canvas's own box, checked each frame. A ResizeObserver alone was not
   * enough: when the first measurement lands mid-layout the drawing buffer keeps the wrong
   * size, the picture is stretched against its hit testing, and nothing forces a recheck.
   */
  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (width === 0 || height === 0) {
      return;
    }

    const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
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

  resize();

  window.addEventListener('aisles:update', update);
  update();
  renderer.setAnimationLoop(tick);

  window.aislesStage3d = { THREE, scene, camera, renderer, slots, state };
}

/* ---------- helpers ---------- */

function radialPoolTexture() {
  const size = 256;
  const source = document.createElement('canvas');
  source.width = size;
  source.height = size;

  // White, so each slot's material colour decides the tint and one texture serves the row.
  const context = source.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.shared = true;
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
        // The light-pool texture is shared by every slot, so it outlives any one of them.
        if (value && value.isTexture && !value.userData.shared) {
          value.dispose();
        }
      }
      material.dispose();
    }
  });
}

function fail(error) {
  console.warn('Aisles: the 3D lineup is unavailable, falling back to the console list', error);
  document.body.classList.add('stage3d-failed');
}
