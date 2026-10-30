const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise the actual renderer and interrupted animation promises without a
// browser dependency. Desktop inspection remains necessary for visual quality.
class Element {
  children = []; dataset = {}; attributes = {}; listeners = {};
  style = { setProperty() {} };
  classList = { toggle() {}, add() {} };
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  prepend(node) { node.parent = this; this.children.unshift(node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, fn) { this.listeners[key] = fn; }
  getBoundingClientRect() { return { width: 1200, height: 800 }; }
  animate() {
    let finish, reject;
    const animation = { finished: new Promise((yes, no) => { finish = yes; reject = no; }),
      cancel() { reject(); }, finish() { finish(); } };
    return animation;
  }
}

async function test() {
  const shelf = new Element(), lineup = new Element(), pager = new Element();
  const listeners = {}, preference = { matches: false, addEventListener(_, fn) { this.change = fn; } };
  const consoles = ['ps2', 'wii', 'ps1'].map(id => ({ id, name: id, shortName: id,
    gamesPathExists: true, games: Array.from({ length: 70 }, (_, i) => ({ id: `${id}-${i}`, title: `Game ${i}` })) }));
  let announced;
  const window = { addEventListener(key, fn) { listeners[key] = fn; },
    dispatchEvent(event) { if (event.type === 'aisles:shelf') announced = event.detail; } };
  function select(index) {
    const platform = consoles[index];
    window.aislesSnapshot = { consoles, platform, selectedConsoleId: platform.id, games: platform.games };
    listeners['aisles:update']?.();
  }
  select(0);
  const source = fs.readFileSync('src/Aisles.App/wwwroot/pixel-ui.js', 'utf8').replace(/^import .*;$/m, '');
  vm.runInNewContext(source, { window, document: {
    getElementById(id) { return { 'stage-labels': lineup, 'shelf-canvas': shelf, 'shelf-pager': pager }[id]; },
    createElement() { return new Element(); } },
    presetFor() { return { case: [135, 190] }; }, matchMedia() { return preference; },
    getComputedStyle() { return { transform: 'matrix(1,0,0,1,10,0)', opacity: '.6' }; },
    CustomEvent: class { constructor(type, data) { this.type = type; this.detail = data?.detail; } },
    Event: class { constructor(type) { this.type = type; } },
    ResizeObserver: class { observe() {} }, requestAnimationFrame() {}, cancelAnimationFrame() {},
  });
  const cabinet = shelf.children[0], rows = cabinet.children[1].children;
  const firstLayer = rows[0].children[0], firstCase = firstLayer.children[0];
  window.aislesSnapshot.selectedGameId = 'ps2-0';
  listeners['aisles:update']();
  assert.equal(rows[0].children[0], firstLayer, 'selection retains row');
  assert.equal(firstLayer.children[0], firstCase, 'selection retains case');
  assert.equal(firstCase.dataset.selected, 'true');
  select(1); select(2); select(0);
  assert.equal(shelf.children[0], cabinet, 'cabinet stays mounted');
  assert.ok(rows.every(row => row.children.length === 2), 'interruptions bound layer count');
  assert.equal(rows[0].children[1].children[0].dataset.gameId, 'ps2-0', 'latest console wins');
  pager.listeners.click({ target: { closest() { return { dataset: { page: '1' } }; } } });
  assert.equal(announced.bay, 2);
  assert.equal(rows[0].children[1].children[0].dataset.gameId, `ps2-${announced.perBay}`);
  pager.listeners.click({ target: { closest() { return { dataset: { page: '-1' } }; } } });
  assert.equal(announced.bay, 1);
  preference.matches = true;
  preference.change();
  assert.ok(rows.every(row => row.children.length === 1), 'reduced motion settles departures');
  select(1);
  assert.ok(rows.every(row => row.children.length === 1), 'reduced motion swaps immediately');
  await Promise.resolve();
  assert.ok(rows.every(row => row.children.length === 1), 'stale completions cannot remove current layers');
  console.log('Pixel shelf: persistence, interrupted switching, paging and reduced motion passed.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
