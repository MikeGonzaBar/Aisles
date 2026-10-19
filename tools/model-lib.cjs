const fs = require('fs');
function readGlb(file) {
 const b=fs.readFileSync(file);
 if(b.toString('ascii',0,4)!=='glTF'||b.readUInt32LE(4)!==2||b.readUInt32LE(8)!==b.length)throw Error('Invalid GLB: '+file);
 let json,bin;
 for(let p=12;p<b.length;){const len=b.readUInt32LE(p),type=b.readUInt32LE(p+4);if(p+8+len>b.length)throw Error('Invalid chunk');const data=b.subarray(p+8,p+8+len);if(type===0x4e4f534a)json=JSON.parse(data.toString());if(type===0x004e4942)bin=data;p+=8+len;}
 if(!json||!bin)throw Error('Missing GLB chunks');return {json,bin};
}
function writeGlb(file,json,bin){
 const raw=Buffer.from(JSON.stringify(json));const jb=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(jb);const bb=Buffer.alloc(Math.ceil(bin.length/4)*4);bin.copy(bb);
 const h=Buffer.alloc(20);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+jb.length+bb.length,8);h.writeUInt32LE(jb.length,12);h.writeUInt32LE(0x4e4f534a,16);
 const bh=Buffer.alloc(8);bh.writeUInt32LE(bb.length);bh.writeUInt32LE(0x004e4942,4);fs.writeFileSync(file,Buffer.concat([h,jb,bh,bb]));
}
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function multiply(a,b){return Array.from({length:16},(_,i)=>{const r=i%4,c=Math.floor(i/4);return a[r]*b[c*4]+a[r+4]*b[c*4+1]+a[r+8]*b[c*4+2]+a[r+12]*b[c*4+3];});}
function matrix(n){
 if(n.matrix)return n.matrix;
 const [x,y,z,w]=n.rotation||[0,0,0,1],[sx,sy,sz]=n.scale||[1,1,1],[tx,ty,tz]=n.translation||[0,0,0];
 return [(1-2*y*y-2*z*z)*sx,(2*x*y+2*z*w)*sx,(2*x*z-2*y*w)*sx,0,(2*x*y-2*z*w)*sy,(1-2*x*x-2*z*z)*sy,(2*y*z+2*x*w)*sy,0,(2*x*z+2*y*w)*sz,(2*y*z-2*x*w)*sz,(1-2*x*x-2*y*y)*sz,0,tx,ty,tz,1];
}
function bounds(g){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 function visit(index,parent){const n=g.nodes[index],m=multiply(parent,matrix(n));if(n.mesh!==undefined)for(const p of g.meshes[n.mesh].primitives){const a=g.accessors[p.attributes.POSITION];if(!a.min||!a.max)throw Error('Missing POSITION bounds');for(let k=0;k<8;k++){const v=[0,1,2].map(i=>(k&(1<<i))?a.max[i]:a.min[i]);for(let i=0;i<3;i++){const t=m[i]*v[0]+m[i+4]*v[1]+m[i+8]*v[2]+m[i+12];min[i]=Math.min(min[i],t);max[i]=Math.max(max[i],t);}}}for(const c of n.children||[])visit(c,m);}
 for(const n of g.scenes[g.scene||0].nodes)visit(n,identity());
 if(!min.every(Number.isFinite)||!max.every(Number.isFinite))throw Error('Invalid bounds');return {min,max,size:max.map((v,i)=>v-min[i])};
}
function check(g,bin){
 const issues=[];
 for(const [i,v]of(g.bufferViews||[]).entries())if(v.buffer!==0||(v.byteOffset||0)+v.byteLength>bin.length)issues.push('bufferView '+i+' outside embedded buffer');
 for(const [i,a]of(g.accessors||[]).entries()){
 if(a.sparse){issues.push('Sparse accessor unsupported by audit: '+i);continue;}
 const v=g.bufferViews[a.bufferView],width=({5120:1,5121:1,5122:2,5123:2,5125:4,5126:4})[a.componentType],count=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16})[a.type];
 if(!v||!width||!count||(a.byteOffset||0)+Math.max(0,a.count-1)*(v.byteStride||width*count)+width*count>v.byteLength)issues.push('Invalid accessor '+i);
 }
 for(const [i,im]of(g.images||[]).entries())if(im.uri||!g.bufferViews[im.bufferView])issues.push('Nonembedded image '+i);
 if(g.buffers.length!==1||g.buffers[0].uri)issues.push('Expected one embedded buffer');return issues;
}
function imageSize(data){
 if(data.subarray(1,4).toString()==='PNG')return[data.readUInt32BE(16),data.readUInt32BE(20)];
 if(data.readUInt16BE(0)===0xffd8){for(let p=2;p+8<data.length;){if(data[p]!==255)break;const marker=data[p+1],length=data.readUInt16BE(p+2);if([0xc0,0xc1,0xc2].includes(marker))return[data.readUInt16BE(p+7),data.readUInt16BE(p+5)];if(length<2)break;p+=2+length;}}
 throw Error('Unsupported embedded image header');
}
module.exports={readGlb,writeGlb,bounds,check,imageSize};
