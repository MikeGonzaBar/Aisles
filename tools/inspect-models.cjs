// Read-only structural audit of the downloaded GLB assets.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../3d models');
const reports = [];
for (const dir of fs.readdirSync(root)) {
  for (const file of fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.glb'))) {
    const b = fs.readFileSync(path.join(root, dir, file));
    if (b.toString('ascii', 0, 4) !== 'glTF') throw Error(file + ': invalid magic');
    const g = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)).trim());
    const binStart = 20 + b.readUInt32LE(12) + 8;
    const vertexColors = [];
    for (const mesh of g.meshes || []) for (const p of mesh.primitives) {
      if (p.attributes.COLOR_0 === undefined) continue;
      const a = g.accessors[p.attributes.COLOR_0], v = g.bufferViews[a.bufferView];
      const components = a.type === 'VEC4' ? 4 : 3;
      const width = ({5121:1,5123:2,5126:4})[a.componentType];
      if (!width) continue;
      const colors = new Set();
      for(let i=0;i<a.count;i++) {
        const offset = binStart+(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||width*components);
        const color=[];
        for(let c=0;c<components;c++)color.push(a.componentType===5126?b.readFloatLE(offset+c*width):a.componentType===5123?b.readUInt16LE(offset+c*width):b[offset+c]);
        colors.add(color.join(','));
      }
      vertexColors.push({mesh:mesh.name,componentType:a.componentType,normalized:a.normalized,uniqueColors:colors.size,sample:[...colors].slice(0,8)});
    }
    const images = (g.images || []).map(im => {
      const v = g.bufferViews?.[im.bufferView];
      const data = v ? b.subarray(binStart + (v.byteOffset || 0), binStart + (v.byteOffset || 0) + v.byteLength) : null;
      let dimensions = null;
      if (data?.subarray(1, 4).toString() === 'PNG') dimensions = [data.readUInt32BE(16), data.readUInt32BE(20)];
      if (data?.readUInt16BE(0) === 0xffd8) {
        let p = 2;
        while (p + 8 < data.length) {
          if (data[p] !== 255) break;
          const marker = data[p + 1], len = data.readUInt16BE(p + 2);
          if ([0xc0,0xc1,0xc2].includes(marker)) { dimensions = [data.readUInt16BE(p+7),data.readUInt16BE(p+5)]; break; }
          if (len < 2) break;
          p += 2 + len;
        }
      }
      return {name:im.name, mime:im.mimeType, dimensions, bytes:v?.byteLength, uri:im.uri};
    });
    const meshes = (g.meshes || []).map((m, i) => ({
      index:i, name:m.name,
      primitives:m.primitives.map(p => ({
        mode:p.mode ?? 4, attributes:Object.keys(p.attributes), vertices:g.accessors[p.attributes.POSITION]?.count,
        triangles:(p.mode === undefined || p.mode === 4) ? (g.accessors[p.indices]?.count || g.accessors[p.attributes.POSITION]?.count)/3 : null,
        material:p.material, bounds:[g.accessors[p.attributes.POSITION]?.min,g.accessors[p.attributes.POSITION]?.max], extensions:p.extensions
      }))
    }));
    reports.push({file:path.join(dir,file), bytes:b.length, version:b.readUInt32LE(4), lengthValid:b.readUInt32LE(8)===b.length,
      asset:g.asset, extensionsRequired:g.extensionsRequired, extensionsUsed:g.extensionsUsed, textures:g.textures,
      scenes:g.scenes, nodes:g.nodes, meshes, materials:g.materials, images, vertexColors,
      animations:g.animations, skins:g.skins, externalBuffers:(g.buffers||[]).filter(x=>x.uri),
      triangles:meshes.flatMap(m=>m.primitives).reduce((a,p)=>a+(p.triangles||0),0),
      primitives:meshes.reduce((a,m)=>a+m.primitives.length,0),
      textureMemoryMiB:images.reduce((a,im)=>a+(im.dimensions?im.dimensions[0]*im.dimensions[1]*4*4/3:0),0)/1048576
    });
  }
}
console.log(JSON.stringify(reports,null,2));
