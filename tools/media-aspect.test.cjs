const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/Aisles.App/wwwroot/media.js', 'utf8');
const match = source.match(/export function containedBounds\([\s\S]*?\r?\n}\r?\n\r?\n\/\*\*/);
assert.ok(match, 'containedBounds is exported from media.js');
const containedBounds = vm.runInNewContext(`(${match[0].slice(0, -3).replace('export ', '')})`);

assert.equal(JSON.stringify(containedBounds(1481 / 1707, 129 / 166)), JSON.stringify({
  x: 0,
  y: (1 - (129 / 166) / (1481 / 1707)) / 2,
  width: 1,
  height: (129 / 166) / (1481 / 1707),
}));
assert.equal(JSON.stringify(containedBounds(1, 1)), JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }));
