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
  status: document.getElementById('status'),
  totals: document.getElementById('totals'),
};

const state = {
  library: null,
  selectedConsoleId: null,
  selectedGameId: null,
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
    }

    item.addEventListener('click', () => selectConsole(console.id));
    elements.consoleList.append(item);
  }

  const totalGames = consoles.reduce((sum, console) => sum + console.games.length, 0);
  elements.totals.textContent = `${consoles.length} consoles · ${totalGames} games`;
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
        `No games folder at ${console.gamesPath}. Create it and drop games in, or edit consoles.json.`,
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

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = game.title;

    const path = document.createElement('span');
    path.className = 'path';
    path.textContent = game.launchTarget;
    path.title = game.launchTarget;

    text.append(title, path);

    const launch = document.createElement('button');
    launch.className = 'launch';
    launch.type = 'button';
    launch.textContent = 'LAUNCH';
    launch.addEventListener('click', (event) => {
      event.stopPropagation();
      launchGame(game.id);
    });

    item.append(text, launch);

    item.addEventListener('click', () => selectGame(game.id));
    item.addEventListener('dblclick', () => launchGame(game.id));

    elements.gameList.append(item);
  }
}

function emptyState(text) {
  const element = document.createElement('li');
  element.className = 'empty';
  element.textContent = text;
  return element;
}

/* ---------- state ---------- */

function currentConsole() {
  return state.library?.consoles.find((console) => console.id === state.selectedConsoleId) ?? null;
}

function selectConsole(consoleId) {
  state.selectedConsoleId = consoleId;
  state.selectedGameId = null;
  post('selectConsole', { consoleId });
  renderConsoles();
  renderGames();
}

function selectGame(gameId) {
  state.selectedGameId = gameId;
  post('selectGame', { gameId });
  renderGames();
}

function launchGame(gameId) {
  const game = currentConsole()?.games.find((entry) => entry.id === gameId);
  if (!game) {
    return;
  }

  state.selectedGameId = gameId;
  renderGames();
  setStatus(`Launching ${game.title}…`);
  post('launchGame', { gameId });
}

/* ---------- host messages ---------- */

function onLibrary(payload) {
  state.library = payload;

  if (payload.error) {
    setBadge('bridge: catalog error', 'error');
    setStatus(payload.error, 'err');
  } else {
    setBadge('bridge OK', 'ok');
    setStatus('Library loaded from consoles.json.');
  }

  const consoles = payload.consoles ?? [];

  // Keep the current console if it still exists, otherwise start on the first
  // console that actually has games.
  const stillValid = consoles.some((console) => console.id === state.selectedConsoleId);
  if (!stillValid) {
    const firstPopulated = consoles.find((console) => console.games.length > 0) ?? consoles[0];
    state.selectedConsoleId = firstPopulated?.id ?? null;
  }

  renderConsoles();
  renderGames();
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
      case 'selectConsole':
      case 'selectGame':
      case 'scanResult':
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
