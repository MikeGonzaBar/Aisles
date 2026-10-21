// Aisles - the hero's case and medium, as the workshop's true-scale objects.
//
// One WebGL surface shows both: the closed case with its cover mapped at the real inlay
// size, and the disc or game card beside it at its real size. They are built from the
// same presets as the shelf (`media.js`), so a chain of proportions cannot drift between
// the two views.
//
// The camera is fixed. The scene renders on selection, resize, and while the medium's slow
// turntable is running; like the workshop's "Spin media", the disc turns in its own plane
// and the cartridge turns on its vertical axis.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  HERO_UNIT,
  presetFor,
  buildCase,
  buildDisc,
  buildCartridge,
  generatedCoverTexture,
  generatedDiscLabelTexture,
  generatedStickerTexture,
  stickerFromImage,
  loadTexture,
  loadImage,
  fitTexture,
  disposeTree,
} from './media.js';

const FOV = 30;
const GAP_MM = 14;
const IDLE_SPIN_SPEED = 0.00042;
const LAUNCH_SPIN_SPEED = 0.009;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let renderer;
let scene;
let camera;
let stage;
let current = null;
let token = 0;
let spin = null;
let spinFrame = 0;
let spinLast = 0;

const canvas = document.createElement('canvas');
canvas.className = 'hero-canvas';
canvas.setAttribute('aria-hidden', 'true');

try {
  start();
} catch (error) {
  console.warn('Aisles: the 3D hero is unavailable', error);
}

function start() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.28;
  pmrem.dispose();

  const key = new THREE.DirectionalLight(0xfff0dc, 2.35);
  key.position.set(-3.2, 5.2, 4.2);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x9ab6ff, 0.82);
  fill.position.set(4.2, 2.1, 3.2);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffd62e, 0.38);
  rim.position.set(0.8, 2.2, -4);
  scene.add(rim);

  camera = new THREE.PerspectiveCamera(FOV, 1, 0.02, 60);

  stage = new THREE.Group();
  scene.add(stage);

  new ResizeObserver(() => resize()).observe(canvas);

  window.aislesHero3d = {
    canvas,
    show,
    clear,
    launch,
    settleLaunch,
    resize: () => resize(true),
    getSpin: () => (spin ? { axis: spin.axis, angle: spin.group.rotation[spin.axis] } : null),
  };

  window.dispatchEvent(new Event('aisles:hero3d'));
}

/** The group's real width, before the slight yaw, in scene units. */
function layoutFor(preset) {
  const [caseWidth, caseHeight, caseDepth] = preset.case.map((value) => value * HERO_UNIT);
  const mediumDisplayScale = preset.medium.kind === 'card' ? 1.42 : 1;
  const mediumWidth =
    preset.medium.kind === 'disc' ? preset.medium.size[0] : preset.medium.size[0];
  const displayedMediumWidth = mediumWidth * HERO_UNIT * mediumDisplayScale;

  return {
    caseWidth,
    caseHeight,
    caseDepth,
    mediumDisplayScale,
    mediumWidth: displayedMediumWidth,
    gap: GAP_MM * HERO_UNIT,
    groupWidth: caseWidth + GAP_MM * HERO_UNIT + displayedMediumWidth,
  };
}

function fit() {
  if (!current || !camera) {
    return;
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (!width || !height) {
    return;
  }

  const yaw = 0.1;
  const projectedWidth = current.groupWidth * Math.cos(yaw) + current.caseDepth * Math.sin(yaw);
  const halfWidth = (projectedWidth / 2) * 0.99;
  const halfHeight = (current.caseHeight / 2) * 1.12;
  const aspect = Math.max(width / height, 0.35);
  const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

  const distance = Math.max(halfHeight / tan, halfWidth / (tan * aspect)) + current.caseDepth * 1.5;
  const centreY = current.caseHeight / 2;

  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  camera.position.set(distance * 0.07, centreY + distance * 0.07, distance);
  camera.lookAt(0, centreY * 0.94, 0);
}

function render() {
  if (!renderer || !scene || !camera || !canvas.clientWidth) {
    return;
  }

  renderer.render(scene, camera);
}

function startSpin() {
  if (!spin || spinFrame || reducedMotion.matches || document.hidden) {
    return;
  }

  spinLast = performance.now();
  spinFrame = requestAnimationFrame(spinStep);
}

function stopSpin() {
  if (spinFrame) {
    cancelAnimationFrame(spinFrame);
  }

  spinFrame = 0;
}

function spinStep(now) {
  if (!spin || document.hidden) {
    spinFrame = 0;
    return;
  }

  const delta = Math.min(now - spinLast, 80);
  spinLast = now;

  spin.elapsed += delta;

  if (!reducedMotion.matches && now >= spin.holdUntil) {
    spin.speed += (spin.targetSpeed - spin.speed) * Math.min(1, delta / 110);
    spin.group.rotation[spin.axis] += delta * spin.speed;
  }

  render();
  spinFrame = requestAnimationFrame(spinStep);
}

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    stopSpin();
    render();
  } else {
    startSpin();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopSpin();
  } else {
    startSpin();
  }
});

function launch() {
  if (!spin) {
    return;
  }

  spin.holdUntil = 0;
  spin.targetSpeed = LAUNCH_SPIN_SPEED;
  startSpin();
}

function settleLaunch() {
  if (!spin) {
    return;
  }

  spin.targetSpeed = IDLE_SPIN_SPEED;
  startSpin();
}

function resize(force = false) {
  if (!renderer) {
    return;
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (!width || !height) {
    return;
  }

  if (!force && canvas.width === Math.round(width * renderer.getPixelRatio()) && canvas.height === Math.round(height * renderer.getPixelRatio())) {
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  fit();
  render();
}

function clear() {
  token += 1;
  stopSpin();
  spin = null;

  if (!stage) {
    return;
  }

  for (const child of [...stage.children]) {
    stage.remove(child);
    disposeTree(child);
  }

  current = null;
  render();
}

function show(console, game) {
  if (!stage) {
    return;
  }

  const started = ++token;
  stopSpin();
  spin = null;

  for (const child of [...stage.children]) {
    stage.remove(child);
    disposeTree(child);
  }

  if (!console || !game) {
    current = null;
    render();
    return;
  }

  const preset = presetFor(console);
  const plan = layoutFor(preset);
  current = plan;

  const body = console.bodyColor ?? '#2E2E34';

  const cover = buildCase(preset, HERO_UNIT, {
    body,
    cover: generatedCoverTexture(preset, console, game, 720),
    detail: true,
  });

  const medium =
    preset.medium.kind === 'disc'
      ? buildDisc(preset, HERO_UNIT, {
          label: generatedDiscLabelTexture(preset, console, game, 1024),
        })
      : buildCartridge(preset, HERO_UNIT, {
          body: preset.mediumBody ?? '#2b2b31',
          face: generatedStickerTexture(preset, console, game, 512),
          detail: true,
          labelAspect: game.mediumLabelRect ? game.mediumLabelRect[2] / game.mediumLabelRect[3] : null,
        });

  medium.group.scale.setScalar(plan.mediumDisplayScale);

  const caseX = -plan.groupWidth / 2 + plan.caseWidth / 2;
  const mediumX = plan.groupWidth / 2 - plan.mediumWidth / 2;
  const centreY = plan.caseHeight / 2;

  cover.group.position.set(caseX, centreY, 0);
  medium.group.position.set(mediumX, centreY, 0.001);

  const plinthWidth = plan.groupWidth * 1.1;
  const plinthDepth = Math.max(plan.caseDepth * 3.5, 0.36);
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(plinthWidth, 0.05, plinthDepth),
    new THREE.MeshStandardMaterial({
      color: 0x182544,
      emissive: 0x120d05,
      emissiveIntensity: 0.45,
      roughness: 0.42,
      metalness: 0.24,
    }),
  );
  plinth.position.set(0, -0.025, 0);

  const plinthEdge = new THREE.Mesh(
    new THREE.BoxGeometry(plinthWidth * 0.96, 0.008, plinthDepth * 0.96),
    new THREE.MeshStandardMaterial({
      color: 0xd7a64d,
      emissive: 0x51320d,
      emissiveIntensity: 0.6,
      roughness: 0.44,
      metalness: 0.3,
    }),
  );
  plinthEdge.position.y = 0.004;
  plinth.add(plinthEdge);

  stage.add(plinth, cover.group, medium.group);
  stage.rotation.y = -0.1;

  // The disc turns like a record and the card makes the workshop's full vertical-axis
  // revolution. The case stays still.
  spin = {
    group: medium.group,
    axis: medium.group.userData.spinAxis ?? (preset.medium.kind === 'disc' ? 'z' : 'y'),
    elapsed: 0,
    holdUntil: 0,
    speed: IDLE_SPIN_SPEED,
    targetSpeed: IDLE_SPIN_SPEED,
  };

  resize(true);
  startSpin();

  if (game.frontCoverUrl) {
    loadTexture(game.frontCoverUrl, 1024)
      .then((texture) => {
        if (started !== token) {
          texture.dispose();
          return;
        }

        fitTexture(texture, preset.inlay[0] / preset.inlay[1]);
        cover.coverMaterial.map?.dispose();
        cover.coverMaterial.map = texture;
        cover.coverMaterial.needsUpdate = true;
        render();
      })
      .catch(() => {
        // The generated case stays; a missing file is still a designed object.
      });
  }

  if (game.mediumLabelUrl) {
    if (preset.medium.kind === 'disc') {
      loadTexture(game.mediumLabelUrl, 1024)
        .then((texture) => {
          if (started !== token) {
            texture.dispose();
            return;
          }

          medium.faceMaterial.map?.dispose();
          medium.faceMaterial.map = texture;
          medium.faceMaterial.needsUpdate = true;
          render();
        })
        .catch(() => {});
    } else {
      loadImage(game.mediumLabelUrl)
        .then((image) => {
          if (started !== token) {
            return;
          }

          const sticker = stickerFromImage(image, game.mediumLabelRect, 512);
          medium.faceMaterial.map?.dispose();
          medium.faceMaterial.map = sticker;
          medium.faceMaterial.needsUpdate = true;
          render();
        })
        .catch(() => {});
    }
  }
}
