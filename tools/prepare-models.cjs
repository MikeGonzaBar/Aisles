// Preserve geometry/materials; resize embedded images and repack the GLB buffer.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {readGlb,writeGlb,bounds,check}=require('./model-lib.cjs');
const root=path.resolve(__dirname,'..');
let sharp;
try{sharp=require('sharp');}catch{if(!process.env.AISLES_NODE_MODULES)throw Error('Install dependencies with npm install, or set AISLES_NODE_MODULES to the bundled node_modules directory.');sharp=require(path.join(process.env.AISLES_NODE_MODULES,'sharp'));}
const definitions=[['ps1','PS1/sony_playstation_one.glb','PlayStation'],['ps2','PS2/playstation_2.glb','PlayStation 2'],['ps3','PS3/classic_ps3.glb','PlayStation 3'],['wii','wii/nintendo_wii_rvl-001.glb','Nintendo Wii'],['ds','nintendoDs/nintendo_ds_lite.glb','Nintendo DS Lite'],['xbox360','xbox360/xbox_360_black.glb','Xbox 360']];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const models=[];
 for(const[id,source,name]of definitions){
 const sourcePath=path.join(root,'3d models',source),before=fs.readFileSync(sourcePath),{json:g,bin}=readGlb(sourcePath);
 const issues=check(g,bin);if(issues.length)throw Error(source+': '+issues.join('; '));
 const imageByView=new Map((g.images||[]).map((im,i)=>[im.bufferView,i]));const images=[],chunks=[];let offset=0;
 for(const[index,v]of g.bufferViews.entries()){
 const start=v.byteOffset||0;let data=bin.subarray(start,start+v.byteLength);
 if(imageByView.has(index)){
 const im=g.images[imageByView.get(index)],meta=await sharp(data).metadata();
 const resize=meta.width>2048||meta.height>2048;
 if(resize)data=await sharp(data).resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 const after=await sharp(data).metadata();if(resize)im.mimeType='image/png';
 images.push({before:[meta.width,meta.height],after:[after.width,after.height],resized:resize});
 }
 const pad=(4-offset%4)%4;if(pad){chunks.push(Buffer.alloc(pad));offset+=pad;}v.byteOffset=offset;v.byteLength=data.length;chunks.push(data);offset+=data.length;
 }
 const packed=Buffer.concat(chunks);g.buffers[0].byteLength=packed.length;
 const materialChanges=[];
 if(id==='ps2'){
 const body=(g.materials||[]).find(material=>material.name==='Playstaion_Base_Plastic');
 if(!body)throw Error('PS2 body material not found');
 const from=body.alphaMode||'OPAQUE';body.alphaMode='MASK';body.alphaCutoff=0.5;
 materialChanges.push({material:body.name,from,to:'MASK',alphaCutoff:0.5,reason:'Solid shell uses a mostly binary opacity map; MASK avoids transparent-object sorting artifacts while retaining cutouts.'});
 }
 const materialReview=[];
 for(const material of g.materials||[])if(material.alphaMode==='BLEND'){
 const info=material.pbrMetallicRoughness?.baseColorTexture;
 if(info){const image=g.images[g.textures[info.index].source],view=g.bufferViews[image.bufferView],data=packed.subarray(view.byteOffset,view.byteOffset+view.byteLength),meta=await sharp(data).metadata(),stats=await sharp(data).stats();
 materialReview.push({name:material.name,alphaMode:'BLEND',hasAlpha:meta.hasAlpha,isOpaque:stats.isOpaque,alphaRange:meta.hasAlpha?[stats.channels.at(-1).min,stats.channels.at(-1).max]:null,decision:'Retain pending visual review; nonopaque pixels may be intentional.'});}
 }
 const targetDir=path.join(root,'assets/models',id);fs.mkdirSync(targetDir,{recursive:true});const target=path.join(targetDir,'console.glb');writeGlb(target,g,packed);
 const result=readGlb(target);if(check(result.json,result.bin).length)throw Error('Output validation failed: '+id);
 // Enforce byte-for-byte preservation of geometry, UVs and all non-image views.
 const original=readGlb(sourcePath);
 for(let i=0;i<g.bufferViews.length;i++)if(!imageByView.has(i)){const a=original.json.bufferViews[i],b=g.bufferViews[i];if(!original.bin.subarray(a.byteOffset||0,(a.byteOffset||0)+a.byteLength).equals(packed.subarray(b.byteOffset,b.byteOffset+b.byteLength)))throw Error('Geometry changed: '+id);}
 if(!fs.readFileSync(sourcePath).equals(before))throw Error('Source changed');
 const box=bounds(g),scale=2.3/Math.max(...box.size),translation=[-(box.min[0]+box.max[0])/2*scale,-box.min[1]*scale,-(box.min[2]+box.max[2])/2*scale];
 const existingPath=path.join(root,'assets/models/catalog.json');const previous=fs.existsSync(existingPath)?JSON.parse(fs.readFileSync(existingPath)).models.find(m=>m.id===id):null;
 const sourceSha256=hash(before);
 const placement=previous?.sourceSha256===sourceSha256?previous.placement:{rotationDegrees:[0,0,0],scale,translation};
 const triangles=g.meshes.flatMap(m=>m.primitives).reduce((sum,p)=>sum+(g.accessors[p.indices??p.attributes.POSITION].count/3),0);
 const extras=g.asset.extras;
 models.push({id,name,source:'/3d models/'+source,runtime:'/assets/models/'+id+'/console.glb',placement,bounds:box,triangles,primitives:g.meshes.reduce((s,m)=>s+m.primitives.length,0),sourceBytes:before.length,runtimeBytes:fs.statSync(target).size,sourceSha256,runtimeSha256:hash(fs.readFileSync(target)),images,estimatedTextureMiB:images.reduce((s,im)=>s+im.after[0]*im.after[1]*4*4/3/1048576,0),credit:{author:extras.author,title:extras.title,source:extras.source,license:extras.license},commercialRestricted:id==='ps2',materialChanges,materialReview,visualStatus:'pending'});
 console.log(`${id}: ${(before.length/1048576).toFixed(2)} → ${(fs.statSync(target).size/1048576).toFixed(2)} MiB; ${images.filter(i=>i.resized).length} images resized`);
 }
 fs.writeFileSync(path.join(root,'assets/models/catalog.json'),JSON.stringify({schemaVersion:1,notes:'Placement defaults are computed from transformed scene bounds. Visual orientation needs review.',models},null,2)+'\n');
 fs.writeFileSync(path.join(root,'assets/models/ATTRIBUTION.md'),'# Console model credits\n\n'+models.map(m=>`## ${m.name}\n\n- Title: ${m.credit.title}\n- Creator: ${m.credit.author}\n- Source: ${m.credit.source}\n- License: ${m.credit.license}\n- Modifications: ${m.images.some(i=>i.resized)?'Embedded textures resized to a maximum of 2048 pixels; buffer repacked.':'Buffer repacked without texture resizing.'}${m.materialChanges.length?' Material adjustments: '+m.materialChanges.map(c=>`${c.material} ${c.from} to ${c.to}${c.alphaCutoff!==undefined?` at cutoff ${c.alphaCutoff}`:''}`).join('; ')+'.':''}\n`).join('\n'));
})().catch(e=>{console.error(e);process.exitCode=1});
