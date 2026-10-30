const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/Aisles.App/wwwroot/browse-motion.js', 'utf8')
  .replace('export ', '');
const { browseMotion } = vm.runInNewContext(`${source}\n({ browseMotion })`);

assert.match(browseMotion('shelf', 'covers').incoming[0].transform, /100%/);
assert.match(browseMotion('list', 'shelf').outgoing[1].transform, /0, 100%/);
assert.match(browseMotion('covers', 'list').outgoing[1].transform, /-100%/);
assert.match(browseMotion('list', 'covers').outgoing[1].transform, /100%/);
console.log('Browse motion: shelf reveal, vertical overlays and horizontal swipes passed.');
