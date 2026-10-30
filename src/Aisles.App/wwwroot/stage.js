// Page shell, state, and browse views: host bridge, library state, toolbar, Shelf,
// Covers, List and details rail. The pixel shelf and lineup live in pixel-ui.js.
import { presetFor } from './media-presets.js';
import { browseMotion } from './browse-motion.js';

const webview = window.chrome?.webview;

const elements = {
  badge: document.getElementById('bridge-badge'),
  layout: document.querySelector('.layout'),
  stageRow: document.querySelector('.stage-row'),
  consoleFilter: document.getElementById('console-filter'),
  viewSwitch: document.getElementById('view-switch'),
  gameFilter: document.getElementById('game-filter'),
  gameList: document.getElementById('game-list'),
  coverGrid: document.getElementById('cover-grid'),
  coversView: document.getElementById('covers-view'),
  listView: document.getElementById('list-view'),
  gamesHeading: document.querySelectorAll('.games-heading'),
  hero: document.getElementById('hero'),
  shelf: document.querySelector('.shelf'),
  shelfCanvas: document.getElementById('shelf-canvas'),
  shelfPager: document.getElementById('shelf-pager'),
  shelfLabel: document.getElementById('shelf-label'),
  shelfHint: document.getElementById('shelf-hint'),
  shelfListbox: document.getElementById('shelf-listbox'),
  status: document.getElementById('status'),
  totals: document.getElementById('totals'),
  startupPanel: document.getElementById('startup-panel'),
  startupMessage: document.getElementById('startup-message'),
  startupActions: document.getElementById('startup-actions'),
  startupRetry: document.getElementById('startup-retry'),
  startupSettings: document.getElementById('startup-settings'),
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
  gameFilter: '',
  // Toolbar filter: null means All. The shelf, hero and host bridge use
  // selectedConsoleId, which is always a concrete console.
  consoleFilterId: null,
  viewMode: 'shelf',
  // The shelf listbox's keyboard focus (separate from the selected game, which is
  // what the pixel shelf and selected-game panel highlight).
  shelfFocusedId: null,
  shelfBay: 1,
  shelfPerBay: 18,
};

let spatialUiScheduled = false;
let startupArtworkScheduled = false;
let startupScanTimer = 0;
let browseAnimations = [];
let browseTransitionId = 0;
const reducedBrowseMotion = matchMedia('(prefers-reduced-motion: reduce)');

let shelfListboxBuiltFor = null; // console.id + page the listbox was last built for
const BROWSE_PREFERENCE_KEY = 'aisles.browse-preference.v1';

function loadBrowsePreference() {
  try {
    return JSON.parse(localStorage.getItem(BROWSE_PREFERENCE_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveBrowsePreference() {
  try {
    localStorage.setItem(BROWSE_PREFERENCE_KEY, JSON.stringify({
      consoleId: state.selectedConsoleId,
      viewMode: state.viewMode,
    }));
  } catch {
    // Storage can be disabled by the WebView host; browsing remains fully usable.
  }
}

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
    import('./pixel-ui.js')
      .catch((error) => console.warn('Aisles: the pixel stage is unavailable', error));
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
  // A console id passed to openSettings() that must be selected when the
  // settingsData payload arrives, overriding the previously selected console.
  pendingConsoleId: null,
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

function setBrowseStatus() {
  const scope = state.consoleFilterId === null
    ? 'All consoles'
    : currentConsole()?.name ?? 'Library';
  const view = state.viewMode === 'shelf' ? 'Shelf' : state.viewMode === 'covers' ? 'Covers' : 'List';
  setStatus(`${view} · ${scope} · ${filteredGameEntries().length} games`);
}

function setBadge(text, stateName) {
  elements.badge.textContent = text;
  elements.badge.dataset.state = stateName;
}

function showBadge(show) {
  elements.badge.hidden = !show;
}

/* Startup state: the page opens busy and inert with the startup panel visible. The
   panel shows real loading text, then the actual error with Retry and Open Settings. */

function setLayoutBusy(busy) {
  elements.layout.toggleAttribute('aria-busy', busy);
  elements.layout.toggleAttribute('inert', busy);
  elements.gameFilter.disabled = busy;
  elements.settingsTrigger.disabled = busy;
}

function startup() {
  clearTimeout(startupScanTimer);
  startupScanTimer = 0;
  elements.startupPanel.hidden = false;
  elements.startupMessage.textContent = 'Loading your library…';
  elements.status.textContent = 'Loading your library…';
  elements.startupActions.hidden = true;
  elements.status.className = '';
  showBadge(false);
  setLayoutBusy(true);
  post('ready');
  startupScanTimer = setTimeout(() => {
    if (!state.library || state.library.error) {
      elements.startupMessage.textContent = 'Scanning configured folders…';
      elements.status.textContent = 'Scanning configured folders…';
    }
  }, 1500);
}

function resolveStartup() {
  clearTimeout(startupScanTimer);
  startupScanTimer = 0;
  elements.startupPanel.hidden = true;
  elements.startupActions.hidden = true;
  setLayoutBusy(false);
}

function showStartupError(message, recoverable = true) {
  clearTimeout(startupScanTimer);
  startupScanTimer = 0;
  elements.startupPanel.hidden = false;
  elements.startupMessage.setAttribute('aria-live', 'assertive');
  elements.startupMessage.textContent = message;
  elements.startupActions.hidden = !recoverable;
  elements.status.textContent = message;
  elements.status.className = 'err';
  setLayoutBusy(false);
  showBadge(true);
}

function retryStartup() {
  elements.startupMessage.setAttribute('aria-live', 'polite');
  elements.startupMessage.textContent = 'Loading your library…';
  elements.status.textContent = 'Loading your library…';
  elements.status.className = '';
  showBadge(false);
  setLayoutBusy(true);
  startup();
}

/* Settings */

const SETTINGS_FIELDS = [
  { key: 'gamesPath', label: 'Games folder', browse: 'Browse folder' },
  { key: 'emulatorPath', label: 'Emulator executable', browse: 'Browse file' },
  { key: 'corePath', label: 'RetroArch core (optional)', browse: 'Browse DLL' },
  { key: 'installedGamesPath', label: 'Installed games folder (optional)', browse: 'Browse folder' },
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

/* Console context menu */

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

function openSettings(consoleId = null) {
  settings.pendingConsoleId = consoleId;
  settings.open = true;
  settings.savedAwaitingScan = false;
  elements.settingsBackdrop.hidden = false;
  elements.settingsSave.textContent = 'Save & rescan';
  setSettingsBusy(true, 'Loading settings…');
  setSettingsError();
  post('getSettings', { requestId: requestId('load') });
}
window.aislesOpenSettings = openSettings;

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
  elements.settingsConsoleMeta.textContent = 'PS1 / PS2 / GameCube / Wii / DS · PS3 via RPCS3';
  elements.settingsFields.replaceChildren();
  settings.retroStatusEl = null;

  const intro = document.createElement('p');
  intro.className = 'settings-help';
  intro.textContent =
    'Link your RetroAchievements account to show achievement progress for PlayStation, '
    + 'PlayStation 2, GameCube, Wii and DS through a compatible RetroArch core. '
    + 'PlayStation 3 trophies are read locally from RPCS3, so they need no account. '
    + '3DS and Xbox 360 remain unsupported.';
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
  const labels = { found: 'Found', notFound: 'Not found: you can still save this path', notConfigured: 'Not configured', invalid: validation?.error ?? 'Invalid path' };
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
elements.gameFilter.addEventListener('input', () => {
  state.gameFilter = elements.gameFilter.value;
  renderGames();
  publishSnapshot();
});

elements.viewSwitch.addEventListener('click', (event) => {
  const button = event.target instanceof Element
    ? event.target.closest('button[data-view]')
    : null;
  if (!button || button.disabled) return;
  setViewMode(button.dataset.view);
});

elements.consoleFilter.addEventListener('click', (event) => {
  const chip = event.target instanceof Element
    ? event.target.closest('button[data-console-filter]')
    : null;
  if (!chip || chip.disabled) return;
  setConsoleFilter(chip.dataset.consoleFilter === 'all' ? null : chip.dataset.consoleFilter);
});
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

/* Rendering */

function renderConsoles() {
  const consoles = state.library?.consoles ?? [];
  const totalGames = consoles.reduce((sum, console) => sum + console.games.length, 0);
  elements.totals.textContent = `${consoles.length} consoles · ${totalGames} games`;
  const console = currentConsole();
  elements.shelf?.setAttribute('aria-label', console ? `${console.name} shelf` : 'Shelf');
}

/* Browse views. One browsing area holds the shelf, cover grid and list; the toolbar
   above it holds console filters, search and the view switch. */

function filteredGameEntries() {
  // One filter shape for Covers and List: All combines consoles in library order, a
  // concrete console keeps only that one, and search runs inside the active filter.
  const filter = state.gameFilter.trim().toLocaleLowerCase();
  const entries = [];

  for (const item of state.library?.consoles ?? []) {
    if (state.consoleFilterId !== null && item.id !== state.consoleFilterId) continue;
    // A console whose games folder has gone missing offers its recovery actions
    // (path, "Choose games folder") rather than silently listing stale entries.
    if (!item.gamesPathExists) continue;

    for (const game of item.games) {
      if (filter && !game.title.toLocaleLowerCase().includes(filter)) continue;
      entries.push({ game, console: item });
    }
  }

  return entries;
}

let consoleFilterSignature = null;

function renderLibraryToolbar() {
  const consoles = state.library?.consoles ?? [];
  const total = consoles.reduce((sum, item) => sum + item.games.length, 0);

  // Chips rebuild only when the payload changes, so a filter click keeps its focus
  // and a background rescan does not repaint the row under the pointer.
  const signature = consoles
    .map((item) => [item.id, item.shortName, item.games.length].join(':'))
    .join('|');
  if (signature !== consoleFilterSignature || !elements.consoleFilter.childElementCount) {
    consoleFilterSignature = signature;

    const chips = (filterId, label, count, className = 'filter-chip') => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = className;
      chip.dataset.consoleFilter = filterId ?? 'all';
      const name = document.createElement('span');
      name.textContent = label;
      const held = document.createElement('span');
      held.className = 'chip-count';
      held.textContent = String(count);
      chip.append(name, held);
      return chip;
    };

    const fragment = document.createDocumentFragment();
    fragment.append(chips(null, 'All', total));
    for (const item of consoles) fragment.append(chips(item.id, item.shortName, item.games.length));
    elements.consoleFilter.replaceChildren(fragment);
  }

  for (const chip of elements.consoleFilter.querySelectorAll('button[data-console-filter]')) {
    const id = chip.dataset.consoleFilter === 'all' ? null : chip.dataset.consoleFilter;
    chip.setAttribute('aria-pressed', String(id === state.consoleFilterId));
  }
}

function browseViewElement(view) {
  if (view === 'shelf') return elements.shelf;
  if (view === 'covers') return elements.coversView;
  return elements.listView;
}

function cancelBrowseAnimations() {
  for (const animation of browseAnimations) animation.cancel();
  browseAnimations = [];
}

function applyBrowseView(view) {
  for (const element of [elements.shelf, elements.coversView, elements.listView]) {
    element.style.removeProperty('transform');
    element.style.removeProperty('z-index');
    element.style.removeProperty('will-change');
  }

  elements.shelf.hidden = false;
  elements.shelf.style.visibility = view !== 'shelf' ? 'hidden' : 'visible';
  elements.coversView.hidden = view !== 'covers';
  elements.listView.hidden = view !== 'list';

  for (const name of ['shelf', 'covers', 'list']) {
    const element = browseViewElement(name);
    const active = name === view;
    element.inert = !active;
    element.setAttribute('aria-hidden', String(!active));
  }
}

function transitionBrowseView(from, to) {
  const transitionId = ++browseTransitionId;
  cancelBrowseAnimations();
  applyBrowseView(from);

  if (reducedBrowseMotion.matches) {
    applyBrowseView(to);
    return;
  }

  const fromElement = browseViewElement(from);
  const toElement = browseViewElement(to);
  const motion = browseMotion(from, to);

  elements.shelf.hidden = false;
  elements.shelf.style.visibility = from === 'shelf' || to === 'shelf' ? 'visible' : 'hidden';
  if (from !== 'shelf') fromElement.hidden = false;
  if (to !== 'shelf') toElement.hidden = false;

  for (const name of ['shelf', 'covers', 'list']) {
    const element = browseViewElement(name);
    const active = name === to;
    element.inert = !active;
    element.setAttribute('aria-hidden', String(!active));
  }

  const options = { duration: motion.duration, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' };
  if (motion.outgoing) {
    fromElement.style.zIndex = '1';
    fromElement.style.willChange = 'transform';
    browseAnimations.push(fromElement.animate(motion.outgoing, options));
  }
  if (motion.incoming) {
    toElement.style.zIndex = '2';
    toElement.style.willChange = 'transform';
    browseAnimations.push(toElement.animate(motion.incoming, options));
  }

  Promise.all(browseAnimations.map(animation => animation.finished.catch(() => {}))).then(() => {
    if (transitionId !== browseTransitionId) return;
    browseAnimations = [];
    applyBrowseView(to);
  });
}

function renderBrowseView(previousView = null) {
  if (previousView && previousView !== state.viewMode) {
    transitionBrowseView(previousView, state.viewMode);
  } else {
    browseTransitionId += 1;
    cancelBrowseAnimations();
    applyBrowseView(state.viewMode);
  }

  for (const button of elements.viewSwitch.querySelectorAll('button[data-view]')) {
    const view = button.dataset.view;
    button.setAttribute('aria-pressed', String(view === state.viewMode));

    const unusable = view === 'shelf' && state.consoleFilterId === null;
    button.disabled = unusable;
    if (unusable) {
      button.title = 'Choose a console to use Shelf view.';
    } else {
      button.removeAttribute('title');
    }
  }

  updateHeroLayout();
}

function setViewMode(viewMode) {
  if (state.launchingGameId) return;
  if (viewMode === state.viewMode) return;
  if (viewMode === 'shelf' && state.consoleFilterId === null) return;

  const previousView = state.viewMode;
  state.viewMode = viewMode;
  state.shelfFocusedId = null;
  renderBrowseView(previousView);
  syncShelfListbox();
  setBrowseStatus();
  saveBrowsePreference();
}

function setConsoleFilter(filterId) {
  if (state.launchingGameId) return;
  if ((filterId ?? null) === (state.consoleFilterId ?? null)) return;

  if (filterId === null) {
    // All is a web-side view: no host message, and the single-platform shelf
    // renderer stays out of the mix, so the view steps across to Covers.
    state.consoleFilterId = null;
    if (state.viewMode === 'shelf') state.viewMode = 'covers';
    renderGames();
    return;
  }

  if (!state.library?.consoles.some((item) => item.id === filterId)) return;
  selectConsole(filterId);
}

function renderGames() {
  const entries = filteredGameEntries();

  renderGamesHeading(entries);
  renderLibraryToolbar();
  renderBrowseView();
  renderCoverGrid(entries);
  renderGameList(entries);
  syncShelfListbox();
}

function renderGamesHeading(entries) {
  const filter = state.gameFilter.trim();
  const scope = state.consoleFilterId === null
    ? 'All consoles'
    : state.library?.consoles.find((item) => item.id === state.consoleFilterId)?.name ?? 'Games';
  const base = filter ? `Games · ${scope} · matching “${filter}”` : `Games · ${scope}`;
  const text = entries.length ? `${base} · ${entries.length}` : base;
  for (const heading of elements.gamesHeading) heading.textContent = text;
}

function emptyStateDetails(entries) {
  if (entries.length > 0) return null;

  const consoles = state.library?.consoles ?? [];

  if (state.consoleFilterId === null) {
    const total = consoles.reduce(
      (sum, item) => sum + (item.gamesPathExists ? item.games.length : 0),
      0,
    );
    if (total === 0) {
      return {
        message: 'No games found in the configured libraries',
        actionLabel: 'Open Settings',
        action: () => openSettings(),
      };
    }
    return searchMissDetails();
  }

  const item = consoles.find((c) => c.id === state.consoleFilterId);
  if (!item) return null;
  if (state.gameFilter.trim()) return searchMissDetails();
  if (!item.gamesPathExists) {
    return {
      kind: 'recovery',
      console: item,
      message: `No games folder at ${item.gamesPath}.`,
      primaryLabel: `Choose ${item.name} folder`,
      primaryAction: () => openSettings(item.id),
      secondaryLabel: 'Open Settings',
      secondaryAction: () => openSettings(),
    };
  }
  if (item.games.length === 0) {
    return {
      message: `No games found in ${item.gamesPath}.`,
      actionLabel: 'Rescan library',
      action: requestLibraryRescan,
    };
  }
  return searchMissDetails();
}

function searchMissDetails() {
  return {
    message: `No games match “${state.gameFilter.trim()}”.`,
    actionLabel: 'Clear filter',
    action: clearGameFilter,
  };
}

function clearGameFilter() {
  state.gameFilter = '';
  elements.gameFilter.value = '';
  elements.gameFilter.focus();
  renderGames();
  publishSnapshot();
}

function requestLibraryRescan() {
  setStatus('Rescanning library…');
  post('rescan', { requestId: requestId('library-rescan') });
}

function emptyStateElement(details) {
  const element = document.createElement('li');
  element.className = 'empty';

  if (details.kind === 'recovery') {
    element.classList.add('empty--recovery');
    const name = document.createElement('h3');
    name.textContent = details.console.name;
    const message = document.createElement('p');
    message.textContent = details.message;
    const actions = document.createElement('div');
    actions.className = 'empty-actions';
    const primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'empty-button empty-button--primary';
    primary.textContent = details.primaryLabel;
    primary.addEventListener('click', details.primaryAction);
    const secondary = document.createElement('button');
    secondary.type = 'button';
    secondary.className = 'empty-button empty-button--secondary';
    secondary.textContent = details.secondaryLabel;
    secondary.addEventListener('click', details.secondaryAction);
    actions.append(primary, secondary);
    element.append(name, message, actions);
    return element;
  }

  const message = document.createElement('span');
  message.textContent = details.message;
  element.append(message);
  if (details.actionLabel && details.action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = details.actionLabel;
    button.addEventListener('click', details.action);
    element.append(button);
  }
  return element;
}

function consoleBadge(item) {
  const badge = document.createElement('span');
  badge.className = 'badge-console';
  badge.textContent = item.shortName;
  badge.title = item.name;
  return badge;
}

function renderCoverGrid(entries) {
  renderListWithPreservation(elements.coverGrid, () => {
    const grid = elements.coverGrid;
    const empty = emptyStateDetails(entries);
    grid.replaceChildren();

    if (empty) {
      grid.append(emptyStateElement(empty));
      return;
    }

    // A specific console's rows all carry it already; the badge is for mixing.
    const showBadges = state.consoleFilterId === null;
    for (const entry of entries) {
      grid.append(coverCard(entry, showBadges));
    }
  });
}

function coverCard(entry, showBadge) {
  const item = document.createElement('li');
  item.className = 'cover-card';
  const [caseWidth, caseHeight] = presetFor(entry.console).case;
  item.style.setProperty('--case-aspect', `${caseWidth} / ${caseHeight}`);
  item.dataset.gameId = entry.game.id;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(entry.game.id === state.selectedGameId));
  item.tabIndex = 0;

  if (showBadge) item.append(consoleBadge(entry.console));
  item.append(artwork(entry.game, 'art cover-card-art'));

  const display = document.createElement('span');
  display.className = 'cover-title';
  display.textContent = entry.game.title;
  item.append(display);

  item.addEventListener('click', () => {
    // A mouse pick must also move focus: with focus left behind the page, Space
    // then scrolls the grid instead of acting on the selection.
    item.focus({ preventScroll: true });
    selectEntry(entry);
  });
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectEntry(entry);
    }
  });
  item.addEventListener('dblclick', () => launchEntry(entry));

  return item;
}

// Renders the list while preserving scroll position and the focused row (re-focused
// by game id after the rebuild).
function renderListWithPreservation(list, render) {
  const scrollTop = list.scrollTop;
  const active = document.activeElement;
  const focusId = (active instanceof HTMLElement && list.contains(active))
    ? active.closest('[data-game-id]')?.dataset.gameId ?? null
    : null;
  render();
  list.scrollTop = scrollTop;
  if (focusId) {
    const target = list.querySelector('[data-game-id="' + focusId + '"]');
    if (target) target.focus({ preventScroll: true });
  }
}

function renderGameList(entries) {
  renderListWithPreservation(elements.gameList, () => {
    const list = elements.gameList;
    const empty = emptyStateDetails(entries);
    list.replaceChildren();

    if (empty) {
      list.append(emptyStateElement(empty));
      return;
    }

    const showBadges = state.consoleFilterId === null;

    for (const entry of entries) {
      const game = entry.game;
      const item = document.createElement('li');
      item.className = 'game';
      item.dataset.gameId = game.id;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(game.id === state.selectedGameId));
      item.tabIndex = 0;

      // Non-visible diagnostic data: useful for debugging, never shown in normal
      // browsing. Title source, cover provenance and launch path stay here.
      if (game.titleSource) item.dataset.titleSource = game.titleSource;
      if (game.frontCoverSource) item.dataset.frontCoverSource = game.frontCoverSource;
      if (game.launchTarget) item.dataset.launchTarget = game.launchTarget;

      const text = document.createElement('span');
      text.className = 'text';

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = game.title;

      const meta = document.createElement('span');
      meta.className = 'meta';

      if (showBadges) meta.append(consoleBadge(entry.console));

      if (game.serial) {
        const serial = document.createElement('span');
        serial.className = 'serial';
        serial.textContent = game.serial;
        meta.append(serial);
      }

      text.append(title, meta);

      const launch = document.createElement('button');
      launch.className = 'launch';
      launch.type = 'button';
      launch.textContent = 'LAUNCH';
      launch.addEventListener('click', (event) => {
        event.stopPropagation();
        launchEntry(entry);
      });

      item.append(artwork(game), text, launch);
      item.addEventListener('click', () => {
        // Click and focus travel together, so Space acts on the pick instead of
        // scrolling the list from wherever focus was left behind.
        item.focus({ preventScroll: true });
        selectEntry(entry);
      });
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectEntry(entry);
        }
      });
      item.addEventListener('dblclick', () => launchEntry(entry));
      list.append(item);
    }
  });
}

function artwork(game, className = 'art') {
  const tile = document.createElement('span');
  tile.className = className;

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

/* State */

function publishSnapshot() {
  // The 3D layer is a module, so it cannot read this file's top-level bindings.
  // A snapshot plus an event is the whole contract between them.
  const console = currentConsole();
  const query = state.gameFilter.trim().toLocaleLowerCase();
  const shelfGames = console?.games ?? [];
  const visibleGameIds = query
    ? shelfGames
      .filter((game) => game.title.toLocaleLowerCase().includes(query))
      .map((game) => game.id)
    : null;

  window.aislesSnapshot = {
    consoles: state.library?.consoles ?? [],
    selectedConsoleId: state.selectedConsoleId,
    platform: console,
    // Search changes only this visibility set. Shelf furniture and cases stay mounted
    // so non-matches can animate out instead of blinking through a full rebuild.
    games: shelfGames,
    visibleGameIds,
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
  // A concrete console IS the toolbar filter, so the two move together whichever
  // way the user goes: lineup, fallback list, right-click menu or toolbar chip.
  state.consoleFilterId = consoleId;
  state.selectedGameId = null;
  state.shelfFocusedId = null;
  state.shelfBay = 1;
  renderConsoles();
  renderGames();
  renderHero();
  publishSnapshot();
  setBrowseStatus();
  saveBrowsePreference();
  post('selectConsole', { consoleId });
}

// The 3D lineup clicks back into the same selection path as the list.
window.aislesSelectConsole = selectConsole;

/**
 * Selects a result found under All without overwriting the All filter: re-homes the
 * console, tells the host, and keeps the visible filter as All.
 */
function adoptConsoleForGame(consoleId) {
  state.selectedConsoleId = consoleId;
  renderConsoles();
  post('selectConsole', { consoleId });
}

function selectEntry(entry) {
  if (state.launchingGameId) {
    return;
  }

  if (entry.console.id !== state.selectedConsoleId) {
    adoptConsoleForGame(entry.console.id);
  }

  state.selectedGameId = entry.game.id;
  post('selectGame', { gameId: entry.game.id });
  markSelectedRows();
  renderHero();
  publishSnapshot();
}

function launchEntry(entry) {
  if (state.launchingGameId) {
    return;
  }

  if (entry.console.id !== state.selectedConsoleId) {
    adoptConsoleForGame(entry.console.id);
  }

  launchGame(entry.game.id);
}

function selectGame(gameId) {
  if (state.launchingGameId) {
    return;
  }

  state.selectedGameId = gameId;
  post('selectGame', { gameId });
  markSelectedRows();
  renderHero();
  publishSnapshot();
  syncShelfListbox();
}

function clearGameSelection() {
  if (state.launchingGameId || state.selectedGameId === null) {
    return;
  }

  state.selectedGameId = null;
  markSelectedRows();
  renderHero();
  publishSnapshot();
  syncShelfListbox();
  setBrowseStatus();
}

/**
 * Selection is marked on live rows; rebuilding between click and repaint would strand
 * focus and make Space scroll instead of acting on the pick.
 */
function markSelectedRows() {
  for (const scope of [elements.coverGrid, elements.gameList]) {
    if (!scope) continue;
    for (const node of scope.querySelectorAll('li[role="option"]')) {
      node.setAttribute('aria-selected', String(node.dataset.gameId === state.selectedGameId));
    }
  }
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
  renderGames();
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

/* The selected-game case and medium use the same millimetre table as the shelf. */

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
  section.className = 'detail-section detail-information';

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
  section.className = 'detail-section detail-played';

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

function achievementDate(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function achievementBadge(achievement, pending) {
  const badge = document.createElement('span');
  badge.className = pending
    ? 'detail-achievement-badge is-pending'
    : 'detail-achievement-badge';
  badge.setAttribute('role', 'img');

  const title = typeof achievement.title === 'string' && achievement.title.trim()
    ? achievement.title.trim()
    : 'Achievement';
  const points = Number.isFinite(achievement.points) ? achievement.points : 0;
  const earnedOn = achievementDate(achievement.earnedOn);
  const lines = [title];

  if (typeof achievement.description === 'string' && achievement.description.trim()) {
    lines.push(achievement.description.trim());
  }

  const meta = [];
  if (points > 0) {
    meta.push(`${points} pts`);
  }
  meta.push(pending ? 'Not unlocked yet' : (earnedOn ? `Unlocked ${earnedOn}` : 'Unlocked'));
  lines.push(meta.join(' · '));

  badge.title = lines.join('\n');
  badge.setAttribute('aria-label', lines.join('. '));

  const fallback = document.createElement('span');
  fallback.className = 'detail-achievement-fallback';
  fallback.setAttribute('aria-hidden', 'true');
  fallback.textContent = title.charAt(0).toUpperCase();
  badge.append(fallback);

  if (typeof achievement.badgeUrl === 'string' && achievement.badgeUrl.length > 0) {
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.remove(), { once: true });
    image.src = achievement.badgeUrl;
    badge.append(image);
  }

  if (pending) {
    const lock = document.createElement('span');
    lock.className = 'detail-achievement-lock';
    lock.setAttribute('aria-hidden', 'true');
    badge.append(lock);
  }

  return badge;
}

function achievementGroup(label, achievements, pending) {
  const group = document.createElement('div');
  group.className = 'detail-achievement-group';

  const caption = document.createElement('span');
  caption.className = 'detail-achievement-label';
  caption.textContent = label;
  group.append(caption);

  for (const achievement of achievements) {
    group.append(achievementBadge(achievement, pending));
  }

  return group;
}

function achievementStrip(achievements) {
  const recent = Array.isArray(achievements.recent) ? achievements.recent : [];
  const pending = Array.isArray(achievements.pending) ? achievements.pending : [];

  if (recent.length === 0 && pending.length === 0) {
    return null;
  }

  const strip = document.createElement('div');
  strip.className = 'detail-achievement-strip';

  if (recent.length > 0) {
    strip.append(achievementGroup('RECENT', recent, false));
  }
  if (pending.length > 0) {
    strip.append(achievementGroup('LOCKED', pending, true));
  }

  return strip;
}

function achievementsSection(game) {
  const section = document.createElement('section');
  section.className = 'detail-section detail-achievements';

  const achievements = game.achievements ?? { state: 'notLinked' };
  section.dataset.provider = achievements.source === 'rpcs3'
    || achievements.state === 'local'
    || achievements.state === 'noTrophies'
    ? 'rpcs3'
    : 'retroachievements';
  const row = document.createElement('div');
  row.className = 'detail-line';
  const value = document.createElement('span');
  value.className = 'detail-value';
  const note = document.createElement('span');
  note.className = 'detail-source';

  if (achievements.state === 'linked' || achievements.state === 'local') {
    const isLocal = achievements.state === 'local';
    const unit = isLocal && typeof achievements.unit === 'string' && achievements.unit.trim()
      ? achievements.unit.trim()
      : 'achievements';
    const hasProgress = Number.isFinite(achievements.total)
      && Number.isFinite(achievements.earned)
      && achievements.total > 0;
    const earned = hasProgress ? achievements.earned : 0;
    const total = hasProgress ? achievements.total : 0;
    value.textContent = hasProgress
      ? `${earned} of ${total} ${unit}`
      : (isLocal ? 'Trophies' : 'Linked');
    note.textContent = hasProgress
      ? (isLocal
        ? (achievements.note ?? '')
        : (Number.isFinite(achievements.points) ? `${achievements.points} pts` : ''))
      : (achievements.note ?? 'Progress not available');

    const track = document.createElement('div');
    track.className = 'detail-progress';
    const fill = document.createElement('span');
    fill.style.width = `${hasProgress ? Math.min(100, (earned / total) * 100) : 0}%`;
    track.append(fill);

    row.append(value, note);
    section.append(detailHeading('ACHIEVEMENTS'), row, track);

    const strip = achievementStrip(achievements);
    if (strip) {
      section.append(strip);
    }
  } else if (achievements.state === 'noTrophies') {
    value.textContent = 'No trophies';
    note.textContent = achievements.note ?? 'No trophy data in RPCS3';
    row.append(value, note);
    section.append(detailHeading('ACHIEVEMENTS'), row);
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

function launchReadiness(console) {
  if (!console?.emulatorExists) {
    return {
      state: 'unavailable',
      label: 'EMULATOR UNAVAILABLE',
      detail: 'Choose a working emulator in Settings',
    };
  }

  if (console.requiresCore && !console.coreReady) {
    return {
      state: 'needs-core',
      label: 'CORE REQUIRED',
      detail: 'Choose a working RetroArch core in Settings',
    };
  }

  return {
    state: 'ready',
    label: 'READY TO BOOT',
    detail: `${console.emulatorName} configured`,
  };
}

function launchDeck(console, game, launch) {
  const deck = document.createElement('section');
  deck.className = 'launch-deck';

  const header = document.createElement('header');
  header.className = 'launch-deck-head';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'launch-deck-eyebrow';
  eyebrow.textContent = `${console?.shortName ?? 'LIBRARY'} · SELECTED TITLE`;

  const title = document.createElement('h1');
  title.className = 'launch-deck-title';
  title.textContent = game.title;

  const meta = document.createElement('div');
  meta.className = 'launch-deck-meta';
  meta.textContent = console ? `${console.name} · ${console.year}` : '';
  header.append(eyebrow, title, meta);

  const readiness = launchReadiness(console);
  const status = document.createElement('div');
  status.className = `launch-deck-status is-${readiness.state}`;
  const light = document.createElement('span');
  light.className = 'launch-deck-light';
  light.setAttribute('aria-hidden', 'true');
  const statusText = document.createElement('span');
  statusText.textContent = readiness.label;
  const statusDetail = document.createElement('span');
  statusDetail.className = 'launch-deck-status-detail';
  statusDetail.textContent = readiness.detail;
  status.append(light, statusText, statusDetail);

  launch.classList.add('launch-deck-boot');
  launch.textContent = state.launchingGameId === game.id ? 'STARTING…' : 'INSERT & BOOT';
  launch.setAttribute(
    'aria-label',
    readiness.state === 'ready'
      ? `Insert ${game.title} and boot with ${console?.emulatorName ?? 'the configured emulator'}`
      : `${readiness.label}. ${readiness.detail}`,
  );
  launch.disabled = state.launchingGameId === game.id || readiness.state !== 'ready';

  if (readiness.state !== 'ready' && console) {
    const fix = document.createElement('button');
    fix.type = 'button';
    fix.className = 'launch-deck-fix';
    fix.textContent = 'OPEN SETTINGS';
    fix.addEventListener('click', () => openSettings(console.id));
    deck.append(header, detailsRail(console, game), status, fix, launch);
    return deck;
  }

  deck.append(header, detailsRail(console, game), status, launch);
  return deck;
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

function updateHeroLayout() {
  // Keeping this column stable lets browse views move on the compositor without
  // resizing and rerendering the shelf underneath them.
  elements.stageRow.removeAttribute('data-hero-collapsed');
}

function renderHero() {
  if (!elements.hero) {
    return;
  }

  updateHeroLayout();

  elements.hero.removeAttribute('aria-hidden');

  const console = currentConsole();
  const game = console?.games.find((entry) => entry.id === state.selectedGameId) ?? null;
  elements.hero.replaceChildren();

  if (!game) {
    const stage = document.createElement('div');
    stage.className = 'hero-stage hero-stage-empty';
    stage.textContent = !console
      ? 'Pick a console'
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

  const launch = document.createElement('button');
  launch.className = 'launch';
  launch.type = 'button';
  const launching = state.launchingGameId === game.id;
  launch.textContent = launching ? 'STARTING…' : 'INSERT & BOOT';
  launch.disabled = launching;
  launch.addEventListener('click', () => launchGame(game.id));

  elements.hero.append(row, launchDeck(console, game, launch));

  const preset = presetFor(console);
  const [caseWidth, caseHeight] = preset?.case ?? [135, 190];
  const mediumWidth = preset?.medium.size[0] ?? 120;
  const mediumHeight = preset?.medium.kind === 'card' ? preset.medium.size[1] : mediumWidth;
  const gap = 20;
  const layout = document.createElement('div');
  layout.className = 'pixel-hero-layout';
  layout.style.aspectRatio = `${caseWidth + gap + mediumWidth} / ${caseHeight}`;
  layout.style.setProperty('--layout-ratio', (caseWidth + gap + mediumWidth) / caseHeight);
  layout.style.setProperty('--case-width', `${caseWidth / (caseWidth + gap + mediumWidth) * 100}%`);
  layout.style.setProperty('--medium-width', `${mediumWidth / (caseWidth + gap + mediumWidth) * 100}%`);
  layout.style.setProperty('--medium-height', `${mediumHeight / caseHeight * 100}%`);
  const cover = artwork(game, 'pixel-hero-cover');
  const medium = document.createElement('div');
  medium.className = `pixel-hero-medium${preset?.medium.kind === 'card' ? ' cartridge' : ''}${launching ? ' is-launching' : ''}`;
  if (game.mediumLabelUrl) {
    const image = document.createElement('img');
    image.src = game.mediumLabelUrl;
    image.alt = '';
    image.addEventListener('error', () => image.remove(), { once: true });
    medium.append(image);
  }
  layout.append(cover, medium);
  stage.append(layout);
}

/* Shelf keyboard: a semantic listbox mirroring the pixel shelf's selection, page and
   filter, so arrow keys and the accessibility tree stay in sync. */

function shelfOptionId(gameId) {
  return `shelf-option-${encodeURIComponent(String(gameId))}`;
}

function syncShelfListbox() {
  const console = currentConsole();
  const first = (state.shelfBay - 1) * state.shelfPerBay;
  const query = state.gameFilter.trim().toLocaleLowerCase();
  const games = (console?.games ?? [])
    .slice(first, first + state.shelfPerBay)
    .filter((game) => !query || game.title.toLocaleLowerCase().includes(query));
  if (!games.some((game) => game.id === state.shelfFocusedId)) {
    state.shelfFocusedId = games.find((game) => game.id === state.selectedGameId)?.id ?? games[0]?.id ?? null;
  }
  const signature = console
    ? `${console.id}|${state.shelfBay}|${games.map((g) => g.id).join(',')}|${state.selectedGameId ?? ''}|${state.shelfFocusedId ?? ''}`
    : null;

  if (shelfListboxBuiltFor === signature) {
    for (const option of elements.shelfListbox.querySelectorAll('[role="option"]')) {
      option.setAttribute('aria-selected', String(option.dataset.gameId === state.selectedGameId));
    }
    const activeId = state.shelfFocusedId ? shelfOptionId(state.shelfFocusedId) : '';
    if (activeId) elements.shelfCanvas.setAttribute('aria-activedescendant', activeId);
    else elements.shelfCanvas.removeAttribute('aria-activedescendant');
    return;
  }

  shelfListboxBuiltFor = signature;
  elements.shelfListbox.replaceChildren();

  if (!console || games.length === 0) {
    elements.shelfCanvas.removeAttribute('aria-activedescendant');
    elements.shelfCanvas.removeAttribute('aria-owns');
    return;
  }

  const optionIds = [];
  for (const game of games) {
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    option.tabIndex = -1;
    option.dataset.gameId = game.id;
    option.id = shelfOptionId(game.id);
    optionIds.push(option.id);
    option.textContent = game.title;
    option.setAttribute('aria-selected', String(game.id === state.selectedGameId));
    elements.shelfListbox.append(option);
  }

  elements.shelfCanvas.setAttribute('aria-owns', optionIds.join(' '));
  elements.shelfCanvas.setAttribute('aria-activedescendant', shelfOptionId(state.shelfFocusedId));
}

function initShelfKeyboard() {
  elements.shelfCanvas.addEventListener('keydown', (event) => {
    const console = currentConsole();
    const first = (state.shelfBay - 1) * state.shelfPerBay;
    const query = state.gameFilter.trim().toLocaleLowerCase();
    const games = (console?.games ?? [])
      .slice(first, first + state.shelfPerBay)
      .filter((game) => !query || game.title.toLocaleLowerCase().includes(query));
    if (!games.length) return;

    let index = games.findIndex((g) => g.id === state.shelfFocusedId);
    if (index < 0) index = games.findIndex((g) => g.id === state.selectedGameId);
    if (index < 0) index = 0;

    let next = index;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = Math.min(index + 1, games.length - 1);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = Math.max(index - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = games.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      window.aislesSelectGame(games[index].id);
      return;
    } else if (event.key === 'Escape') {
      event.preventDefault();
      window.aislesClearGameSelection();
      return;
    } else {
      return;
    }

    event.preventDefault();
    if (next !== index) {
      state.shelfFocusedId = games[next].id;
      syncShelfListbox();
      setStatus(`Shelf: ${games[next].title}`);
    }
  });

}

window.addEventListener('aisles:media-presets-ready', renderHero);

/* Pager */

function renderPager(detail) {
  if (!elements.shelfLabel || !elements.shelfPager) {
    return;
  }

  const shelves = detail?.bays ?? 1;
  const bay = detail?.bay ?? 1;
  const games = detail?.games ?? 0;
  const perBay = detail?.perBay ?? 18;
  state.shelfBay = bay;
  state.shelfPerBay = perBay;

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
          ? 'This shelf is empty. Choose a games folder below, then rescan.'
          : 'Select a case, then INSERT & BOOT to play. Use Ctrl+K to filter this console.'
        : remaining > 0
          ? `${Math.max(0, remaining)} more games open Shelf ${bay + 1}. The bay slides and the consoles stay put.`
          : 'Wheel, drag or the arrow keys page the shelf. The consoles stay put.';
  }
}

window.addEventListener('aisles:shelf', (event) => {
  renderPager(event.detail);
  syncShelfListbox();
});

/* Window mode. The stage opens maximized; F11 toggles full screen and Escape
   returns to the maximized window. */

let fullScreen = false;

function setFullScreen(next) {
  fullScreen = next;
  post('windowMode', { fullScreen });
}

window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === 'k' && !settings.open) {
    event.preventDefault();
    elements.gameFilter.focus();
  } else if (event.key === 'Escape' && !elements.consoleMenu.hidden) {
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

/* Host messages */

function onLibrary(payload) {
  clearTimeout(startupScanTimer);
  startupScanTimer = 0;
  const firstLibrary = !state.library || Boolean(state.library.error);
  const updateLibraryStatus = firstLibrary || elements.status.textContent.startsWith('Library loaded');
  state.library = payload;

  const consoles = payload.consoles ?? [];
  const preference = firstLibrary ? loadBrowsePreference() : null;

  if (payload.error) {
    showStartupError(payload.error);
    setBadge('bridge: catalog error', 'error');
  } else {
    resolveStartup();
    showBadge(false);

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


  // Restore the last concrete console and view when possible; a removed console
  // falls back to the same first-populated choice as a fresh install.
  if (preference?.consoleId && consoles.some((console) => console.id === preference.consoleId)) {
    state.selectedConsoleId = preference.consoleId;
  }
  if (preference && ['shelf', 'covers', 'list'].includes(preference.viewMode)) {
    state.viewMode = preference.viewMode;
  }

  const stillValid = consoles.some((console) => console.id === state.selectedConsoleId);
  if (!stillValid) {
    const firstPopulated = consoles.find((console) => console.games.length > 0) ?? consoles[0];
    state.selectedConsoleId = firstPopulated?.id ?? null;
  }

  // The first populated library lands on the console the shelf will show; later
  // refreshes keep the user's filter while it names an existing console.
  if (firstLibrary) {
    state.consoleFilterId = state.selectedConsoleId;
  }
  if (state.consoleFilterId !== null && !consoles.some((c) => c.id === state.consoleFilterId)) {
    state.consoleFilterId = null;
  }
  // All combines consoles, so the single-platform shelf renderer is out of scope.
  if (state.consoleFilterId === null && state.viewMode === 'shelf') {
    state.viewMode = 'covers';
  }

  const selectedGameStillExists = consoles.some(console =>
    console.games.some(game => game.id === state.selectedGameId),
  );
  if (!selectedGameStillExists) state.selectedGameId = null;

  renderConsoles();
  renderGames();
  renderHero();
  publishSnapshot();
  scheduleSpatialUi();
  scheduleStartupArtwork();
  requestAnimationFrame(() => post('libraryRendered'));
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
      elements.hero?.querySelector('.pixel-hero-medium')?.classList.remove('is-launching');
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

elements.startupRetry.addEventListener('click', retryStartup);
elements.startupSettings.addEventListener('click', () => openSettings());

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
          corePath: console.corePath,
          installedGamesPath: console.installedGamesPath,
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
        // A console requested via openSettings(consoleId) wins over the previously
        // selected one; fall back to the current selection, then the first console.
        const requested = settings.pendingConsoleId;
        settings.pendingConsoleId = null;
        const requestedExists = requested && payload.consoles.some((c) => c.id === requested);
        settings.selectedId = requestedExists
          ? requested
          : payload.consoles.some((c) => c.id === state.selectedConsoleId)
            ? state.selectedConsoleId
            : payload.consoles[0]?.id;
        renderSettingsNavigation();
        renderSettingsEditor();
        setSettingsBusy(false);
        if (payload.error) setSettingsError(payload.error);
        if (requestedExists) {
          document.getElementById(`settings-${requested}-gamesPath`)?.focus();
        } else {
          elements.settingsClose.focus();
        }
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
  initShelfKeyboard();

  startup();
} else {
  // Opened in a plain browser instead of the Aisles host: say so rather than
  // silently rendering an empty shell.
  showStartupError('This page is designed to run inside Aisles (WebView2).', false);
  setBadge('bridge: not connected', 'error');
}
