import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
window.aislesPreviewStarted=true;
const $=s=>document.querySelector(s),status=$('#status'),viewport=$('#viewport');
const fmtBytes=n=>(n/1048576).toFixed(2)+' MiB';
function rows(el,values){el.replaceChildren();for(const[label,value]of values){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;el.append(dt,dd);}}
const catalog=await(await fetch('/assets/models/catalog.json')).json();
for(const m of catalog.models){const o=document.createElement('option');o.value=m.id;o.textContent=m.name;$('#console').append(o);}
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;viewport.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#202c3e');
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;room.dispose();pmrem.dispose();
const camera=new THREE.PerspectiveCamera(36,1,.02,100);const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=.5;controls.maxDistance=16;controls.target.set(.8,.8,0);
const key=new THREE.DirectionalLight(0xfff3df,3);key.position.set(-3,6,4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-5;key.shadow.camera.right=5;key.shadow.camera.top=5;key.shadow.camera.bottom=-5;key.shadow.bias=-.0002;scene.add(key);
const fill=new THREE.HemisphereLight(0xc6dcff,0x302b27,1.4);scene.add(fill);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:0x182033,roughness:.8}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;floor.receiveShadow=true;scene.add(floor);
const shelf=new THREE.Group();scene.add(shelf);const boardMat=new THREE.MeshStandardMaterial({color:0x564439,roughness:.7});
for(let row=0;row<3;row++){
 const board=new THREE.Mesh(new THREE.BoxGeometry(1.7,.07,.48),boardMat);board.position.set(2.25,.1+row*.65,-.35);board.receiveShadow=true;shelf.add(board);
 for(let i=0;i<12;i++){const mat=new THREE.MeshStandardMaterial({color:new THREE.Color().setHSL((i*.071+row*.19)%1,.38,.38),roughness:.38});const c=new THREE.Mesh(new THREE.BoxGeometry(.105,.48,.34),mat);c.position.set(1.57+i*.123,.38+row*.65,-.35);c.castShadow=true;c.receiveShadow=true;shelf.add(c);}
}
const turntable=new THREE.Group();scene.add(turntable);
let current=null,activeModel=null,generation=0,frameTimes=[],lastTime=0,lastStats=0;
const loader=new GLTFLoader();
function dispose(root){const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures){t.dispose();t.source?.data?.close?.();}}
function reset(){camera.up.set(0,1,0);camera.position.set(4,3.0,5.5);controls.target.set(.8,.8,0);floor.visible=true;controls.update();}
reset();
function normalize(group,rotation){group.rotation.set(...rotation.map(THREE.MathUtils.degToRad));group.scale.setScalar(1);group.position.set(0,0,0);group.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(group),size=box.getSize(new THREE.Vector3()),scale=2.3/Math.max(size.x,size.y,size.z);group.scale.setScalar(scale);group.position.set(-(box.min.x+box.max.x)*scale/2,-box.min.y*scale,-(box.min.z+box.max.z)*scale/2);group.updateMatrixWorld(true);}
function wireframe(){current?.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])m.wireframe=$('#wireframe').checked;});}
async function load(){
 const token=++generation,m=catalog.models.find(m=>m.id===$('#console').value),variant=$('#variant').value;activeModel=m;
 status.textContent='Loading '+m.name+'…';if(current){turntable.remove(current);dispose(current);current=null;}turntable.rotation.y=0;renderer.render(scene,camera);frameTimes=[];
 const started=performance.now();
 try{
 const gltf=await loader.loadAsync(m[variant]);if(token!==generation){dispose(gltf.scene);return;}
 current=new THREE.Group();current.add(gltf.scene);current.rotation.set(...m.placement.rotationDegrees.map(THREE.MathUtils.degToRad));current.scale.setScalar(m.placement.scale);current.position.fromArray(m.placement.translation);
 for(const[axis,i]of[['x',0],['y',1],['z',2]])$('#r'+axis).value=m.placement.rotationDegrees[i];
 current.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});turntable.add(current);wireframe();renderer.render(scene,camera);const loadMs=performance.now()-started;
 $('#model-name').textContent=m.name;
 const textureMiB=variant==='runtime'?m.estimatedTextureMiB:m.images.reduce((s,im)=>s+im.before[0]*im.before[1]*4*4/3/1048576,0);
 rows($('#asset-stats'),[['Version',variant==='runtime'?'Prepared':'Original'],['File size',fmtBytes(variant==='runtime'?m.runtimeBytes:m.sourceBytes)],['Triangles',m.triangles.toLocaleString()],['Primitives',m.primitives],['Texture estimate',textureMiB.toFixed(0)+' MiB'],['Material changes',variant==='runtime'&&m.materialChanges.length?m.materialChanges.length:'None'],['Load + first render',Math.round(loadMs)+' ms']]);
 const credit=$('#credit');credit.replaceChildren();const creator=document.createElement('p');creator.textContent=m.credit.author;const link=document.createElement('a');link.href=m.credit.source;link.textContent='Original model';link.target='_blank';link.rel='noopener';const license=document.createElement('p');license.textContent=m.credit.license;credit.append(creator,link,license);
 $('#license-note').textContent=m.commercialRestricted?'PS2: noncommercial use only under the supplied license. Distributed adaptations must retain its license.':'';
 status.textContent='Ready · '+(variant==='runtime'?'prepared copy':'original download')+(variant==='runtime'&&m.materialChanges.length?' · material fix applied':' · source materials');lastTime=0;
 }catch(e){if(token===generation)status.textContent='Could not load model: '+e.message;}
}
$('#console').addEventListener('change',()=>{reset();load();});$('#variant').addEventListener('change',load);$('#reset').addEventListener('click',reset);
$('#shelf').addEventListener('change',()=>{shelf.visible=$('#shelf').checked;$('.stage-label small').textContent=shelf.visible?'CONSOLE + 36 SAMPLE CASES':'CONSOLE INSPECTION';frameTimes=[];});$('#wireframe').addEventListener('change',wireframe);
$('#lighting').addEventListener('change',()=>{const mode=$('#lighting').value;key.color.set(mode==='store'?0xffcb80:mode==='neutral'?0xffffff:0xfff3df);key.intensity=mode==='neutral'?2:3;fill.intensity=mode==='neutral'?2:1.4;});
for(const axis of ['x','y','z'])$('#r'+axis).addEventListener('change',()=>{if(!current)return;$('#spin').checked=false;turntable.rotation.y=0;const rotation=['x','y','z'].map(a=>Number($('#r'+a).value)||0);normalize(current,rotation);activeModel.placement={rotationDegrees:rotation,scale:current.scale.x,translation:current.position.toArray()};});
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{const points={front:[0,.8,4.7],back:[0,.8,-4.7],left:[-4.7,.8,0],right:[4.7,.8,0],top:[0,5,.001],under:[0,-5,.001]};controls.target.set(0,.65,0);camera.up.set(0,1,0);camera.position.fromArray(points[button.dataset.view]);floor.visible=button.dataset.view!=='under';controls.update();});
$('#reset').addEventListener('click',()=>{floor.visible=true;});
$('#export').addEventListener('click',()=>{if(!current)return;const clone=structuredClone(catalog),m=clone.models.find(m=>m.id===activeModel.id);m.placement={rotationDegrees:current.rotation.toArray().slice(0,3).map(THREE.MathUtils.radToDeg),scale:current.scale.x,translation:current.position.toArray()};const url=URL.createObjectURL(new Blob([JSON.stringify(clone,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='catalog.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
new ResizeObserver(()=>{const{width,height}=viewport.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();}).observe(viewport);
renderer.setAnimationLoop(t=>{if(document.hidden){lastTime=0;return;}const delta=lastTime?t-lastTime:0;if(lastTime){frameTimes.push(delta);if(frameTimes.length>180)frameTimes.shift();}lastTime=t;if($('#spin').checked&&current)turntable.rotation.y+=Math.min(delta,100)*.00018;controls.update();renderer.render(scene,camera);if(t-lastStats>750){const sorted=[...frameTimes].sort((a,b)=>a-b),avg=frameTimes.reduce((a,b)=>a+b,0)/(frameTimes.length||1);rows($('#live-stats'),[['FPS',avg?(1000/avg).toFixed(0):'—'],['Frame p95',sorted.length?sorted[Math.floor((sorted.length-1)*.95)].toFixed(1)+' ms':'—'],['Draw calls',renderer.info.render.calls],['Rendered triangles',renderer.info.render.triangles.toLocaleString()],['Textures resident',renderer.info.memory.textures],['Geometry objects',renderer.info.memory.geometries]]);lastStats=t;}});
renderer.domElement.addEventListener('webglcontextlost',()=>{status.textContent='Graphics context lost. Reload the preview.';});
await load();
