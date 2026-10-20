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

/* ---------- the hero ----------
 * The case and the medium are the workshop's real objects, drawn by hero3d.js from the
 * same millimetre table the shelf uses. This file keeps only the copy and the launch
 * button; the objects are handed over whole, so the hero cannot drift away from the
 * shelf's packaging or invent a second set of proportions.
 */

/** What the medium is called, keyed by the `media` value in consoles.json. */
const MEDIUM_NAMES = {
  JewelCase: 'CD-ROM',
  DvdCase: 'DVD-ROM',
  BluRayCase: 'Blu-ray',
  MiniDiscCase: 'miniDVD',
  CartridgeCase: 'Game card',
};

function renderHero() {
  if (!elements.hero) {
    return;
  }

  const console = currentConsole();
  const game = console?.games.find((entry) => entry.id === state.selectedGameId) ?? null;
  elements.hero.replaceChildren();

  if (!game) {
    window.aislesHero3d?.clear();

    const stage = document.createElement('div');
    stage.className = 'hero-stage hero-stage-empty';
    stage.textContent = console ? 'Pick a case' : 'Pick a console';

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

    elements.hero.append(stage, title, meta, launch);
    return;
  }

  const row = document.createElement('div');
  row.className = 'hero-row';

  const stage = document.createElement('div');
  stage.className = 'hero-stage';
  row.append(stage);

  const title = document.createElement('div');
  title.className = 'hero-title';
  title.textContent = game.title;

  const meta = document.createElement('div');
  meta.className = 'hero-meta';

  const platform = document.createElement('span');
  platform.textContent = console ? `${console.name} · ${console.year}` : '';
  meta.append(platform);

  const medium = document.createElement('span');
  medium.className = 'medium-name';
  medium.textContent = MEDIUM_NAMES[console?.media] ?? 'Media';
  meta.append(medium);

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

  elements.hero.append(row, title, meta, launch);

  const hero = window.aislesHero3d;
  if (hero) {
    stage.append(hero.canvas);
    hero.show(console, game);
  } else {
    stage.textContent = 'The 3D view is unavailable.';
  }
}

window.addEventListener('aisles:hero3d', renderHero);

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
    setStatus(`Library loaded · ${games} games · ${covers} with a cover`);
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
