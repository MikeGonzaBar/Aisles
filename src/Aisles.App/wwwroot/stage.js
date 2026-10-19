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
  // The 3D stage is a module, so it cannot read this file's top-level bindings.
  // A snapshot plus an event is the whole contract between the two.
  window.aislesSnapshot = {
    consoles: state.library?.consoles ?? [],
    selectedConsoleId: state.selectedConsoleId,
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
}

// The 3D lineup clicks back into the same selection path as the list.
window.aislesSelectConsole = selectConsole;

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
