// Focused OBJ -> GLB converter for static models with one-to-one v/vt/vn indices.
// It merges OBJ groups into one primitive to avoid hundreds of draw calls.
const fs = require('fs');
const path = require('path');
const { writeGlb } = require('./model-lib.cjs');

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node tools/convert-obj-to-glb.cjs input.obj output.glb');

const positions = [], normals = [], uvs = [], indices = [];
let groups = 0;
// Rhino may wrap long face records with a trailing backslash.
const source = fs.readFileSync(input, 'utf8').replace(/\\\s*\r?\n/g, ' ');
for (const line of source.split(/\r?\n/)) {
  if (line.startsWith('v ')) positions.push(...line.slice(2).trim().split(/\s+/).map(Number));
  else if (line.startsWith('vn ')) normals.push(...line.slice(3).trim().split(/\s+/).map(Number));
  else if (line.startsWith('vt ')) uvs.push(...line.slice(3).trim().split(/\s+/).slice(0, 2).map(Number));
  else if (line.startsWith('g ')) groups++;
  else if (line.startsWith('f ')) {
    const face = line.slice(2).trim().split(/\s+/).map(token => token.split('/').map(Number));
    if (face.length < 3) continue;
    for (let i = 1; i < face.length - 1; i++) {
      for (const vertex of [face[0], face[i], face[i + 1]]) {
        const [v, vt, vn] = vertex;
        if (v !== vt || v !== vn || v <= 0) throw new Error(`Expected one-to-one positive OBJ indices; got ${vertex.join('/')} in ${line}`);
        indices.push(v - 1);
      }
    }
  }
}
const vertexCount = positions.length / 3;
if (!vertexCount || normals.length / 3 !== vertexCount || uvs.length / 2 !== vertexCount) throw new Error('OBJ attribute counts do not match');

const positionData = Buffer.from(new Float32Array(positions).buffer);
const normalData = Buffer.from(new Float32Array(normals).buffer);
const uvData = Buffer.from(new Float32Array(uvs).buffer);
const indexData = Buffer.from(new Uint32Array(indices).buffer);
const chunks = [positionData, normalData, uvData, indexData];
const offsets = []; let offset = 0;
for (const chunk of chunks) { offsets.push(offset); offset += chunk.length; }
const bin = Buffer.concat(chunks);
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  min[axis] = Math.min(min[axis], positions[i + axis]); max[axis] = Math.max(max[axis], positions[i + axis]);
}
const json = {
  asset: { version: '2.0', generator: 'Aisles focused OBJ converter', extras: {
    title: 'Xbox 360 Black', author: 'Rob Bryant Jr.',
    source: 'https://sketchfab.com/3d-models/xbox-360-black-3d-model-by-rob-bryant-jr-f65ac4721fd34dd8a8b63adfa712f5b8',
    license: 'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
    originalGroups: groups,
  } },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Xbox_360_Black' }],
  meshes: [{ name: 'Xbox_360_Black', primitives: [{
    attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0,
  }] }],
  materials: [{ name: 'Xbox_360_Black_Matte', pbrMetallicRoughness: {
    baseColorFactor: [0.018, 0.022, 0.028, 1], metallicFactor: 0.05, roughnessFactor: 0.42,
  } }],
  buffers: [{ byteLength: bin.length }],
  bufferViews: chunks.map((chunk, i) => ({ buffer: 0, byteOffset: offsets[i], byteLength: chunk.length, target: i === 3 ? 34963 : 34962 })),
  accessors: [
    { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min, max },
    { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: vertexCount, type: 'VEC2' },
    { bufferView: 3, componentType: 5125, count: indices.length, type: 'SCALAR' },
  ],
};
fs.mkdirSync(path.dirname(output), { recursive: true });
writeGlb(output, json, bin);
console.log(`${path.basename(output)}: ${vertexCount.toLocaleString()} vertices, ${(indices.length / 3).toLocaleString()} triangles, ${groups} groups merged into 1 primitive`);
