const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/Aisles.App/wwwroot/media-presets.js', 'utf8')
  .replaceAll('export ', '');
const { presetFor } = vm.runInNewContext(`${source}\n({ presetFor })`);
const ds = presetFor({ id: 'ds' });
const ps2 = presetFor({ id: 'ps2', media: 'DvdCase' });
const gamecube = presetFor({ id: 'gamecube' });
assert.equal(ds.case[0] / ds.case[1], 135 / 122);
assert.equal(ds.medium.size[0] / ds.case[0], 33 / 135);
assert.equal(ds.medium.size[1] / ds.case[1], 35 / 122);
assert.equal(ps2.medium.size[0] / ps2.case[1], 120 / 190);
assert.equal(gamecube.medium.size[0], 80);
assert.equal(presetFor({ media: 'JewelCase' }).case[0], 142);
