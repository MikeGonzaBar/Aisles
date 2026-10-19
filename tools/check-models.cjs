const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const{readGlb,check,bounds,imageSize}=require('./model-lib.cjs');
const root=path.resolve(__dirname,'..'),catalog=JSON.parse(fs.readFileSync(path.join(root,'assets/models/catalog.json')));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(catalog.models.length,6);
for(const m of catalog.models){
 const source=path.join(root,m.source.slice(1)),runtime=path.join(root,m.runtime.slice(1));
 assert.equal(hash(fs.readFileSync(source)),m.sourceSha256,m.id+' source hash');assert.equal(hash(fs.readFileSync(runtime)),m.runtimeSha256,m.id+' runtime hash');
 const a=readGlb(source),b=readGlb(runtime);assert.deepEqual(check(a.json,a.bin),[]);assert.deepEqual(check(b.json,b.bin),[]);
 // JSON serialization canonicalizes -0 to 0; compare semantic JSON, then binary views below.
 for(const key of ['accessors','meshes','nodes','scenes','textures','samplers'])assert.equal(JSON.stringify(a.json[key]),JSON.stringify(b.json[key]),m.id+' '+key);
 const expectedMaterials=structuredClone(a.json.materials||[]);
 for(const change of m.materialChanges||[]){const material=expectedMaterials.find(item=>item.name===change.material);assert.ok(material,m.id+' changed material exists');material.alphaMode=change.to;if(change.alphaCutoff!==undefined)material.alphaCutoff=change.alphaCutoff;}
 assert.equal(JSON.stringify(expectedMaterials),JSON.stringify(b.json.materials||[]),m.id+' materials');
 const images=new Set((a.json.images||[]).map(x=>x.bufferView));
 for(let i=0;i<a.json.bufferViews.length;i++)if(!images.has(i)){
 const av=a.json.bufferViews[i],bv=b.json.bufferViews[i];assert.ok(a.bin.subarray(av.byteOffset||0,(av.byteOffset||0)+av.byteLength).equals(b.bin.subarray(bv.byteOffset||0,(bv.byteOffset||0)+bv.byteLength)),m.id+' non-image view '+i);
 }
 assert.equal((b.json.images||[]).length,m.images.length);
 for(const[index,image]of m.images.entries()){
 const view=b.json.bufferViews[b.json.images[index].bufferView],dimensions=imageSize(b.bin.subarray(view.byteOffset,view.byteOffset+view.byteLength));
 assert.deepEqual(dimensions,image.after,m.id+' embedded image dimensions');assert.ok(Math.max(...dimensions)<=2048,m.id+' image cap');
 }
 assert.ok(m.placement.scale>0&&Number.isFinite(m.placement.scale));assert.ok(m.placement.translation.every(Number.isFinite));assert.equal(m.placement.rotationDegrees.length,3);
 const box=bounds(b.json);if(m.placement.rotationDegrees.every(v=>v===0)){
 assert.ok(Math.abs(box.min[1]*m.placement.scale+m.placement.translation[1])<1e-6,m.id+' floor contact');
 for(const axis of[0,2])assert.ok(Math.abs((box.min[axis]+box.max[axis])/2*m.placement.scale+m.placement.translation[axis])<1e-6,m.id+' center');
 }
 assert.equal(a.json.asset.extras.license,m.credit.license);console.log(m.id+': source hash, GLB bounds, unchanged geometry, declared material changes, image cap, placement and license OK');
}
console.log('All six prepared assets passed structural checks (not a full glTF validator or browser test).');
