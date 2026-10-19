// Aisles - Phase 0 stage.
//
// Deliberately a plain 2D surface: it exists to prove the host <-> web bridge and
// to give Phase 2 a launcher that works before any 3D is involved. The 3D shelf
// and console lineup replace this view in Phases 3-4.

const webview = window.chrome?.webview;

const elements = {
  badge: document.getElementById('bridge-badge'),
  consoleList: document.getElementById('console-list'),
  gameList: document.getElementById('game-list'),
  gamesHeading: document.getElementById('games-heading'),
  hero: document.getElementById('hero'),
  shelfPager: document.getElementById('shelf-pager'),
  shelfLabel: document.getElementById('shelf-label'),
  shelfHint: document.getElementById('shelf-hint'),
  status: document.getElementById('status'),
  totals: document.getElementById('totals'),
  settingsTrigger: document.getElementById('settings-trigger'),
  settingsBackdrop: document.getElementById('settings-backdrop'),
  settingsDialog: document.getElementById('settings-dialog'),
  settingsClose: document.getElementById('settings-close'),
  settingsCancel: document.getElementById('settings-cancel'),
  settingsSave: document.getElementById('settings-save'),
  settingsConsoles: document.getElementById('settings-consoles'),
  settingsFields: document.getElementById('settings-fields'),
  settingsConsoleName: document.getElementById('settings-console-name'),
  settingsConsoleBadge: document.getElementById('settings-console-badge'),
  settingsConsoleMeta: document.getElementById('settings-console-meta'),
  settingsError: document.getElementById('settings-error'),
  settingsProgress: document.getElementById('settings-progress'),
};

const state = {
  library: null,
  selectedConsoleId: null,
  selectedGameId: null,
};

const settings = {
  open: false,
  consoles: [],
  draft: {},
  original: '',
  selectedId: null,
  busy: false,
  savedAwaitingScan: false,
  request: 0,
  validationTimer: 0,
};

function post(type, payload) {
  webview?.postMessage({ type, payload });
}

function setStatus(text, kind = '') {
  elements.status.textContent = text;
  elements.status.className = kind;
}

function setBadge(text, stateName) {
  elements.badge.textContent = text;
  elements.badge.dataset.state = stateName;
}

/* ---------- settings ---------- */

const SETTINGS_FIELDS = [
  { key: 'gamesPath', label: 'Games folder', browse: 'Browse folder' },
  { key: 'emulatorPath', label: 'Emulator executable', browse: 'Browse file' },
  { key: 'artworkPath', label: 'Artwork folder (optional)', browse: 'Browse folder' },
];

function requestId(prefix) {
  settings.request += 1;
  return `${prefix}-${settings.request}`;
}

function settingsSnapshot() {
  return JSON.stringify(settings.draft);
}

function settingsDirty() {
  return settings.original !== settingsSnapshot();
}

function setSettingsError(message = '') {
  elements.settingsError.hidden = !message;
  elements.settingsError.textContent = message;
}

function setSettingsBusy(busy, text = '') {
  settings.busy = busy;
  elements.settingsSave.disabled = busy;
  elements.settingsCancel.disabled = busy;
  elements.settingsClose.disabled = busy;
  elements.settingsProgress.textContent = text;
  for (const control of elements.settingsDialog.querySelectorAll('input, .browse-button, .settings-console-button')) {
    control.disabled = busy;
  }
}

function openSettings() {
  settings.open = true;
  settings.savedAwaitingScan = false;
  elements.settingsBackdrop.hidden = false;
  elements.settingsSave.textContent = 'Save & rescan';
  setSettingsBusy(true, 'Loading settings…');
  setSettingsError();
  post('getSettings', { requestId: requestId('load') });
}

function closeSettings(force = false) {
  if (settings.busy) return;
  if (!force && settingsDirty() && !window.confirm('Discard your unsaved settings changes?')) return;
  settings.open = false;
  elements.settingsBackdrop.hidden = true;
  elements.settingsTrigger.focus();
}

function renderSettingsNavigation() {
  elements.settingsConsoles.replaceChildren();
  for (const console of settings.consoles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-console-button';
    button.textContent = console.name;
    button.setAttribute('aria-selected', String(console.id === settings.selectedId));
    button.addEventListener('click', () => {
      settings.selectedId = console.id;
      renderSettingsNavigation();
      renderSettingsEditor();
    });
    elements.settingsConsoles.append(button);
  }
}

function renderSettingsEditor() {
  const console = settings.consoles.find(item => item.id === settings.selectedId);
  if (!console) return;
  elements.settingsConsoleName.textContent = console.name;
  elements.settingsConsoleBadge.textContent = console.shortName;
  elements.settingsConsoleMeta.textContent = [console.manufacturer, console.year].filter(Boolean).join(' · ');

  elements.settingsFields.replaceChildren();
  for (const field of SETTINGS_FIELDS) {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-field';
    const label = document.createElement('label');
    const inputId = `settings-${console.id}-${field.key}`;
    label.htmlFor = inputId;
    label.textContent = field.label;
    const row = document.createElement('div');
    row.className = 'path-row';
    const input = document.createElement('input');
    input.id = inputId;
    input.type = 'text';
    input.spellcheck = false;
    input.value = settings.draft[console.id][field.key];
    input.addEventListener('input', () => {
      settings.draft[console.id][field.key] = input.value;
      scheduleSettingsValidation();
    });
    const browse = document.createElement('button');
    browse.type = 'button';
    browse.className = 'browse-button';
    browse.textContent = field.browse;
    browse.addEventListener('click', () => {
      settings.pendingBrowse = { consoleId: console.id, field: field.key };
      setSettingsBusy(true, 'Waiting for Windows…');
      post('browsePath', { requestId: requestId('browse'), consoleId: console.id, field: field.key });
    });
    const status = document.createElement('p');
    status.className = 'field-status';
    status.dataset.field = field.key;
    applyFieldStatus(status, console.validation?.[field.key]);
    row.append(input, browse);
    wrapper.append(label, row, status);
    elements.settingsFields.append(wrapper);
  }
}

function applyFieldStatus(element, validation) {
  const stateName = validation?.state ?? 'notConfigured';
  const labels = { found: 'Found', notFound: 'Not found — you can still save this path', notConfigured: 'Not configured', invalid: validation?.error ?? 'Invalid path' };
  element.dataset.state = stateName;
  element.textContent = labels[stateName];
}

function scheduleSettingsValidation() {
  clearTimeout(settings.validationTimer);
  settings.validationTimer = setTimeout(() => {
    post('validateSettings', { requestId: requestId('validate'), consoles: settings.draft });
  }, 180);
}

function applySettingsValidation(payload) {
  if (payload.error) { setSettingsError(payload.error); return; }
  for (const console of settings.consoles) console.validation = payload.consoles?.[console.id] ?? console.validation;
  if (settings.selectedId) {
    const current = settings.consoles.find(c => c.id === settings.selectedId);
    for (const status of elements.settingsFields.querySelectorAll('.field-status')) {
      applyFieldStatus(status, current?.validation?.[status.dataset.field]);
    }
  }
  const invalid = settings.consoles.some(c => Object.values(c.validation ?? {}).some(v => v.state === 'invalid'));
  elements.settingsSave.disabled = settings.busy || invalid;
}

function saveSettings() {
  setSettingsError();
  if (settings.savedAwaitingScan) {
    setSettingsBusy(true, 'Scanning library…');
    post('rescan', { requestId: requestId('rescan') });
    return;
  }
  setSettingsBusy(true, 'Saving settings…');
  post('saveSettings', { requestId: requestId('save'), consoles: settings.draft });
}

elements.settingsTrigger.addEventListener('click', openSettings);
elements.settingsClose.addEventListener('click', () => closeSettings());
elements.settingsCancel.addEventListener('click', () => closeSettings());
elements.settingsSave.addEventListener('click', saveSettings);
elements.settingsBackdrop.addEventListener('mousedown', event => {
  if (event.target === elements.settingsBackdrop) closeSettings();
});

elements.settingsDialog.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const focusable = [...elements.settingsDialog.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

/* ---------- rendering ---------- */

function renderConsoles() {
  const consoles = state.library?.consoles ?? [];
  elements.consoleList.replaceChildren();

  for (const console of consoles) {
    const item = document.createElement('li');
    item.className = 'console';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(console.id === state.selectedConsoleId));

    const short = document.createElement('span');
    short.className = 'short';
    short.textContent = console.shortName;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = console.name;

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(console.games.length);

    item.append(short, name, count);

    if (!console.gamesPathExists) {
      item.classList.add('is-empty');
      const flag = document.createElement('span');
      flag.className = 'flag';
      flag.textContent = 'games folder missing';
      item.append(flag);
    } else if (!console.emulatorExists) {
      const flag = document.createElement('span');
      flag.className = 'flag';
      flag.textContent = 'emulator missing';
      item.append(flag);
    } else if (console.games.length === 0) {
      item.classList.add('is-empty');
      const flag = document.createElement('span');
      flag.className = 'flag';
      flag.textContent = 'no games found';
      item.append(flag);
    }

    item.addEventListener('click', () => selectConsole(console.id));
    elements.consoleList.append(item);
  }

  const totalGames = consoles.reduce((sum, console) => sum + console.games.length, 0);
  elements.totals.textContent = `${consoles.length} consoles · ${totalGames} games`;

  publishSnapshot();
}

function renderGames() {
  const console = currentConsole();
  elements.gameList.replaceChildren();

  if (!console) {
    elements.gamesHeading.textContent = 'Games';
    elements.gameList.append(emptyState('Select a console.'));
    return;
  }

  elements.gamesHeading.textContent = `Games · ${console.name}`;

  if (!console.gamesPathExists) {
    elements.gameList.append(
      emptyState(
        `No games folder at ${console.gamesPath}. Open Settings to choose the correct folder.`,
      ),
    );
    return;
  }

  if (console.games.length === 0) {
    elements.gameList.append(emptyState(`No games found in ${console.gamesPath}.`));
    return;
  }

  for (const game of console.games) {
    const item = document.createElement('li');
    item.className = 'game';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(game.id === state.selectedGameId));

    const text = document.createElement('span');
    text.className = 'text';

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = game.title;

    const meta = document.createElement('span');
    meta.className = 'meta';

    if (game.serial) {
      const serial = document.createElement('span');
      serial.className = 'serial';
      serial.textContent = game.serial;
      meta.append(serial);
    }

    // Titles are derived rather than catalogued, so the row says where each came from.
    if (game.titleSource) {
      const source = document.createElement('span');
      source.className = 'source';
      source.textContent = game.titleSource;
      source.title = `title resolved from ${game.titleSource}`;
      meta.append(source);
    }

    // Loose artwork matches are labelled; an exact serial or title match is not
    // dressed up as anything more than "cover" (PLAN.md section 3.3.1).
    if (game.frontCoverUrl) {
      const cover = document.createElement('span');
      cover.className = 'cover';
      cover.textContent =
        game.frontCoverMatch === 'serial' || game.frontCoverMatch === 'title'
          ? 'cover'
          : `cover: ${game.frontCoverMatch}`;
      cover.title = `${game.frontCoverSource}, matched by ${game.frontCoverMatch}`;
      meta.append(cover);
    }

    const path = document.createElement('span');
    path.className = 'path';
    path.textContent = game.launchTarget;
    path.title = game.launchTarget;
    meta.append(path);

    text.append(title, meta);

    const launch = document.createElement('button');
    launch.className = 'launch';
    launch.type = 'button';
    launch.textContent = 'LAUNCH';
    launch.addEventListener('click', (event) => {
      event.stopPropagation();
      launchGame(game.id);
    });

    item.append(artwork(game), text, launch);

    item.addEventListener('click', () => selectGame(game.id));
    item.addEventListener('dblclick', () => launchGame(game.id));

    elements.gameList.append(item);
  }
}

function artwork(game) {
  const tile = document.createElement('span');
  tile.className = 'art';

  // The generated tile always exists underneath. A missing host mapping or an
  // unreadable file therefore degrades to a typographic case, not a broken image.
  const fallback = document.createElement('span');
  fallback.className = 'art-fallback';
  fallback.textContent = initialsFor(game.title);
  tile.append(fallback);

  if (game.frontCoverUrl) {
    const image = document.createElement('img');
    image.src = game.frontCoverUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => image.remove());
    tile.append(image);
  }

  return tile;
}

function initialsFor(title) {
  return String(title || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

function emptyState(text) {
  const element = document.createElement('li');
  element.className = 'empty';
  element.textContent = text;
  return element;
}

/* ---------- state ---------- */

function publishSnapshot() {
  // The 3D layer is a module, so it cannot read this file's top-level bindings.
  // A snapshot plus an event is the whole contract between them.
  const console = currentConsole();

  window.aislesSnapshot = {
    consoles: state.library?.consoles ?? [],
    selectedConsoleId: state.selectedConsoleId,
    platform: console,
    games: console?.games ?? [],
    selectedGameId: state.selectedGameId,
  };

  window.dispatchEvent(new CustomEvent('aisles:update'));
}

function currentConsole() {
  return state.library?.consoles.find((console) => console.id === state.selectedConsoleId) ?? null;
}

function selectConsole(consoleId) {
  state.selectedConsoleId = consoleId;
  state.selectedGameId = null;
  post('selectConsole', { consoleId });
  renderConsoles();
  renderGames();
  renderHero();
}

// The 3D lineup clicks back into the same selection path as the list.
window.aislesSelectConsole = selectConsole;

function selectGame(gameId) {
  state.selectedGameId = gameId;
  post('selectGame', { gameId });
  renderGames();
  renderHero();
  publishSnapshot();
}

function launchGame(gameId) {
  const game = currentConsole()?.games.find((entry) => entry.id === gameId);
  if (!game) {
    return;
  }

  state.selectedGameId = gameId;
  renderGames();
  renderHero();
  publishSnapshot();
  setStatus(`Launching ${game.title}…`);
  post('launchGame', { gameId });
}

// The shelf clicks and double-clicks back into these same paths.
window.aislesSelectGame = selectGame;
window.aislesLaunchGame = launchGame;

/* ---------- hero ---------- */

/* ---------- the hero's medium ----------
 * The disc or cartridge beside the selected case. Drawn as SVG rather than a second WebGL
 * context: a medium is a printed object, and a printed object is exactly what SVG is for -
 * it scales to the column, costs no texture memory and needs no per-frame work.
 *
 * Shapes are the real ones (a 12 cm disc, a DS card that is 33 x 35 mm, a 3DS card that is
 * 35 x 33), and the label is always generated. A cover is not a disc label (PLAN.md
 * section 3.3), and there is no local disc art yet, so nothing is borrowed from the box.
 */

/** Card footprints, width over height, keyed by the platform they belong to. */
const CARD_SHAPES = {
  ds: [200, 212],
  '3ds': [212, 200],
};

/** What the medium is called, keyed by the `media` value in consoles.json. */
const MEDIUM_NAMES = {
  JewelCase: 'CD-ROM',
  DvdCase: 'DVD-ROM',
  BluRayCase: 'Blu-ray',
  MiniDiscCase: 'miniDVD',
  CartridgeCase: 'Game card',
};

/** The hero case's front, width over height, per packaging. The shelf uses the same. */
const CASE_ASPECTS = {
  JewelCase: 0.9375,
  DvdCase: 0.714,
  BluRayCase: 0.7125,
  MiniDiscCase: 0.933,
  CartridgeCase: 0.72,
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode(tag, attributes, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes ?? {})) {
    node.setAttribute(key, String(value));
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function hexToRgb(hex) {
  const digits = String(hex ?? '').replace('#', '').trim();
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const value = Number.parseInt(full, 16);
  return full.length === 6 && Number.isFinite(value)
    ? { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
    : { r: 27, g: 27, b: 31 };
}

/** `amount` runs -1 (black) to 1 (white); 0 leaves the colour alone. */
function shade({ r, g, b }, amount) {
  const channel = (value) =>
    Math.round(amount >= 0 ? value + (255 - value) * amount : value * (1 + amount));
  return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
}

/** The ink that stays readable on a field: cream on dark, near-black on light. */
function inkFor({ r, g, b }) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#141824' : '#f4efe4';
}

/** Words wrapped to fit a label, and an ellipsis rather than a fourth line. */
function labelLines(title, maxChars, maxLines) {
  const words = String(title ?? '')
    .replace(/[®™©]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) {
    return ['Untitled'];
  }

  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(1, maxChars - 1))}…`;
  return kept;
}

function labelText(lines, ink, y, lineHeight, size) {
  const group = svgNode('g', {});

  lines.forEach((line, index) => {
    group.append(
      svgNode(
        'text',
        {
          x: 100,
          y: y + index * lineHeight,
          'text-anchor': 'middle',
          'font-family': '"Segoe UI", sans-serif',
          'font-size': size,
          'font-weight': 700,
          fill: ink,
        },
        line,
      ),
    );
  });

  return group;
}

/**
 * A disc: 120 mm of polycarbonate, printed from the hub out to the edge, with the clear
 * clamping ring and the 15 mm hole that make it read as a disc and not as a coin.
 */
function discMedium(console, game) {
  const body = hexToRgb(console.bodyColor);
  const accent = hexToRgb(console.accentColor);
  const ink = inkFor(accent);

  const svg = svgNode('svg', { viewBox: '0 0 200 200', 'aria-hidden': 'true', focusable: 'false' });
  const defs = svgNode('defs');

  const plastic = svgNode('radialGradient', { id: 'disc-plastic', cx: '38%', cy: '30%', r: '78%' });
  plastic.append(svgNode('stop', { offset: '0', 'stop-color': shade(body, 0.42) }));
  plastic.append(svgNode('stop', { offset: '0.55', 'stop-color': shade(body, 0.04) }));
  plastic.append(svgNode('stop', { offset: '1', 'stop-color': shade(body, -0.42) }));

  const print = svgNode('linearGradient', { id: 'disc-print', x1: '0', y1: '0', x2: '0.35', y2: '1' });
  print.append(svgNode('stop', { offset: '0', 'stop-color': shade(accent, 0.16) }));
  print.append(svgNode('stop', { offset: '0.62', 'stop-color': shade(accent, -0.04) }));
  print.append(svgNode('stop', { offset: '1', 'stop-color': shade(accent, -0.26) }));

  const sheen = svgNode('linearGradient', { id: 'disc-sheen', x1: '0', y1: '0', x2: '0', y2: '1' });
  sheen.append(svgNode('stop', { offset: '0', 'stop-color': '#ffffff', 'stop-opacity': '0.34' }));
  sheen.append(svgNode('stop', { offset: '1', 'stop-color': '#ffffff', 'stop-opacity': '0' }));

  defs.append(plastic, print, sheen);

  svg.append(defs);
  svg.append(svgNode('circle', { cx: 100, cy: 100, r: 100, fill: 'url(#disc-plastic)' }));
  svg.append(svgNode('circle', { cx: 100, cy: 100, r: 97, fill: 'url(#disc-print)' }));
  // The label stops at the clamping ring, so the print is an annulus, not a full face.
  svg.append(svgNode('circle', { cx: 100, cy: 100, r: 40, fill: 'url(#disc-plastic)' }));
  svg.append(
    svgNode('circle', {
      cx: 100,
      cy: 100,
      r: 39,
      fill: 'none',
      stroke: '#ffce00',
      'stroke-opacity': '0.55',
      'stroke-width': 1.6,
    }),
  );
  svg.append(
    svgNode('circle', {
      cx: 100,
      cy: 100,
      r: 22,
      fill: 'none',
      stroke: '#ffffff',
      'stroke-opacity': '0.3',
      'stroke-width': 1.4,
    }),
  );
  svg.append(svgNode('circle', { cx: 100, cy: 100, r: 8, fill: '#0a0f1f' }));
  svg.append(
    svgNode('ellipse', {
      cx: 60,
      cy: 48,
      rx: 56,
      ry: 30,
      fill: 'url(#disc-sheen)',
      transform: 'rotate(-34 60 48)',
    }),
  );
  svg.append(
    svgNode('circle', {
      cx: 100,
      cy: 100,
      r: 99,
      fill: 'none',
      stroke: '#ffffff',
      'stroke-opacity': '0.16',
      'stroke-width': 1.6,
    }),
  );

  // The print zone is the annulus above the clamping ring: no type on the hub, the way
  // a real disc is printed.
  const lines = labelLines(game.title, 17, 3);
  const startY = 40 - ((lines.length - 1) * 18) / 2;
  const printed = labelText(lines, ink, startY, 18, 15);

  if (game.serial) {
    printed.append(
      svgNode(
        'text',
        {
          x: 100,
          y: 162,
          'text-anchor': 'middle',
          'font-family': '"Cascadia Mono", Consolas, monospace',
          'font-size': 9,
          'letter-spacing': 0.6,
          fill: ink,
          'fill-opacity': 0.62,
        },
        game.serial,
      ),
    );
  }

  svg.append(printed);

  return svg;
}

/**
 * A game card: the platform's own footprint, a recessed label panel, and the grip ridge
 * that keeps it from being a rectangle.
 */
function cartridgeMedium(console, game) {
  const body = hexToRgb(console.bodyColor);
  const accent = hexToRgb(console.accentColor);
  const ink = inkFor(accent);
  const bodyInk = inkFor(body);
  const [width, height] = CARD_SHAPES[console.id] ?? [200, 212];

  const svg = svgNode('svg', {
    viewBox: `0 0 ${width} ${height}`,
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const defs = svgNode('defs');

  const shell = svgNode('linearGradient', { id: 'card-shell', x1: '0', y1: '0', x2: '0.3', y2: '1' });
  shell.append(svgNode('stop', { offset: '0', 'stop-color': shade(body, 0.24) }));
  shell.append(svgNode('stop', { offset: '0.5', 'stop-color': shade(body, -0.04) }));
  shell.append(svgNode('stop', { offset: '1', 'stop-color': shade(body, -0.34) }));

  const label = svgNode('linearGradient', { id: 'card-label', x1: '0', y1: '0', x2: '0.4', y2: '1' });
  label.append(svgNode('stop', { offset: '0', 'stop-color': shade(accent, 0.14) }));
  label.append(svgNode('stop', { offset: '1', 'stop-color': shade(accent, -0.22) }));

  defs.append(shell, label);
  svg.append(defs);

  const inset = 4;
  svg.append(
    svgNode('rect', {
      x: inset,
      y: inset,
      width: width - inset * 2,
      height: height - inset * 2,
      rx: 9,
      fill: 'url(#card-shell)',
      stroke: '#000000',
      'stroke-opacity': '0.4',
      'stroke-width': 1,
    }),
  );

  // Grip ridges top and bottom: the card is held by its edges, and it shows.
  for (const y of [inset + 9, height - inset - 15]) {
    svg.append(
      svgNode('rect', {
        x: width / 2 - 26,
        y,
        width: 52,
        height: 6,
        rx: 3,
        fill: '#000000',
        'fill-opacity': '0.16',
      }),
    );
  }

  // A DS/3DS label is a sticker on the shell, not a full face: the body has to show on
  // every side, and the recess is smaller than the card.
  const panel = {
    x: (width - 140) / 2,
    y: (height - 104) / 2 - 4,
    width: 140,
    height: 104,
  };
  svg.append(
    svgNode('rect', {
      ...panel,
      rx: 6,
      fill: 'url(#card-label)',
      stroke: '#000000',
      'stroke-opacity': '0.28',
    }),
  );
  svg.append(
    svgNode('rect', {
      x: panel.x + 6,
      y: panel.y + 6,
      width: panel.width - 12,
      height: panel.height - 12,
      rx: 4,
      fill: 'none',
      stroke: '#ffce00',
      'stroke-opacity': '0.5',
      'stroke-width': 1.5,
    }),
  );

  const lines = labelLines(game.title, 18, 3);
  const centreX = panel.x + panel.width / 2;
  const baseY = panel.y + panel.height / 2 - ((lines.length - 1) * 20) / 2;

  const text = svgNode('g', {});
  lines.forEach((line, index) => {
    text.append(
      svgNode(
        'text',
        {
          x: centreX,
          y: baseY + index * 20 + 6,
          'text-anchor': 'middle',
          'font-family': '"Segoe UI", sans-serif',
          'font-size': 17,
          'font-weight': 700,
          fill: ink,
        },
        line,
      ),
    );
  });
  svg.append(text);

  if (game.serial) {
    svg.append(
      svgNode(
        'text',
        {
          x: width / 2,
          y: height - 26,
          'text-anchor': 'middle',
          'font-family': '"Cascadia Mono", Consolas, monospace',
          'font-size': 10,
          'letter-spacing': 0.6,
          fill: bodyInk,
          'fill-opacity': 0.6,
        },
        game.serial,
      ),
    );
  }

  return svg;
}

/**
 * The medium element. `data-shape` carries the kind for CSS and for the tests, and the
 * caption names what the object is, the way a shelf label would.
 */
function mediumFor(console, game) {
  const cartridge = console.media === 'CartridgeCase';
  const figure = document.createElement('figure');
  figure.className = 'hero-medium';
  figure.dataset.shape = cartridge ? 'cartridge' : 'disc';

  figure.append(cartridge ? cartridgeMedium(console, game) : discMedium(console, game));

  const caption = document.createElement('figcaption');
  caption.textContent = MEDIUM_NAMES[console.media] ?? 'Media';
  figure.append(caption);

  return figure;
}

function renderHero() {
  if (!elements.hero) {
    return;
  }

  const console = currentConsole();
  const game = console?.games.find((entry) => entry.id === state.selectedGameId) ?? null;
  elements.hero.replaceChildren();

  if (!game) {
    const art = document.createElement('div');
    art.className = 'hero-art';
    art.dataset.state = 'empty';
    art.textContent = console ? 'Pick a case' : 'Pick a console';

    const title = document.createElement('div');
    title.className = 'hero-title';
    title.textContent = console ? console.name : 'Aisles';

    const meta = document.createElement('div');
    meta.className = 'hero-meta';
    meta.textContent = console
      ? `${console.games.length} games on this shelf`
      : 'Walk the aisles of your collection.';

    const launch = document.createElement('button');
    launch.className = 'launch';
    launch.type = 'button';
    launch.textContent = 'LAUNCH';
    launch.disabled = true;

    elements.hero.append(art, title, meta, launch);
    return;
  }

  const art = document.createElement('div');
  art.className = 'hero-art';
  art.dataset.layout = 'medium';
  art.style.setProperty('--case-aspect', String(CASE_ASPECTS[console?.media] ?? 0.704));

  const fallback = document.createElement('div');
  fallback.className = 'hero-fallback';
  fallback.style.setProperty('--accent', console?.accentColor ?? '#0b4ea2');

  // The hero's copy of the generated rung: the same accent bands and title the shelf
  // draws, so a game with no cover is still a designed case at this size, not a hole.
  const fallbackTitle = document.createElement('span');
  fallbackTitle.className = 'hero-fallback-title';
  fallbackTitle.textContent = game.title;
  fallback.append(fallbackTitle);
  art.append(fallback);

  if (game.frontCoverUrl) {
    const image = document.createElement('img');
    image.src = game.frontCoverUrl;
    image.alt = '';
    image.addEventListener('error', () => image.remove());
    art.append(image);
  }

  const title = document.createElement('div');
  title.className = 'hero-title';
  title.textContent = game.title;

  const meta = document.createElement('div');
  meta.className = 'hero-meta';

  const platform = document.createElement('span');
  platform.textContent = console ? `${console.name} · ${console.year}` : '';
  meta.append(platform);

  if (game.serial) {
    const serial = document.createElement('span');
    serial.className = 'serial';
    serial.textContent = game.serial;
    meta.append(serial);
  }

  const launch = document.createElement('button');
  launch.className = 'launch';
  launch.type = 'button';
  launch.textContent = 'LAUNCH';
  launch.addEventListener('click', () => launchGame(game.id));

  // The case and its medium sit side by side, the way the blockout has them: the box
  // carries the art, the medium carries the platform's real shape.
  const row = document.createElement('div');
  row.className = 'hero-row';
  row.append(art, console ? mediumFor(console, game) : document.createElement('span'));

  elements.hero.append(row, title, meta, launch);
}

/* ---------- pager ---------- */

function renderPager(detail) {
  if (!elements.shelfLabel || !elements.shelfPager) {
    return;
  }

  const shelves = detail?.bays ?? 1;
  const bay = detail?.bay ?? 1;
  const games = detail?.games ?? 0;
  const perBay = detail?.perBay ?? 18;

  elements.shelfLabel.textContent =
    shelves > 1 ? `Shelf ${bay} of ${shelves} · ${games} games` : `Shelf 1 of 1 · ${games} games`;

  for (const button of elements.shelfPager.querySelectorAll('button[data-page]')) {
    const step = Number(button.dataset.page);
    button.disabled = step < 0 ? bay <= 1 : bay >= shelves;
  }

  if (elements.shelfHint) {
    const remaining = games - bay * perBay;
    elements.shelfHint.textContent =
      shelves === 1
        ? games === 0
          ? 'This shelf is empty. Open Settings to choose a games folder.'
          : 'Plays like a shelf: a case lifts out when you pick it. Double-click or LAUNCH to play.'
        : remaining > 0
          ? `${Math.max(0, remaining)} more games open Shelf ${bay + 1}. The bay slides and the consoles stay put.`
          : 'Wheel, drag or the arrow keys page the shelf. The consoles stay put.';
  }
}

window.addEventListener('aisles:shelf', (event) => renderPager(event.detail));

/* ---------- window mode ----------
 * The stage opens maximized with its standard title bar. F11 can still opt into full
 * screen, and Escape returns from full screen to the maximized window.
 */

let fullScreen = false;

function setFullScreen(next) {
  fullScreen = next;
  post('windowMode', { fullScreen });
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && settings.open) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeSettings();
  } else if (event.key === 'Escape' && fullScreen) {
    event.preventDefault();
    setFullScreen(false);
  } else if (event.key === 'F11') {
    event.preventDefault();
    setFullScreen(!fullScreen);
  }
});

/* ---------- host messages ---------- */

function onLibrary(payload) {
  state.library = payload;

  const consoles = payload.consoles ?? [];

  if (payload.error) {
    setBadge('bridge: catalog error', 'error');
    setStatus(payload.error, 'err');
  } else {
    setBadge('bridge OK', 'ok');
    const games = consoles.reduce((sum, console) => sum + console.games.length, 0);
    const covers = consoles.reduce(
      (sum, console) => sum + console.games.filter((game) => game.frontCoverUrl).length,
      0,
    );
    setStatus(`Library loaded · ${games} games · ${covers} local covers`);
  }


  // Keep the current console if it still exists, otherwise start on the first
  // console that actually has games.
  const stillValid = consoles.some((console) => console.id === state.selectedConsoleId);
  if (!stillValid) {
    const firstPopulated = consoles.find((console) => console.games.length > 0) ?? consoles[0];
    state.selectedConsoleId = firstPopulated?.id ?? null;
  }
  const selectedGameStillExists = consoles.some(console =>
    console.games.some(game => game.id === state.selectedGameId),
  );
  if (!selectedGameStillExists) state.selectedGameId = null;

  renderConsoles();
  renderGames();
  renderHero();
}

function onLaunchResult(payload) {
  setStatus(payload.message, payload.started ? 'ok' : 'err');
}

if (webview) {
  webview.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') {
      return;
    }

    switch (message.type) {
      case 'library':
        onLibrary(message.payload);
        break;
      case 'launchResult':
        onLaunchResult(message.payload);
        break;
      case 'settingsData': {
        const payload = message.payload;
        if (!settings.open) break;
        if (!payload.consoles) {
          setSettingsBusy(false);
          setSettingsError(payload.error || 'Settings could not be loaded.');
          break;
        }
        settings.consoles = payload.consoles;
        settings.draft = Object.fromEntries(payload.consoles.map(console => [console.id, {
          gamesPath: console.gamesPath,
          emulatorPath: console.emulatorPath,
          artworkPath: console.artworkPath,
        }]));
        settings.original = settingsSnapshot();
        settings.selectedId = payload.consoles.some(c => c.id === state.selectedConsoleId)
          ? state.selectedConsoleId
          : payload.consoles[0]?.id;
        renderSettingsNavigation();
        renderSettingsEditor();
        setSettingsBusy(false);
        if (payload.error) setSettingsError(payload.error);
        elements.settingsClose.focus();
        break;
      }
      case 'settingsValidation':
        if (settings.open) applySettingsValidation(message.payload);
        break;
      case 'browsePathResult': {
        if (!settings.open) break;
        setSettingsBusy(false);
        const payload = message.payload;
        if (payload.error) { setSettingsError(payload.error); break; }
        if (!payload.cancelled && payload.path != null) {
          const requested = settings.pendingBrowse;
          if (requested) {
            settings.draft[requested.consoleId][requested.field] = payload.path;
            settings.selectedId = requested.consoleId;
            renderSettingsEditor();
            scheduleSettingsValidation();
          }
        }
        settings.pendingBrowse = null;
        break;
      }
      case 'settingsSaved':
        if (!settings.open) break;
        if (!message.payload.saved) {
          setSettingsBusy(false);
          setSettingsError(message.payload.error || 'Settings could not be saved.');
        } else {
          settings.original = settingsSnapshot();
          settings.savedAwaitingScan = true;
          setSettingsBusy(true, 'Saved. Scanning library…');
        }
        break;
      case 'selectConsole':
      case 'selectGame':
        break;
      case 'scanResult':
        if (!settings.open) break;
        setSettingsBusy(false);
        if (message.payload.succeeded) {
          settings.savedAwaitingScan = false;
          closeSettings(true);
          setStatus('Settings saved · library rescanned', 'ok');
        } else {
          settings.savedAwaitingScan = true;
          elements.settingsSave.textContent = 'Retry rescan';
          setSettingsError(`Settings were saved, but scanning failed: ${message.payload.error}`);
          elements.settingsProgress.textContent = 'Your path changes are safe.';
        }
        break;
    }
  });
} else {
  // Opened in a plain browser instead of the Aisles host: say so rather than
  // silently rendering an empty shell.
  setBadge('bridge: not connected', 'error');
  setStatus('This page is designed to run inside Aisles (WebView2).', 'err');
}

post('ready');
