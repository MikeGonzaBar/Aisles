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

/** Horizontal gap between console slots. */
const PITCH = 1.45;

/** Every model is normalized so its largest dimension is this, whatever units it shipped in. */
const MODEL_SIZE = 0.82;

/** How much bigger, and how much higher off the floor, the selected console reads. */
const SELECTED_SCALE = 1.22;
const SELECTED_LIFT = 0.055;
const HOVER_LIFT = 0.02;

/** Narrow vertical field of view, so the row reads as a lineup rather than a wide-angle. */
const FOV = 27;
const LOOK_AT = new THREE.Vector3(0, 0.44, 0);

/** Yaw per console, in degrees, so each one faces the camera. Tuned against the renders. */
const YAW = {
  ps1: 0,
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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b1022, 9, 22);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60);
  const basePosition = new THREE.Vector3();

  // Reflections with no HDRI file, so the gloss still reads fully offline.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.42;
  pmrem.dispose();

  // One warm key casts the shadows; a cool fill and a yellow rim shape the silhouettes.
  const key = new THREE.DirectionalLight(0xfff2dd, 2.5);
  key.position.set(-2.6, 4.2, 3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 3.2;
  key.shadow.camera.bottom = -1.2;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 16;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x8fb0ff, 0.7);
  fill.position.set(4.5, 2.2, 3.4);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffd62e, 0.5);
  rim.position.set(0, 1.6, -5);
  scene.add(rim);

  // A single spotlight that slides to whichever console is selected.
  const spot = new THREE.SpotLight(0xffe9ae, 0, 7.5, Math.PI / 6.5, 0.6, 1.4);
  spot.position.set(0, 3.1, 1.5);
  scene.add(spot, spot.target);
  let spotTargetX = 0;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(32, 14),
    new THREE.MeshStandardMaterial({ color: 0x111834, roughness: 0.62, metalness: 0.22 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // A pool of light under the row, drawn additively so it never fights the shadows.
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(12.5, 4),
    new THREE.MeshBasicMaterial({
      map: radialPoolTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.003;
  scene.add(pool);

  /* ---------- slots ---------- */

  const slots = new Map();
  const loader = new GLTFLoader();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const labelPoint = new THREE.Vector3();

  const state = { consoles: [], selectedId: null, hoveredId: null };
  let builtSignature = null;
  let modelledIds = null;

  function buildSlot(platform) {
    const root = new THREE.Group();
    root.userData.consoleId = platform.id;

    const holder = new THREE.Group();
    root.add(holder);

    const platform3d = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.46, 0.03, 56),
      new THREE.MeshStandardMaterial({ color: 0x1a2246, roughness: 0.45, metalness: 0.45 }),
    );
    platform3d.position.y = -0.015;
    platform3d.receiveShadow = true;
    root.add(platform3d);

    const placeholder = placeholderGroup();
    holder.add(placeholder);

    scene.add(root);

    const label = document.createElement('span');
    label.className = 'slot';
    labelsRoot.append(label);

    const slot = { console: platform, root, holder, platform: platform3d, placeholder, label, model: null, x: 0 };
    slots.set(platform.id, slot);
    renderLabel(slot);
    return slot;
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
      note.textContent = platform.gamesPathExists ? 'no games' : 'no games folder';
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

    await Promise.all(
      [...slots.values()].map(async (slot) => {
        if (!modelledIds.has(slot.console.id)) {
          return;
        }

        try {
          const gltf = await loader.loadAsync(`models/${slot.console.id}/lineup.glb`);
          attachModel(slot, gltf.scene);
        } catch (error) {
          // A missing LOD falls back to the placeholder already in the slot.
          console.warn(`Aisles: lineup model ${slot.console.id} failed`, error);
        }
      }),
    );

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

    // Normalize so the lineup is consistent regardless of what units the source model
    // used: largest dimension becomes 1, centred on X/Z, resting on the floor.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.scale.setScalar(MODEL_SIZE / Math.max(size.x, size.y, size.z, 1e-6));
    model.rotation.y = THREE.MathUtils.degToRad(YAW[slot.console.id] ?? 0);
    model.updateMatrixWorld(true);

    const fitted = new THREE.Box3().setFromObject(model);
    const centre = fitted.getCenter(new THREE.Vector3());
    model.position.set(-centre.x, -fitted.min.y, -centre.z);

    slot.holder.add(model);
    slot.model = model;
    slot.placeholder.visible = false;
  }

  function placeholderGroup() {
    const group = new THREE.Group();

    const ghost = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.2, 0.52),
      new THREE.MeshStandardMaterial({
        color: 0x1c2546,
        roughness: 0.4,
        metalness: 0.3,
        transparent: true,
        opacity: 0.5,
      }),
    );
    ghost.position.y = 0.1;
    ghost.castShadow = true;
    group.add(ghost);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(ghost.geometry),
      new THREE.LineDashedMaterial({ color: 0x3f4d7a, dashSize: 0.05, gapSize: 0.04 }),
    );
    edges.computeLineDistances();
    edges.position.copy(ghost.position);
    group.add(edges);

    return group;
  }

  /* ---------- layout, selection, labels ---------- */

  function layout() {
    const count = state.consoles.length;

    state.consoles.forEach((platform, index) => {
      const slot = slots.get(platform.id);
      if (!slot) {
        return;
      }

      slot.x = (index - (count - 1) / 2) * PITCH;
      slot.root.position.x = slot.x;
    });

    frameCamera();
  }

  function applyVisualState() {
    for (const slot of slots.values()) {
      const selected = slot.console.id === state.selectedId;
      const hovered = !selected && slot.console.id === state.hoveredId;

      slot.holder.scale.setScalar(selected ? SELECTED_SCALE : 1);
      slot.holder.position.y = selected ? SELECTED_LIFT : hovered ? HOVER_LIFT : 0;

      slot.platform.material.color.set(selected ? 0xffce00 : 0x1a2246);
      slot.platform.material.emissive.set(selected ? 0x402f00 : 0x000000);
      slot.label.dataset.selected = String(selected);
    }

    spotTargetX = slots.get(state.selectedId)?.x ?? 0;
    spot.intensity = slots.has(state.selectedId) ? 30 : 0;
  }

  function updateLabels() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    for (const slot of slots.values()) {
      labelPoint.set(slot.x, 0, 0).project(camera);
      slot.label.style.transform =
        `translate(-50%, 0) translate(${((labelPoint.x * 0.5 + 0.5) * width).toFixed(1)}px, ` +
        `${((-labelPoint.y * 0.5 + 0.5) * height).toFixed(1)}px)`;
    }
  }

  function frameCamera() {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const aspect = Math.max(width / height, 0.1);

    const halfWidth = Math.max(0.9, ((state.consoles.length - 1) / 2) * PITCH + 1.15);
    const halfHeight = 0.72;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const distance = Math.max(halfWidth / (tan * aspect), halfHeight / tan);

    const tilt = THREE.MathUtils.degToRad(10);
    basePosition.set(0, LOOK_AT.y + Math.sin(tilt) * distance, Math.cos(tilt) * distance);
    camera.position.copy(basePosition);
    camera.lookAt(LOOK_AT);
  }

  /* ---------- interaction ---------- */

  function consoleIdAt(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);

    const hit = raycaster.intersectObjects([...slots.values()].map((slot) => slot.root), true)[0];
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

  const clock = new THREE.Clock();

  function tick() {
    const seconds = clock.getElapsedTime();

    // The promised "fixed camera with a gentle idle drift": small enough that nothing
    // moves under the pointer, large enough that the stage is not a photograph.
    camera.position.x = basePosition.x + Math.sin(seconds * 0.16) * 0.055;
    camera.position.y = basePosition.y + Math.sin(seconds * 0.23) * 0.018;
    camera.lookAt(LOOK_AT);

    spot.position.x += (spotTargetX - spot.position.x) * 0.12;
    spot.target.position.x = spot.position.x;

    updateLabels();
    renderer.render(scene, camera);
  }

  const resize = () => {
    const parent = canvas.parentElement;
    const width = parent.clientWidth;
    const height = parent.clientHeight;

    if (width === 0 || height === 0) {
      return;
    }

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frameCamera();
  };

  new ResizeObserver(resize).observe(canvas.parentElement);
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

  const context = source.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(126,158,255,0.32)');
  gradient.addColorStop(0.5, 'rgba(90,116,220,0.10)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

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
  console.warn('Aisles: the 3D lineup is unavailable, falling back to the console list', error);
  document.body.classList.add('stage3d-failed');
}
