// The pixel scene consumes the same snapshot and selection actions as the former 3D scene.
import { presetFor } from './media-presets.js';
window.aislesMediaPresetFor = presetFor;
const lineup = document.getElementById('stage-labels');
const shelf = document.getElementById('shelf-canvas');
const pager = document.getElementById('shelf-pager');
const platforms = ['ps1', 'ps2', 'ps3', 'wii', 'gamecube', 'ds', '3ds', 'xbox360'];
// Sprite positions vary in width on the generated sheet; fixed grid cells clip
// wider consoles or expose a sliver of their neighbours.
const spriteBounds = [[0, 490], [500, 340], [880, 530], [1440, 325], [20, 455], [480, 410], [900, 460], [1430, 335]];
const ROWS_PER_CABINET = 3;
const CASE_GAP = 4;
const DEFAULT_CASES_PER_ROW = 6;
let bay = 1;
let lastPlatform = null;
let lineupSignature = '';
const coverImages = new Map();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const cabinet = document.createElement('div');
cabinet.className = 'pixel-cabinet';
const sign = document.createElement('div');
sign.className = 'pixel-cabinet-sign';
const cases = document.createElement('div');
cases.className = 'pixel-cases';
const rows = Array.from({ length: ROWS_PER_CABINET }, () => {
  const row = document.createElement('div');
  row.className = 'pixel-case-row';
  cases.append(row);
  return row;
});
cabinet.append(sign, cases);
shelf.prepend(cabinet);
let contentSignature = '';
let renderedPlatform = null;
let renderedBay = 1;
let layers = [];
const departures = new Set();
const motion = new Map();

function settleMotion() {
  for (const animation of motion.values()) animation.cancel();
  motion.clear();
  for (const layer of departures) layer.remove();
  departures.clear();
}

function moveLayer(layer, keyframes, duration, departing = false) {
  const animation = layer.animate(keyframes, {
    duration, easing: 'cubic-bezier(.22, 1, .36, 1)',
  });
  motion.set(layer, animation);
  const finish = () => {
    if (motion.get(layer) !== animation) return;
    motion.delete(layer);
    if (departing) { layer.remove(); departures.delete(layer); }
  };
  animation.finished.then(finish, () => {});
}

function updateCase(item, game, selected) {
  item.classList.toggle('return', selected);
  item.setAttribute('aria-label', selected ? `Return ${game.title} to shelf` : game.title);
  if (item.dataset.selected === String(selected)) return;
  item.dataset.selected = String(selected);
  item.replaceChildren();
  if (selected) item.textContent = '← RETURN';
  else {
    const fallback = document.createElement('span');
    fallback.textContent = game.title;
    item.append(fallback);
    if (game.frontCoverUrl) item.append(pixelCover(game.frontCoverUrl));
  }
}

function casesPerRow(aspect) {
  const shelfBounds = shelf.getBoundingClientRect();
  if (!shelfBounds.width || !shelfBounds.height) return DEFAULT_CASES_PER_ROW;

  // These match the pixel cabinet and case-row measurements in stage.css. The
  // case height fills the available clearance above its board; only width can
  // reduce the number that fit in a row.
  const cabinetWidth = shelfBounds.width * 0.68;
  const cabinetHeight = shelfBounds.height * 0.92;
  const rowHeight = cabinetHeight * 0.78 / ROWS_PER_CABINET;
  const caseWidth = rowHeight * 0.74 * aspect;
  const usableWidth = cabinetWidth * 0.88;
  return Math.max(1, Math.floor((usableWidth + CASE_GAP) / (caseWidth + CASE_GAP)));
}

function pixelCover(url) {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 64;
  canvas.setAttribute('aria-hidden', 'true');
  let image = coverImages.get(url);
  if (!image) {
    image = new Image();
    image.src = url;
    coverImages.set(url, image);
  }
  const draw = () => {
    if (image.naturalWidth) canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    else canvas.remove();
  };
  if (image.complete) draw();
  else {
    image.addEventListener('load', draw, { once: true });
    image.addEventListener('error', () => { coverImages.delete(url); canvas.remove(); }, { once: true });
  }
  return canvas;
}

function render() {
  const snapshot = window.aislesSnapshot;
  if (!snapshot) return;
  if (lastPlatform !== snapshot.selectedConsoleId) {
    lastPlatform = snapshot.selectedConsoleId;
    bay = 1;
  }
  const signature = JSON.stringify(snapshot.consoles.map(c => [c.id, c.name, c.shortName, c.games.length, c.gamesPathExists]));
  if (signature !== lineupSignature) {
    lineupSignature = signature;
    lineup.replaceChildren();
    snapshot.consoles.forEach((console) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pixel-console';
    button.dataset.consoleId = console.id;
    button.setAttribute('aria-pressed', String(console.id === snapshot.selectedConsoleId));
    button.setAttribute('aria-label', `${console.name}, ${console.games.length} games${console.gamesPathExists ? '' : ', set folder'}`);
    const sprite = document.createElement('span');
    const index = platforms.indexOf(console.id);
    sprite.className = 'pixel-console-sprite';
    if (index >= 0) {
      const [left, width] = spriteBounds[index];
      sprite.style.backgroundSize = `${1774 / width * 100}% 200%`;
      sprite.style.backgroundPosition = `${left / (1774 - width) * 100}% ${Math.floor(index / 4) * 100}%`;
      if (console.id === 'wii') sprite.style.clipPath = 'inset(0 0 5% 0)';
    } else {
      sprite.classList.add('generic');
      sprite.textContent = console.shortName;
    }
    const label = document.createElement('span');
    const name = document.createElement('span');
    name.textContent = console.shortName;
    const count = document.createElement('span');
    count.textContent = console.gamesPathExists ? `${console.games.length} games` : 'SET FOLDER';
    label.append(name, count);
    button.append(sprite, label);
    button.addEventListener('click', () => {
      if (console.gamesPathExists) window.aislesSelectConsole(console.id);
      else window.aislesOpenSettings(console.id);
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('aisles:consoleContext', { detail: { consoleId: console.id, x: event.clientX, y: event.clientY } }));
    });
    lineup.append(button);
    });
  }
  for (const button of lineup.children) {
    button.setAttribute('aria-pressed', String(button.dataset.consoleId === snapshot.selectedConsoleId));
  }

  const games = snapshot.games ?? [];
  const [caseWidth, caseHeight] = presetFor(snapshot.platform).case;
  const casesAcross = casesPerRow(caseWidth / caseHeight);
  const perBay = casesAcross * ROWS_PER_CABINET;
  const bays = Math.max(1, Math.ceil(games.length / perBay));
  bay = Math.min(bay, bays);
  const visibleGames = games.slice((bay - 1) * perBay, bay * perBay);
  const visibleCasesAcross = Math.min(casesAcross, Math.ceil(visibleGames.length / ROWS_PER_CABINET));
  const nextSignature = JSON.stringify([snapshot.selectedConsoleId, bay, casesAcross,
    visibleGames.map(game => [game.id, game.title, game.frontCoverUrl])]);
  if (nextSignature === contentSignature) {
    for (const layer of layers) for (const item of layer.children) {
      const game = visibleGames.find(game => game.id === item.dataset.gameId);
      if (game) updateCase(item, game, game.id === snapshot.selectedGameId);
    }
    announce();
    return;
  }

  const consoleChanged = renderedPlatform !== snapshot.selectedConsoleId;
  const direction = consoleChanged
    ? Math.sign(snapshot.consoles.findIndex(c => c.id === snapshot.selectedConsoleId)
      - snapshot.consoles.findIndex(c => c.id === renderedPlatform)) || 1
    : Math.sign(bay - renderedBay) || 1;
  const animate = !!contentSignature && !reducedMotion.matches
    && shelf.getBoundingClientRect().height > 0;
  // Sample interrupted incoming layers before cancellation, then discard older
  // departures. At most one incoming and one outgoing layer survive per row.
  const outgoing = layers.map(layer => ({ layer,
    transform: getComputedStyle(layer).transform, opacity: getComputedStyle(layer).opacity }));
  settleMotion();
  const distance = direction * (consoleChanged ? 24 : 48);
  for (const { layer, transform, opacity } of outgoing) {
    if (!animate) { layer.remove(); continue; }
    layer.inert = true;
    layer.setAttribute('aria-hidden', 'true');
    departures.add(layer);
    moveLayer(layer, [{ transform, opacity },
      { transform: `translateX(${-distance}px)`, opacity: 0 }], 160, true);
  }
  layers = rows.map(row => {
    const layer = document.createElement('div');
    layer.className = 'pixel-case-items';
    layer.style.setProperty('--case-columns', String(Math.max(1, visibleCasesAcross)));
    row.append(layer);
    return layer;
  });
  sign.textContent = snapshot.platform?.name ?? 'AISLES';
  if (animate && consoleChanged) moveLayer(sign, [{ opacity: .3 }, { opacity: 1 }], 220);
  visibleGames.forEach((game, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.tabIndex = -1;
    item.className = 'pixel-case';
    item.style.aspectRatio = `${caseWidth} / ${caseHeight}`;
    item.style.setProperty('--case-aspect', caseWidth / caseHeight);
    item.title = game.title;
    item.dataset.gameId = game.id;
    updateCase(item, game, game.id === snapshot.selectedGameId);
    item.addEventListener('click', () => {
      if (window.aislesSnapshot.selectedGameId === game.id) window.aislesClearGameSelection();
      else window.aislesSelectGame(game.id);
    });
    item.addEventListener('dblclick', () => window.aislesLaunchGame(game.id));
    layers[Math.floor(index / visibleCasesAcross)].append(item);
  });
  if (animate) for (const layer of layers) moveLayer(layer,
    [{ transform: `translateX(${distance}px)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], 240);
  contentSignature = nextSignature;
  renderedPlatform = snapshot.selectedConsoleId;
  renderedBay = bay;
  announce();

  function announce() {
    window.dispatchEvent(new CustomEvent('aisles:shelf', { detail: { bay, bays, games: games.length, perBay } }));
  }
}

pager.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-page]');
  if (!button || button.disabled) return;
  bay += Number(button.dataset.page);
  render();
});
window.addEventListener('aisles:update', render);
let resizeFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    settleMotion();
    render();
  });
}).observe(shelf);
reducedMotion.addEventListener('change', settleMotion);
window.dispatchEvent(new Event('aisles:media-presets-ready'));
render();
