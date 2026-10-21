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
  shelf: document.querySelector('.shelf'),
  shelfSign: document.getElementById('shelf-sign'),
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
  settingsConsoleEyebrow: document.getElementById('settings-console-eyebrow'),
  settingsConsoleMeta: document.getElementById('settings-console-meta'),
  settingsError: document.getElementById('settings-error'),
  settingsProgress: document.getElementById('settings-progress'),
  consoleMenu: document.getElementById('console-menu'),
  consoleMenuName: document.getElementById('console-menu-name'),
  consoleMenuMeta: document.getElementById('console-menu-meta'),
  consoleMenuResult: document.getElementById('console-menu-result'),
};

const state = {
  library: null,
  selectedConsoleId: null,
  selectedGameId: null,
  launchingGameId: null,
  launchTimer: 0,
  launchSettleTimer: 0,
};

let spatialUiScheduled = false;
let heroModulePromise = null;
let startupArtworkScheduled = false;

function afterFirstPaint(callback, timeout = 1000) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(callback, { timeout });
    } else {
      setTimeout(callback, 0);
    }
  }));
}

function scheduleSpatialUi() {
  if (spatialUiScheduled) return;
  spatialUiScheduled = true;
  afterFirstPaint(() => {
    Promise.all([import('./stage3d.js'), import('./shelf3d.js')])
      .catch((error) => console.warn('Aisles: the 3D stage is unavailable', error));
  });
}

function scheduleStartupArtwork() {
  if (startupArtworkScheduled) return;
  startupArtworkScheduled = true;
  afterFirstPaint(() => {
    const consoleId = state.selectedConsoleId;
    if (consoleId) post('selectConsole', { consoleId });
  }, 1500);
}

const settings = {
  open: false,
  consoles: [],
  draft: {},
  original: '',
  selectedId: null,
  mode: 'console',
  retro: null,
  retroDraft: { username: '', apiKey: '', hasApiKey: false },
  retroStatusEl: null,
  retroTestId: null,
  busy: false,
  savedAwaitingScan: false,
  request: 0,
  validationTimer: 0,
};

const consoleMenu = {
  consoleId: null,
  requestId: null,
  busy: false,
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
  return JSON.stringify({
    consoles: settings.draft,
    retroAchievements: {
      username: settings.retroDraft.username,
      apiKey: settings.retroDraft.apiKey,
    },
  });
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
  for (const control of elements.settingsDialog.querySelectorAll(
    'input, .browse-button, .settings-console-button, .settings-action',
  )) {
    control.disabled = busy;
  }
}

/* ---------- console context menu ---------- */

function menuButton(action) {
  return elements.consoleMenu.querySelector(`button[data-console-action="${action}"]`);
}

function resetConsoleMenuResult() {
  elements.consoleMenuResult.hidden = true;
  elements.consoleMenuResult.textContent = '';
  elements.consoleMenuResult.removeAttribute('data-state');
  menuButton('openReleasePage').hidden = true;
  menuButton('openXeniaManager').hidden = true;

  const check = menuButton('checkForUpdates');
  check.disabled = false;
  check.textContent = 'Check for updates';
}

function setMenuResult(text, state = '') {
  elements.consoleMenuResult.hidden = !text;
  elements.consoleMenuResult.textContent = text;
  if (state) elements.consoleMenuResult.dataset.state = state;
  else elements.consoleMenuResult.removeAttribute('data-state');
}

function showConsoleMenu(consoleId, x, y) {
  const console = state.library?.consoles.find(item => item.id === consoleId);
  if (!console || state.launchingGameId || settings.open) return;

  consoleMenu.consoleId = consoleId;
  consoleMenu.requestId = null;
  consoleMenu.busy = false;
  elements.consoleMenuName.textContent = console.name;
  elements.consoleMenuMeta.textContent = `${console.shortName} · ${console.emulatorName || 'emulator'}`;
  resetConsoleMenuResult();

  elements.consoleMenu.hidden = false;
  elements.consoleMenu.style.left = '0px';
  elements.consoleMenu.style.top = '0px';

  const margin = 8;
  const rect = elements.consoleMenu.getBoundingClientRect();
  const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));
  elements.consoleMenu.style.left = `${left}px`;
  elements.consoleMenu.style.top = `${top}px`;

  if (state.selectedConsoleId !== consoleId) {
    selectConsole(consoleId);
  }

  elements.consoleMenu
    .querySelector('button[data-console-action]:not([hidden]):not([disabled])')
    ?.focus({ preventScroll: true });
}

function hideConsoleMenu() {
  elements.consoleMenu.hidden = true;
  consoleMenu.consoleId = null;
  consoleMenu.busy = false;
}

function runConsoleAction(action) {
  const consoleId = consoleMenu.consoleId;
  if (!consoleId) return;

  if (action === 'checkForUpdates') {
    if (consoleMenu.busy) return;

    consoleMenu.busy = true;
    consoleMenu.requestId = requestId('updates');
    menuButton('openReleasePage').hidden = true;
    menuButton('openXeniaManager').hidden = true;
    setMenuResult('Checking the latest release…');
    const button = menuButton('checkForUpdates');
    button.disabled = true;
    button.textContent = 'Checking…';
    post('checkForUpdates', { consoleId, requestId: consoleMenu.requestId });
    return;
  }

  hideConsoleMenu();

  if (action === 'rescan') {
    setStatus('Rescanning library…');
    post('rescan', { requestId: requestId('context-rescan') });
    return;
  }

  post(action, { consoleId });
}

function onConsoleActionResult(payload) {
  if (!payload) return;
  setStatus(payload.message || 'Done.', payload.ok ? 'ok' : 'err');
}

function onUpdateCheck(message) {
  const payload = message?.payload;
  if (!payload || payload.requestId !== consoleMenu.requestId) return;

  consoleMenu.busy = false;
  const check = menuButton('checkForUpdates');
  check.disabled = false;
  check.textContent = 'Check for updates';
  menuButton('openReleasePage').hidden = !payload.releaseAvailable;
  menuButton('openXeniaManager').hidden = !payload.managerAvailable;

  if (payload.error) {
    setMenuResult(payload.error, 'err');
    setStatus(payload.error, 'err');
    return;
  }

  let headline;
  let state = '';
  if (payload.updateAvailable === true) {
    headline = `Update available${payload.latestVersion ? ` · ${payload.latestVersion}` : ''}`;
    state = 'update';
  } else if (payload.updateAvailable === false) {
    headline = `Up to date${payload.currentVersion ? ` · ${payload.currentVersion}` : ''}`;
    state = 'ok';
  } else {
    headline = payload.note || 'Update status could not be determined.';
  }

  const details = [];
  if (payload.currentVersion && payload.updateAvailable != null) {
    details.push(`installed ${payload.currentVersion}`);
  }
  if (payload.latestVersion) {
    details.push(`latest ${payload.latestVersion}`);
  }
  if (payload.note && payload.note !== headline) {
    details.push(payload.note);
  }

  setMenuResult([headline, ...details].join('\n'), state);

  if (payload.updateAvailable === true) {
    setStatus(`${payload.emulatorName || 'Emulator'}: update available${payload.latestVersion ? ` (${payload.latestVersion})` : ''}`);
  } else if (payload.updateAvailable === false) {
    setStatus(
      `${payload.emulatorName || 'Emulator'} is up to date${payload.currentVersion ? ` (${payload.currentVersion})` : ''}`,
      'ok',
    );
  } else {
    setStatus(payload.note || `${payload.emulatorName || 'Emulator'}: update status unavailable`);
  }
}

elements.consoleMenu.addEventListener('click', (event) => {
  const button = event.target instanceof Element
    ? event.target.closest('button[data-console-action]')
    : null;

  if (!button || button.hidden || button.disabled) return;
  runConsoleAction(button.dataset.consoleAction);
});

elements.consoleMenu.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    hideConsoleMenu();
    return;
  }

  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

  const items = [...elements.consoleMenu.querySelectorAll('button[data-console-action]:not([hidden]):not([disabled])')];
  if (!items.length) return;

  const current = items.indexOf(document.activeElement);
  let next = current;

  if (event.key === 'ArrowDown') next = (current + 1 + items.length) % items.length;
  else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;

  event.preventDefault();
  items[next].focus();
});

document.addEventListener('pointerdown', (event) => {
  if (elements.consoleMenu.hidden) return;
  if (event.target instanceof Node && elements.consoleMenu.contains(event.target)) return;
  hideConsoleMenu();
}, true);

window.addEventListener('blur', hideConsoleMenu);
window.addEventListener('resize', hideConsoleMenu);
window.addEventListener('wheel', hideConsoleMenu, { passive: true });

window.addEventListener('aisles:consoleContext', (event) => {
  const { consoleId, x, y } = event.detail || {};
  if (consoleId) showConsoleMenu(consoleId, x, y);
});

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
    button.setAttribute('aria-selected', String(settings.mode === 'console' && console.id === settings.selectedId));
    button.addEventListener('click', () => {
      settings.mode = 'console';
      settings.selectedId = console.id;
      renderSettingsNavigation();
      renderSettingsEditor();
    });
    elements.settingsConsoles.append(button);
  }

  const separator = document.createElement('div');
  separator.className = 'settings-nav-separator';
  separator.setAttribute('role', 'separator');
  elements.settingsConsoles.append(separator);

  const retro = document.createElement('button');
  retro.type = 'button';
  retro.className = 'settings-console-button';
  retro.textContent = 'RetroAchievements';
  retro.setAttribute('aria-selected', String(settings.mode === 'retro'));
  retro.addEventListener('click', () => {
    settings.mode = 'retro';
    renderSettingsNavigation();
    renderSettingsEditor();
  });
  elements.settingsConsoles.append(retro);
}

function renderSettingsEditor() {
  if (settings.mode === 'retro') {
    renderRetroAchievementsEditor();
    return;
  }

  const console = settings.consoles.find(item => item.id === settings.selectedId);
  if (!console) return;
  elements.settingsConsoleEyebrow.textContent = 'CONSOLE';
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

  const invalid = settings.consoles.some(
    item => Object.values(item.validation ?? {}).some(value => value.state === 'invalid'),
  );
  elements.settingsSave.disabled = settings.busy || invalid;
}

function retroStatusText() {
  const retro = settings.retro;
  if (!retro) return 'Not linked.';
  if (retro.error) return retro.error;
  if (retro.rejected) return 'Saved credentials were rejected. Enter a new key or unlink.';
  if (retro.linked && settings.retroDraft.username) {
    const points = Number.isFinite(retro.points) ? ` - ${retro.points.toLocaleString()} points` : '';
    return `Linked as ${retro.username}${points}.`;
  }
  return 'Not linked.';
}

function retroStatusState() {
  if (!settings.retro) return '';
  if (settings.retro.error || settings.retro.rejected) return 'err';
  if (settings.retro.linked && settings.retroDraft.username) return 'ok';
  return '';
}

function updateRetroDraftStatus() {
  if (!settings.retroStatusEl?.isConnected || settings.retroTestId) return;
  const username = settings.retroDraft.username.trim();
  const key = settings.retroDraft.apiKey.trim();
  settings.retroStatusEl.dataset.state = '';
  settings.retroStatusEl.textContent = username && (key || settings.retroDraft.hasApiKey)
    ? 'Save to link this account.'
    : 'Not linked.';
}

function retroInputField(id, labelText, type, value, placeholder, autocomplete) {
  const wrapper = document.createElement('div');
  wrapper.className = 'settings-field';

  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;

  const row = document.createElement('div');
  row.className = 'path-row single';

  const input = document.createElement('input');
  input.id = id;
  input.type = type;
  input.value = value ?? '';
  input.placeholder = placeholder;
  input.autocomplete = autocomplete;
  input.spellcheck = false;
  row.append(input);

  wrapper.append(label, row);
  return { wrapper, input };
}

function renderRetroAchievementsEditor() {
  elements.settingsConsoleEyebrow.textContent = 'ACCOUNT';
  elements.settingsConsoleName.textContent = 'RetroAchievements';
  elements.settingsConsoleBadge.textContent = 'RA';
  elements.settingsConsoleMeta.textContent = 'PS1 / PS2 / GameCube / Wii';
  elements.settingsFields.replaceChildren();
  settings.retroStatusEl = null;

  const intro = document.createElement('p');
  intro.className = 'settings-help';
  intro.textContent =
    'Link your RetroAchievements account to show achievement progress for PlayStation, '
    + 'PlayStation 2, GameCube and Wii. DS, 3DS, PS3 and Xbox 360 remain unsupported.';
  elements.settingsFields.append(intro);

  const username = retroInputField(
    'settings-ra-username',
    'RetroAchievements username',
    'text',
    settings.retroDraft.username,
    'Your username on retroachievements.org',
    'username',
  );
  username.input.addEventListener('input', () => {
    settings.retroDraft.username = username.input.value;
    updateRetroDraftStatus();
  });

  const key = retroInputField(
    'settings-ra-api-key',
    'Web API key',
    'password',
    settings.retroDraft.apiKey,
    settings.retroDraft.hasApiKey
      ? 'Saved - leave blank to keep'
      : 'Paste the key from your control panel',
    'off',
  );
  key.input.addEventListener('input', () => {
    settings.retroDraft.apiKey = key.input.value;
    updateRetroDraftStatus();
  });

  const status = document.createElement('p');
  status.className = 'settings-status';
  status.id = 'settings-ra-status';
  status.setAttribute('role', 'status');
  status.textContent = retroStatusText();
  status.dataset.state = retroStatusState();
  settings.retroStatusEl = status;

  const actions = document.createElement('div');
  actions.className = 'settings-actions';

  const test = document.createElement('button');
  test.type = 'button';
  test.className = 'secondary-button settings-action';
  test.textContent = 'Test connection';
  test.addEventListener('click', testRetroAchievements);

  const unlink = document.createElement('button');
  unlink.type = 'button';
  unlink.className = 'secondary-button settings-action';
  unlink.textContent = 'Unlink';
  unlink.disabled = !settings.retroDraft.username
    && !settings.retroDraft.apiKey
    && !settings.retroDraft.hasApiKey;
  unlink.addEventListener('click', () => {
    settings.retroDraft = { username: '', apiKey: '', hasApiKey: false };
    settings.retroTestId = null;
    renderRetroAchievementsEditor();
  });

  actions.append(test, unlink);

  const help = document.createElement('p');
  help.className = 'settings-help settings-help-foot';
  help.textContent =
    'Find the key in your RetroAchievements control panel under Keys. Aisles stores it '
    + 'under your Windows profile and never sends it back to this page.';

  elements.settingsFields.append(
    username.wrapper,
    key.wrapper,
    status,
    actions,
    help,
  );

  elements.settingsSave.disabled = settings.busy;
}

function testRetroAchievements() {
  if (settings.busy) return;
  setSettingsError();

  if (settings.retroStatusEl) {
    settings.retroStatusEl.dataset.state = '';
    settings.retroStatusEl.textContent = 'Contacting RetroAchievements...';
  }

  settings.retroTestId = requestId('ra-test');
  setSettingsBusy(true, 'Checking RetroAchievements.');
  post('testRetroAchievements', {
    requestId: settings.retroTestId,
    retroAchievements: {
      username: settings.retroDraft.username,
      apiKey: settings.retroDraft.apiKey,
    },
  });
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
  const invalid = settings.mode === 'console'
    && settings.consoles.some(c => Object.values(c.validation ?? {}).some(v => v.state === 'invalid'));
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
  post('saveSettings', {
    requestId: requestId('save'),
    consoles: settings.draft,
    retroAchievements: {
      username: settings.retroDraft.username,
      apiKey: settings.retroDraft.apiKey,
    },
  });
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

let renderedConsoleSignature = '';

function renderConsoles() {
  const consoles = state.library?.consoles ?? [];
  const signature = consoles
    .map((console) => [
      console.id,
      console.shortName,
      console.name,
      console.games.length,
      console.gamesPathExists,
      console.emulatorExists,
    ].join(':'))
    .join('|');

  if (signature === renderedConsoleSignature && elements.consoleList.children.length === consoles.length) {
    consoles.forEach((console, index) => {
      elements.consoleList.children[index]
        .setAttribute('aria-selected', String(console.id === state.selectedConsoleId));
    });
  } else {
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
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        showConsoleMenu(console.id, event.clientX, event.clientY);
      });
      elements.consoleList.append(item);
    }

    renderedConsoleSignature = signature;
  }

  const totalGames = consoles.reduce((sum, console) => sum + console.games.length, 0);
  elements.totals.textContent = `${consoles.length} consoles · ${totalGames} games`;
  renderShelfSign();
}

const SHELF_SIGN_IDS = new Set(['ps1', 'ps2', 'ps3', 'wii', 'gamecube', 'ds', '3ds', 'xbox360']);

function renderShelfSign() {
  const console = currentConsole();
  const supported = console && SHELF_SIGN_IDS.has(console.id);

  elements.shelfSign.hidden = !supported;
  elements.shelfSign.src = supported
    ? `art/retail-wood-v1/category-${console.id}.png`
    : '';
  elements.shelfSign.alt = supported ? `${console.name} section` : '';
  elements.shelf?.setAttribute('aria-label', console ? `${console.name} shelf` : 'Shelf');
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

    if (game.titleSource) {
      const source = document.createElement('span');
      source.className = 'source';
      source.textContent = game.titleSource;
      source.title = `title resolved from ${game.titleSource}`;
      meta.append(source);
    }

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
  if (state.launchingGameId) {
    return;
  }

  state.selectedConsoleId = consoleId;
  state.selectedGameId = null;
  renderConsoles();
  if (document.body.classList.contains('shelf3d-failed')) renderGames();
  renderHero();
  publishSnapshot();
  post('selectConsole', { consoleId });
}

// The 3D lineup clicks back into the same selection path as the list.
window.aislesSelectConsole = selectConsole;

function selectGame(gameId) {
  if (state.launchingGameId) {
    return;
  }

  state.selectedGameId = gameId;
  post('selectGame', { gameId });
  if (document.body.classList.contains('shelf3d-failed')) renderGames();
  renderHero();
  publishSnapshot();
}

function clearGameSelection() {
  if (state.launchingGameId || state.selectedGameId === null) {
    return;
  }

  state.selectedGameId = null;
  if (document.body.classList.contains('shelf3d-failed')) renderGames();
  renderHero();
  publishSnapshot();
}

function launchGame(gameId) {
  if (state.launchingGameId) {
    return;
  }

  const game = currentConsole()?.games.find((entry) => entry.id === gameId);
  if (!game) {
    return;
  }

  state.selectedGameId = gameId;
  state.launchingGameId = gameId;
  if (document.body.classList.contains('shelf3d-failed')) renderGames();
  renderHero();
  publishSnapshot();
  setStatus(`Spinning up ${game.title}…`);

  state.launchTimer = window.setTimeout(() => {
    state.launchTimer = 0;
    if (state.launchingGameId === gameId) {
      post('launchGame', { gameId });
    }
  }, 420);
}

// The shelf clicks and double-clicks back into these same paths.
window.aislesSelectGame = selectGame;
window.aislesClearGameSelection = clearGameSelection;
window.aislesLaunchGame = launchGame;

/* ---------- hero ---------- */

/* ---------- the hero ----------
 * The case and the medium are the workshop's real objects, drawn by hero3d.js from the
 * same millimetre table the shelf uses. This file keeps only the copy and the launch
 * button; the objects are handed over whole, so the hero cannot drift away from the
 * shelf's packaging or invent a second set of proportions.
 */

const SHELF_GAMES = 18;

function formatDuration(seconds) {
  // RPCS3 reports short sessions in seconds ("52 second(s)"); a rail that rounds a
  // first launch up to "1m" would be claiming more play time than was recorded.
  const totalSeconds = Math.max(1, Math.round(seconds));

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function shelfPosition(console, game) {
  const index = console?.games.findIndex((entry) => entry.id === game.id) ?? -1;
  if (index < 0) {
    return null;
  }

  const shelves = Math.max(1, Math.ceil(console.games.length / SHELF_GAMES));
  return `${Math.floor(index / SHELF_GAMES) + 1} of ${shelves}`;
}

function detailHeading(text) {
  const heading = document.createElement('h2');
  heading.textContent = text;
  return heading;
}

function detailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'detail-row';

  const term = document.createElement('dt');
  term.textContent = label;

  const detail = document.createElement('dd');
  detail.textContent = value || '—';
  if (!value) {
    detail.classList.add('detail-muted');
  }

  row.append(term, detail);
  return row;
}

function informationSection(console, game) {
  const section = document.createElement('section');
  section.className = 'detail-section';

  const grid = document.createElement('dl');
  grid.className = 'detail-grid';
  grid.append(
    detailRow('Game ID', game.identityId ?? game.serial),
    detailRow('Region', game.region),
    detailRow('Version', game.version),
    detailRow('Emulator', console?.emulatorName),
    detailRow('Shelf', shelfPosition(console, game)),
  );

  section.append(detailHeading('INFORMATION'), grid);
  return section;
}

function playedSection(game) {
  const section = document.createElement('section');
  section.className = 'detail-section';

  const played = game.played ?? {};
  const seconds = Number.isFinite(played.seconds) ? played.seconds : null;
  const duration = seconds > 0 ? formatDuration(seconds) : null;
  const row = document.createElement('div');
  row.className = 'detail-line';

  if (duration) {
    const value = document.createElement('span');
    value.className = 'detail-value';
    value.textContent = duration;
    row.append(value);

    if (played.lastPlayed) {
      const lastPlayed = document.createElement('span');
      lastPlayed.className = 'detail-secondary';
      lastPlayed.textContent = `last played ${played.lastPlayed}`;
      row.append(lastPlayed);
    }
  } else {
    const value = document.createElement('span');
    value.className = 'detail-value detail-muted';
    value.textContent = '—';
    row.append(value);

    const reason = document.createElement('span');
    reason.className = 'detail-reason';
    reason.textContent = played.reason ?? 'This emulator does not record play time.';
    row.append(reason);
  }

  if (played.source && duration) {
    const source = document.createElement('span');
    source.className = 'detail-source';
    source.textContent = played.source;
    row.append(source);
  }

  section.append(detailHeading('PLAYED'), row);
  return section;
}

function achievementsSection(game) {
  const section = document.createElement('section');
  section.className = 'detail-section';

  const achievements = game.achievements ?? { state: 'notLinked' };
  const row = document.createElement('div');
  row.className = 'detail-line';
  const value = document.createElement('span');
  value.className = 'detail-value';
  const note = document.createElement('span');
  note.className = 'detail-source';

  if (achievements.state === 'linked') {
    const hasProgress = Number.isFinite(achievements.total)
      && Number.isFinite(achievements.earned)
      && achievements.total > 0;
    const earned = hasProgress ? achievements.earned : 0;
    const total = hasProgress ? achievements.total : 0;
    value.textContent = hasProgress
      ? `${earned} of ${total} achievements`
      : 'Linked';
    note.textContent = hasProgress
      ? (Number.isFinite(achievements.points) ? `${achievements.points} pts` : '')
      : (achievements.note ?? 'Progress not available');

    const track = document.createElement('div');
    track.className = 'detail-progress';
    const fill = document.createElement('span');
    fill.style.width = `${hasProgress ? Math.min(100, (earned / total) * 100) : 0}%`;
    track.append(fill);

    row.append(value, note);
    section.append(detailHeading('ACHIEVEMENTS'), row, track);
  } else if (achievements.state === 'notSupported') {
    value.textContent = 'Not supported on this platform';
    note.textContent = achievements.note ?? 'RetroAchievements unsupported';
    row.append(value, note);
    section.append(detailHeading('ACHIEVEMENTS'), row);
  } else {
    value.textContent = 'Supported · not linked';
    note.textContent = achievements.note ?? 'Add account in Settings';
    row.append(value, note);
    section.append(detailHeading('ACHIEVEMENTS'), row);
  }

  return section;
}

function detailsRail(console, game) {
  const details = document.createElement('div');
  details.className = 'hero-details';
  details.append(
    informationSection(console, game),
    playedSection(game),
    achievementsSection(game),
  );
  return details;
}

function heroHead(title, meta, launch) {
  const copy = document.createElement('div');
  copy.className = 'hero-copy';
  copy.append(title, meta);

  const head = document.createElement('div');
  head.className = 'hero-head';
  head.append(copy, launch);
  return head;
}

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
    stage.textContent = !console
      ? 'Pick a console'
      : console.games.length === 0
        ? 'Drop games here'
        : 'Pick a case';

    const title = document.createElement('div');
    title.className = 'hero-title';
    title.textContent = console ? console.name : 'Aisles';

    const meta = document.createElement('div');
    meta.className = 'hero-meta';
    meta.textContent = !console
      ? 'Walk the aisles of your collection.'
      : console.games.length === 0
        ? console.gamesPathExists
          ? 'No games found in this console’s folder.'
          : 'This console’s games folder is missing.'
        : `${console.games.length} games on this shelf`;

    const launch = document.createElement('button');
    launch.className = 'launch';
    launch.type = 'button';
    launch.textContent = 'LAUNCH';
    launch.disabled = true;

    elements.hero.append(stage, heroHead(title, meta, launch));
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
  meta.textContent = console ? `${console.name} · ${console.year}` : '';

  const launch = document.createElement('button');
  launch.className = 'launch';
  launch.type = 'button';
  const launching = state.launchingGameId === game.id;
  launch.textContent = launching ? 'STARTING…' : 'LAUNCH';
  launch.disabled = launching;
  launch.addEventListener('click', () => launchGame(game.id));

  elements.hero.append(row, heroHead(title, meta, launch), detailsRail(console, game));

  const hero = window.aislesHero3d;
  if (hero) {
    stage.append(hero.canvas);
    hero.show(console, game);
    if (launching) {
      hero.launch();
    }
  } else {
    stage.textContent = 'Loading 3D view…';
    heroModulePromise ??= import('./hero3d.js')
      .catch((error) => {
        heroModulePromise = null;
        console.warn('Aisles: the 3D hero is unavailable', error);
        if (stage.isConnected) stage.textContent = 'The 3D view is unavailable.';
      });
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
window.addEventListener('aisles:shelf3d-failed', renderGames);

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
  if (event.key === 'Escape' && !elements.consoleMenu.hidden) {
    event.preventDefault();
    hideConsoleMenu();
  } else if (event.key === 'Escape' && settings.open) {
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
  const firstLibrary = !state.library || Boolean(state.library.error);
  const updateLibraryStatus = firstLibrary || elements.status.textContent.startsWith('Library loaded');
  state.library = payload;

  const consoles = payload.consoles ?? [];

  if (payload.error) {
    setBadge('bridge: catalog error', 'error');
    setStatus(payload.error, 'err');
  } else {
    setBadge('bridge OK', 'ok');

    // Artwork resolution and rescans both refresh this payload. The normal library
    // count may update, but it must not erase a result the user just asked for.
    if (updateLibraryStatus) {
      const games = consoles.reduce((sum, console) => sum + console.games.length, 0);
      const covers = consoles.reduce(
        (sum, console) => sum + console.games.filter((game) => game.frontCoverUrl).length,
        0,
      );
      setStatus(`Library loaded · ${games} games · ${covers} with a cover`);
    }
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
  if (document.body.classList.contains('shelf3d-failed')) renderGames();
  renderHero();
  publishSnapshot();
  scheduleSpatialUi();
  scheduleStartupArtwork();
}

function onGameDetails(payload) {
  if (!payload || payload.gameId !== state.selectedGameId) {
    return;
  }

  const console = currentConsole();
  const game = console?.games.find((entry) => entry.id === payload.gameId) ?? null;
  if (!game) {
    return;
  }

  // Only non-empty values replace what the payload already knows: a late Wii header
  // read must be able to fill a blank Game ID, not clear one the library had.
  if (payload.identityId) game.identityId = payload.identityId;
  if (payload.region) game.region = payload.region;
  if (payload.version) game.version = payload.version;
  if (payload.played) game.played = payload.played;
  if (payload.achievements) game.achievements = payload.achievements;

  const details = elements.hero?.querySelector('.hero-details');
  if (details) {
    details.replaceWith(detailsRail(console, game));
  }
}

function onLaunchResult(payload) {
  if (payload?.gameId === state.launchingGameId) {
    if (state.launchTimer) {
      window.clearTimeout(state.launchTimer);
      state.launchTimer = 0;
    }

    const settle = () => {
      state.launchSettleTimer = 0;
      state.launchingGameId = null;
      window.aislesHero3d?.settleLaunch();
      const launch = elements.hero?.querySelector('.launch');
      if (launch) {
        launch.disabled = false;
        launch.textContent = 'LAUNCH';
      }
    };

    if (payload.started) {
      state.launchSettleTimer = window.setTimeout(settle, 1100);
    } else {
      settle();
    }
  }
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
      case 'gameDetails':
        onGameDetails(message.payload);
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
        settings.mode = 'console';
        settings.retro = payload.retroAchievements ?? null;
        settings.retroDraft = {
          username: settings.retro?.username ?? '',
          apiKey: '',
          hasApiKey: Boolean(settings.retro?.hasApiKey),
        };
        settings.retroStatusEl = null;
        settings.retroTestId = null;
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
      case 'retroAchievementsTest': {
        if (!settings.open || message.payload?.requestId !== settings.retroTestId) break;
        settings.retroTestId = null;
        setSettingsBusy(false);
        if (settings.retroStatusEl?.isConnected) {
          settings.retroStatusEl.dataset.state = message.payload.ok ? 'ok' : 'err';
          settings.retroStatusEl.textContent = message.payload.message
            || (message.payload.ok
              ? 'Connection succeeded.'
              : 'Could not connect to RetroAchievements.');
        }
        break;
      }
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
      case 'consoleActionResult':
        onConsoleActionResult(message.payload);
        break;
      case 'updateCheck':
        onUpdateCheck(message);
        break;
      case 'selectConsole':
      case 'selectGame':
        break;
      case 'scanResult':
        if (!settings.open) {
          setStatus(
            message.payload.succeeded ? 'Library rescanned' : `Rescan failed: ${message.payload.error}`,
            message.payload.succeeded ? 'ok' : 'err',
          );
          break;
        }
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
