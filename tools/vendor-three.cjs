// Copies the Three.js build and the two addons the stage needs out of node_modules
// into the app's web root, so the app runs fully offline with no CDN and no bare
// specifiers (PLAN.md section 5.3).
//
// The output is committed: the app must run from a clean build without npm install.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const threeRoot = path.join(root, 'node_modules/three');
const vendorRoot = path.join(root, 'src/Aisles.App/wwwroot/vendor');

const files = [
  ['build/three.module.min.js', 'three.module.min.js'],
  // three.module.min.js is a thin re-export over this file; both must ship.
  ['build/three.core.min.js', 'three.core.min.js'],
  ['examples/jsm/loaders/GLTFLoader.js', 'addons/loaders/GLTFLoader.js'],
  ['examples/jsm/utils/BufferGeometryUtils.js', 'addons/utils/BufferGeometryUtils.js'],
  ['examples/jsm/environments/RoomEnvironment.js', 'addons/environments/RoomEnvironment.js'],
  ['examples/jsm/geometries/RoundedBoxGeometry.js', 'addons/geometries/RoundedBoxGeometry.js'],
  ['LICENSE', 'LICENSE-three.txt'],
];

const version = JSON.parse(fs.readFileSync(path.join(threeRoot, 'package.json'), 'utf8')).version;

for (const [from, to] of files) {
  const target = path.join(vendorRoot, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(threeRoot, from), target);
  console.log(`  ${to.padEnd(38)} ${String(fs.statSync(target).size).padStart(8)} bytes`);
}

fs.writeFileSync(
  path.join(vendorRoot, 'README.md'),
  `# Bundled web libraries

Copied from \`node_modules\` by \`tools/vendor-three.cjs\`. Do not edit here.

- three.js ${version} — MIT, see \`LICENSE-three.txt\` (https://threejs.org)
- \`addons/\` holds the unmodified addons the stage imports, kept in their
  original relative layout so their internal imports resolve.
`,
);

console.log(`\nthree.js ${version} bundled into wwwroot/vendor`);
