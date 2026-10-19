import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

const MM=.01;
const $=selector=>document.querySelector(selector);
const formats=[
  {id:'ps1',name:'PlayStation',caseName:'CD jewel case',caseMm:[142,125,10],medium:'disc',mediumName:'CD-ROM',mediumMm:[120,1.2],shell:0xdde5ee,accent:0x263246,clear:true,art:'8/8 local front covers'},
  {id:'ps2',name:'PlayStation 2',caseName:'DVD keep case',caseMm:[135,190,14],medium:'disc',mediumName:'DVD-ROM / CD-ROM',mediumMm:[120,1.2],shell:0x10151d,accent:0x2879e7,art:'17/17 local front covers'},
  {id:'ps3',name:'PlayStation 3',caseName:'Short Blu-ray case',caseMm:[135,171.5,13],medium:'disc',mediumName:'Blu-ray Disc',mediumMm:[120,1.2],shell:0x164d91,accent:0x58a6ff,art:'2/2 local menu-art sets; no box-cover scans'},
  {id:'wii',name:'Nintendo Wii',caseName:'DVD keep case',caseMm:[135,190,14],medium:'disc',mediumName:'Wii optical disc',mediumMm:[120,1.2],shell:0xe9edf0,accent:0x51b7d7,art:'No local front covers'},
  {id:'ds',name:'Nintendo DS',caseName:'Compact DS case',caseMm:[135,122,15],medium:'cartridge',mediumName:'Nintendo DS Game Card',mediumMm:[35,33,3.8],shell:0x20252c,accent:0xd7dde5,art:'1/12 local front covers; 12/12 embedded icons'},
  {id:'xbox360',name:'Xbox 360',caseName:'DVD keep case',caseMm:[135,190,14],medium:'disc',mediumName:'DVD-ROM',mediumMm:[120,1.2],shell:0x25872f,accent:0x9fe86a,art:'No games or local artwork yet'}
];

for(const format of formats){const option=document.createElement('option');option.value=format.id;option.textContent=format.name;$('#platform').append(option);}

const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
$('#viewport').append(renderer.domElement);

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x202c3e);
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();
const camera=new THREE.PerspectiveCamera(34,1,.02,100);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.minDistance=.7;controls.maxDistance=18;
const key=new THREE.DirectionalLight(0xfff1dc,3.2);key.position.set(-4,7,5);key.castShadow=true;key.shadow.mapSize.set(2048,2048);scene.add(key);
scene.add(new THREE.HemisphereLight(0xc4dcff,0x2c2722,1.5));
const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:0x151d2b,roughness:.78,metalness:.04}));
floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
const turntable=new THREE.Group();scene.add(turntable);
let current=null,spinTargets=[];

function canvasTexture(width,height,draw){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');draw(context,width,height);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return texture;
}

function fitText(context,text,maxWidth,startSize,minSize=24){
  let size=startSize;do{context.font=`800 ${size}px Segoe UI, sans-serif`;if(context.measureText(text).width<=maxWidth)return size;size-=2;}while(size>minSize);return size;
}

function coverTexture(format){
  const ratio=format.caseMm[1]/format.caseMm[0],width=720,height=Math.max(540,Math.round(width*ratio));
  return canvasTexture(width,height,(c,w,h)=>{
    const gradient=c.createLinearGradient(0,0,w,h);gradient.addColorStop(0,'#101827');gradient.addColorStop(.55,'#263d5a');gradient.addColorStop(1,'#0b111b');c.fillStyle=gradient;c.fillRect(0,0,w,h);
    c.globalAlpha=.23;c.fillStyle=`#${format.accent.toString(16).padStart(6,'0')}`;for(let x=-h;x<w+h;x+=90){c.save();c.translate(x,h*.55);c.rotate(-.62);c.fillRect(-24,-h,48,h*2);c.restore();}c.globalAlpha=1;
    c.fillStyle='#ffc448';c.fillRect(0,0,w,Math.max(34,h*.045));
    c.fillStyle='#f4f7fb';c.font=`700 ${Math.round(h*.04)}px Segoe UI, sans-serif`;c.fillText('AISLES COLLECTION',w*.07,h*.13);
    const title=format.name.toUpperCase();const size=fitText(c,title,w*.86,Math.round(h*.105));c.font=`800 ${size}px Segoe UI, sans-serif`;c.fillText(title,w*.07,h*.52);
    c.fillStyle='#b8c4d5';c.font=`600 ${Math.round(h*.035)}px Segoe UI, sans-serif`;c.fillText(format.mediumName.toUpperCase(),w*.07,h*.59);
    c.strokeStyle='#f4f7fb';c.lineWidth=Math.max(3,h*.006);c.strokeRect(w*.07,h*.69,w*.86,h*.2);
    c.font=`800 ${Math.round(h*.06)}px Segoe UI, sans-serif`;c.fillStyle='#f4f7fb';c.textAlign='center';c.fillText('SAMPLE GAME',w*.5,h*.81);c.textAlign='left';
  });
}

function spineTexture(format){
  return canvasTexture(160,1024,(c,w,h)=>{c.fillStyle=`#${format.accent.toString(16).padStart(6,'0')}`;c.fillRect(0,0,w,h);c.save();c.translate(w*.62,h*.94);c.rotate(-Math.PI/2);c.fillStyle='#fff';c.font='800 66px Segoe UI, sans-serif';c.fillText(`${format.name.toUpperCase()} · SAMPLE GAME`,0,0);c.restore();});
}

function discTexture(format){
  return canvasTexture(1024,1024,(c,w,h)=>{
    const center=w/2,gradient=c.createRadialGradient(center,center,w*.06,center,center,w*.5);gradient.addColorStop(0,'#181d25');gradient.addColorStop(.08,'#dfe5eb');gradient.addColorStop(.62,'#afb8c5');gradient.addColorStop(1,'#677486');c.fillStyle=gradient;c.fillRect(0,0,w,h);
    c.fillStyle=`#${format.accent.toString(16).padStart(6,'0')}`;c.beginPath();c.arc(center,center,w*.34,-2.6,.4);c.lineWidth=w*.13;c.strokeStyle=c.fillStyle;c.stroke();
    c.fillStyle='#111824';c.textAlign='center';c.font='800 62px Segoe UI, sans-serif';c.fillText(format.name.toUpperCase(),center,h*.31);c.font='800 48px Segoe UI, sans-serif';c.fillText('SAMPLE',center,h*.67);c.fillText('GAME',center,h*.73);
  });
}

function material(color,options={}){return new THREE.MeshStandardMaterial({color,roughness:.35,metalness:.02,...options});}
function shadow(root){root.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}});return root;}

function buildCase(format){
  const [widthMm,heightMm,depthMm]=format.caseMm,[w,h,d]=format.caseMm.map(value=>value*MM),group=new THREE.Group();
  const shellMaterial=format.clear?material(format.shell,{transparent:true,opacity:.32,depthWrite:false,roughness:.18}):material(format.shell,{roughness:.32,transparent:format.id!=='ps2'&&format.id!=='ds',opacity:format.id==='ps2'||format.id==='ds'?1:.88});
  if(format.id==='ps1'){
    const tray=new THREE.Mesh(new RoundedBoxGeometry(w*.965,h*.93,d*.55,3,.018),material(0x171d26,{roughness:.48}));tray.position.z=-d*.12;group.add(tray);
  }
  const shell=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,5,Math.min(.035,d*.28)),shellMaterial);group.add(shell);
  const front=new THREE.Mesh(new THREE.PlaneGeometry(w*.91,h*.9),material(0xffffff,{map:coverTexture(format),roughness:.48,metalness:0}));front.position.z=d/2+.006;group.add(front);
  const spine=new THREE.Mesh(new THREE.PlaneGeometry(d*.82,h*.88),material(0xffffff,{map:spineTexture(format),roughness:.45}));spine.rotation.y=-Math.PI/2;spine.position.x=-w/2-.006;group.add(spine);
  const hinge=new THREE.Mesh(new RoundedBoxGeometry(Math.max(d*.45,.035),h*.94,d*.2,2,.008),material(format.clear?0xb8c6d4:format.shell,{roughness:.42}));hinge.position.set(-w*.46,0,-d*.38);group.add(hinge);
  if(format.id==='ps3'){
    const band=new THREE.Mesh(new RoundedBoxGeometry(w*.96,h*.07,d*1.03,3,.012),material(0x226bb3,{transparent:true,opacity:.9,roughness:.22}));band.position.y=h*.455;group.add(band);
  }
  group.position.y=h/2;group.userData={kind:'case',widthMm,heightMm,depthMm};return shadow(group);
}

function buildDisc(format){
  const diameter=format.mediumMm[0]*MM,thickness=format.mediumMm[1]*MM,shape=new THREE.Shape();shape.absarc(0,0,diameter/2,0,Math.PI*2,false);
  const hole=new THREE.Path();hole.absarc(0,0,diameter*.075,0,Math.PI*2,true);shape.holes.push(hole);
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,curveSegments:96});geometry.translate(0,0,-thickness/2);
  const positions=geometry.attributes.position,uvs=geometry.attributes.uv,normals=geometry.attributes.normal;
  for(let index=0;index<positions.count;index++)if(Math.abs(normals.getZ(index))>.9)uvs.setXY(index,positions.getX(index)/diameter+.5,positions.getY(index)/diameter+.5);
  uvs.needsUpdate=true;
  const disc=new THREE.Mesh(geometry,[material(0xffffff,{map:discTexture(format),metalness:.48,roughness:.24}),material(0x778493,{metalness:.75,roughness:.18})]);
  disc.position.y=diameter/2;disc.userData={spinAxis:'z'};return shadow(disc);
}

function buildCartridge(format){
  const [widthMm,heightMm,depthMm]=format.mediumMm,w=widthMm*MM,h=heightMm*MM,d=depthMm*MM,shape=new THREE.Shape();
  shape.moveTo(-w/2,-h/2);shape.lineTo(w/2,-h/2);shape.lineTo(w/2,h*.32);shape.lineTo(w*.36,h/2);shape.lineTo(-w*.32,h/2);shape.lineTo(-w/2,h*.36);shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:d,bevelEnabled:true,bevelSize:.008,bevelThickness:.006,bevelSegments:2});geometry.translate(0,0,-d/2);
  const group=new THREE.Group(),body=new THREE.Mesh(geometry,material(0x252a31,{roughness:.58}));group.add(body);
  const label=canvasTexture(480,360,(c,width,height)=>{c.fillStyle='#edf1f5';c.fillRect(0,0,width,height);c.fillStyle='#d4212f';c.fillRect(0,0,width,height*.12);c.fillStyle='#161d29';c.font='800 44px Segoe UI, sans-serif';c.fillText('NINTENDO DS',25,72);c.fillStyle='#315a91';c.fillRect(24,105,width-48,height-140);c.fillStyle='#fff';c.font='800 42px Segoe UI, sans-serif';c.fillText('SAMPLE',45,205);c.fillText('GAME',45,255);});
  const sticker=new THREE.Mesh(new THREE.PlaneGeometry(w*.72,h*.55),material(0xffffff,{map:label,roughness:.55}));sticker.position.set(0,-h*.08,d/2+.008);group.add(sticker);
  for(let i=-2;i<=2;i++){const groove=new THREE.Mesh(new THREE.BoxGeometry(.008,h*.13,.006),material(0x11151a));groove.position.set(i*w*.095,h*.35,d/2+.006);group.add(groove);}
  group.position.y=h/2;group.userData={spinAxis:'y'};return shadow(group);
}

function dispose(root){
  const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const mat of Array.isArray(object.material)?object.material:object.material?[object.material]:[]){materials.add(mat);for(const value of Object.values(mat))if(value?.isTexture)textures.add(value);}});
  geometries.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());textures.forEach(value=>value.dispose());
}

function buildFamily(format,display=$('#display').value,registerSpin=true){
  const root=new THREE.Group(),caseWidth=format.caseMm[0]*MM,mediumWidth=format.mediumMm[0]*MM;
  if(display!=='medium'){const caseObject=buildCase(format);caseObject.position.x=display==='case'?0:-(mediumWidth*.56+.18);root.add(caseObject);}
  if(display!=='case'){const medium=format.medium==='disc'?buildDisc(format):buildCartridge(format);medium.position.x=display==='medium'?0:caseWidth*.56+.18;medium.position.z=.06;root.add(medium);if(registerSpin)spinTargets.push(medium);}
  root.userData.format=format;return root;
}

function textSprite(text){
  const texture=canvasTexture(768,128,(c,w,h)=>{c.clearRect(0,0,w,h);c.fillStyle='#f1f4f8';c.textAlign='center';c.font='700 46px Segoe UI, sans-serif';c.fillText(text,w/2,56);c.fillStyle='#9eacc0';c.font='600 28px Segoe UI, sans-serif';c.fillText('TRUE SCALE',w/2,98);});
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));sprite.scale.set(1.8,.3,1);return sprite;
}

function buildComparison(){
  const root=new THREE.Group(),comparison=[formats[0],formats[1],formats[2],formats[4]],spacing=1.75;
  comparison.forEach((format,index)=>{const family=buildFamily(format,'case');family.position.x=(index-(comparison.length-1)/2)*spacing;const label=textSprite(format.id==='ps2'?'DVD family':format.caseName);label.position.set(family.position.x,2.25,0);root.add(family,label);});return root;
}

function setWireframe(){current?.traverse(object=>{for(const mat of Array.isArray(object.material)?object.material:object.material?[object.material]:[])mat.wireframe=$('#wireframe').checked;});}
function bounds(){const box=new THREE.Box3().setFromObject(current),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());return{box,center,size,radius:size.length()/2};}
function resetView(){if(!current)return;const {center,radius}=bounds();controls.target.copy(center);camera.up.set(0,1,0);camera.position.set(center.x+radius*1.4,Math.max(center.y+radius*.75,2),center.z+radius*2.25);controls.update();}

function rows(values){const list=$('#specs');list.replaceChildren();for(const[label,value]of values){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;list.append(dt,dd);}}
function rebuild(){
  if(current){turntable.remove(current);dispose(current);}spinTargets=[];turntable.rotation.set(0,0,0);
  const format=formats.find(item=>item.id===$('#platform').value),compare=$('#compare').checked;current=compare?buildComparison():buildFamily(format);turntable.add(current);setWireframe();
  $('#platform').disabled=compare;$('#display').disabled=compare;$('#export').disabled=compare;
  $('#format-name').textContent=compare?'Case family comparison':format.name;
  $('#format-kind').textContent=compare?'JEWEL · DVD · BLU-RAY · DS':'TRUE-SCALE PROCEDURAL GEOMETRY';
  if(compare){rows([['Scale','1 unit = 100 mm'],['Families','4'],['Reusable variants','6 platforms']]);$('#implementation').textContent='The PS2, Wii and Xbox 360 share one DVD-case mesh with different materials. PS1, PS3 and DS use their own proportions.';$('#artwork').textContent='Comparison mode uses generated labels so geometry and relative size remain easy to inspect.';}
  else{rows([['Case',format.caseName],['Case size',`${format.caseMm.join(' × ')} mm`],['Medium',format.mediumName],['Medium size',format.medium==='disc'?`${format.mediumMm[0]} mm diameter × ${format.mediumMm[1]} mm`:`${format.mediumMm.join(' × ')} mm`],['Scale','1 unit = 100 mm']]);$('#implementation').textContent=format.medium==='disc'?'Closed case plus a separate thin optical disc with a real center hole. The disc label rotates without requiring console tray animation.':'Closed compact case plus a beveled DS cartridge with a front label and molded top grooves.';$('#artwork').textContent=format.art;}
  $('#status').textContent='Ready · generated locally · real-world proportions';resetView();
}

for(const control of ['platform','display','compare'])$('#'+control).addEventListener('change',rebuild);
$('#wireframe').addEventListener('change',setWireframe);$('#reset').addEventListener('click',resetView);
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{if(!current)return;const {center,radius}=bounds(),distance=Math.max(radius*2.8,3),views={front:[0,0,distance],back:[0,0,-distance],left:[-distance,0,0],right:[distance,0,0],top:[0,distance,.001],perspective:[distance*.75,distance*.55,distance]};camera.position.copy(center).add(new THREE.Vector3(...views[button.dataset.view]));camera.up.set(0,1,0);controls.target.copy(center);controls.update();});

$('#export').addEventListener('click',()=>{
  const format=formats.find(item=>item.id===$('#platform').value),exportRoot=buildFamily(format,'case-media',false);
  new GLTFExporter().parse(exportRoot,result=>{const blob=new Blob([result],{type:'model/gltf-binary'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`aisles-${format.id}-media.glb`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);dispose(exportRoot);$('#status').textContent=`Exported ${format.name} media family`;},error=>{$('#status').textContent='Export failed: '+error.message;dispose(exportRoot);},{binary:true,onlyVisible:true});
});

new ResizeObserver(()=>{const {width,height}=$('#viewport').getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();}).observe($('#viewport'));
let last=0;renderer.setAnimationLoop(time=>{const delta=Math.min(last?time-last:0,80);last=time;if($('#spin-scene').checked)turntable.rotation.y+=delta*.0002;if($('#spin-media').checked)for(const object of spinTargets)object.rotation[object.userData.spinAxis||'y']+=delta*.00055;controls.update();renderer.render(scene,camera);});
rebuild();
