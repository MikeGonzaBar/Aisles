const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');

const roots={
  ps1:'C:\\Users\\gonza\\Documents\\DuckStation\\covers',
  ps2:'C:\\Emulation\\PCSX2\\pcsx2-v1.7.4981-windows-x64-Qt\\covers',
  ps3:'D:\\Emulation\\PS3',
  ds:'D:\\Emulation\\Nintendo DS\\Games',
  wii:'C:\\Users\\gonza\\AppData\\Roaming\\Dolphin Emulator\\Cache\\GameCovers',
  wiiCustom:'D:\\Emulation\\WII'
};
const libraryRoots={ps1:'D:\\Emulation\\PS1\\Games',ps2:'D:\\Emulation\\PS2\\ISOs',ps3:'D:\\Emulation\\PS3\\ISO',wii:'D:\\Emulation\\WII',ds:'D:\\Emulation\\Nintendo DS\\Games',xbox360:'D:\\Emulation\\XBOX 360\\Games'};
const labels={ps1:'PlayStation',ps2:'PlayStation 2',ps3:'PlayStation 3',wii:'Nintendo Wii',ds:'Nintendo DS',xbox360:'Xbox 360'};
let cache=null;

function walk(directory,accept,out=[]){if(!fs.existsSync(directory))return out;for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const full=path.join(directory,entry.name);if(entry.isDirectory())walk(full,accept,out);else if(accept(full))out.push(full);}return out;}
function normalize(value){return String(value||'').toLowerCase().replace(/\([^)]*\)/g,'').replace(/[^a-z0-9]/g,'');}
function imageFiles(directory){return fs.existsSync(directory)?fs.readdirSync(directory).filter(file=>/\.(png|jpe?g|webp)$/i.test(file)):[];}
function safeArt(platform,file){if(!file||!roots[platform])return null;const rel=path.relative(roots[platform],file);if(rel.startsWith('..')||path.isAbsolute(rel))return null;return `/library-art/${platform}/${Buffer.from(rel).toString('base64url')}`;}
function matchArt(platform,title,id){
  const files=imageFiles(roots[platform]),wanted=normalize(title),wantedId=String(id||'').replace(/[-_.]/g,'').toLowerCase();
  const exact=files.find(file=>normalize(path.parse(file).name)===wantedId);if(exact)return safeArt(platform,path.join(roots[platform],exact));
  const match=files.find(file=>{const candidate=normalize(path.parse(file).name);return wanted.length>4&&(candidate.includes(wanted)||wanted.includes(candidate));});
  return match?safeArt(platform,path.join(roots[platform],match)):null;
}
function regionFromId(id){if(/^(SCUS|SLUS|BCUS|BLUS|NPUA)/.test(id))return 'NTSC-U';if(/^(SCES|SLES|BCES|BLES)/.test(id))return 'PAL';if(/^(SCPS|SLPS|BLJS|BLJM|NPJB)/.test(id))return 'NTSC-J';return null;}
function psSerial(file){
  const fd=fs.openSync(file,'r');const bytes=Math.min(fs.statSync(file).size,8*1024*1024),data=Buffer.alloc(bytes);fs.readSync(fd,data,0,bytes,0);fs.closeSync(fd);
  const match=data.toString('latin1').match(/(S[A-Z]{3})[_-]?(\d{3})[._-]?(\d{2})/);return match?`${match[1]}-${match[2]}${match[3]}`:null;
}
function yamlRecord(contents,id){
  const escaped=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const match=contents.match(new RegExp(`^${escaped}:\\r?\\n([\\s\\S]*?)(?=^[A-Z0-9-]+:\\r?\\n|$)`,'m'));
  if(!match)return {};const section=match[1];const name=section.match(/^  name: "?(.+?)"?\r?$/m)?.[1]||null;const genre=section.match(/^    genre: "?(.+?)"?\r?$/m)?.[1]||null;const publisher=section.match(/^    publisher: "?(.+?)"?\r?$/m)?.[1]||null;return{name,genre,publisher};
}
function scanPs1(){
  const dbPath='C:\\Emulation\\Duckstation\\resources\\gamedb.yaml',db=fs.existsSync(dbPath)?fs.readFileSync(dbPath,'utf8'):'';
  return walk(libraryRoots.ps1,file=>/\.cue$/i.test(file)).map(cue=>{const folder=path.dirname(cue),bin=fs.readdirSync(folder).map(name=>path.join(folder,name)).find(file=>/\.bin$/i.test(file));const id=bin?psSerial(bin):null,record=id?yamlRecord(db,id):{};const title=record.name||path.basename(folder);return{platform:'ps1',path:cue,title,id,region:regionFromId(id||''),genre:record.genre||null,publisher:record.publisher||null,coverUrl:matchArt('ps1',title,id),artKind:'front cover',source:'DuckStation database + disc serial'};});
}
function scanPs2(){
  const cachePath='C:\\Emulation\\PCSX2\\pcsx2-v1.7.4981-windows-x64-Qt\\cache\\gamelist.cache',raw=fs.existsSync(cachePath)?fs.readFileSync(cachePath).toString('utf8'):'';const cacheGames=new Map();
  for(const match of raw.matchAll(/(D:\\Emulation\\PS2\\ISOs\\[^\n]+)\n\0{3}([A-Z]{4}-\d{5})[\s\S]{4}([^\0]+)/g))cacheGames.set(path.resolve(match[1]).toLowerCase(),{id:match[2],title:match[3]});
  return walk(libraryRoots.ps2,file=>/\.iso$/i.test(file)).map(file=>{const found=cacheGames.get(path.resolve(file).toLowerCase()),id=found?.id||null,title=found?.title||path.parse(file).name;return{platform:'ps2',path:file,title,id,region:regionFromId(id||''),coverUrl:matchArt('ps2',title,id),artKind:'front cover',source:'PCSX2 game list'};});
}
function readSfo(file){const b=fs.readFileSync(file);if(b.toString('ascii',0,4)!=='\0PSF')return{};const keyStart=b.readUInt32LE(8),dataStart=b.readUInt32LE(12),count=b.readUInt32LE(16),values={};for(let i=0;i<count;i++){const off=20+i*16,keyOffset=b.readUInt16LE(off),format=b.readUInt16LE(off+2),length=b.readUInt32LE(off+4),dataOffset=b.readUInt32LE(off+12),keyEnd=b.indexOf(0,keyStart+keyOffset),key=b.toString('utf8',keyStart+keyOffset,keyEnd);values[key]=format===0x404?b.readUInt32LE(dataStart+dataOffset):b.toString('utf8',dataStart+dataOffset,dataStart+dataOffset+length).replace(/\0+$/,'');}return values;}
function scanPs3(){return walk(libraryRoots.ps3,file=>/\\PS3_GAME\\PARAM\.SFO$/i.test(file)).map(file=>{const values=readSfo(file),gameDir=path.dirname(file),icon=path.join(gameDir,'ICON0.PNG');return{platform:'ps3',path:path.dirname(gameDir),title:values.TITLE||path.basename(path.dirname(gameDir)),id:values.TITLE_ID||null,region:regionFromId(values.TITLE_ID||''),coverUrl:fs.existsSync(icon)?safeArt('ps3',icon):null,artKind:'menu icon',source:'PS3_GAME/PARAM.SFO'};});}
function scanWii(){const tool='C:\\Emulation\\Dolphin\\Dolphin-x64\\DolphinTool.exe';return walk(libraryRoots.wii,file=>/\.rvz$/i.test(file)).map(file=>{let header={};try{const result=spawnSync(tool,['header','-i',file,'-j'],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});header=JSON.parse(result.stdout||'{}');}catch{}const id=header.game_id||null,customCover=path.join(path.dirname(file),`${path.parse(file).name}.cover.png`),cachedCover=id?path.join(roots.wii,`${id}.png`):null,cover=fs.existsSync(customCover)?customCover:cachedCover&&fs.existsSync(cachedCover)?cachedCover:null,artRoot=cover===customCover?'wiiCustom':'wii';return{platform:'wii',path:file,title:header.internal_name||path.parse(file).name,id,region:header.region||null,revision:header.revision??null,coverUrl:cover?safeArt(artRoot,cover):null,artKind:cover===customCover?'custom sidecar cover':cover?'Dolphin GameTDB cover cache':null,source:'DolphinTool header JSON'};});}
function scanDs(){return walk(libraryRoots.ds,file=>/\.nds$/i.test(file)).map(file=>{const fd=fs.openSync(file,'r'),header=Buffer.alloc(0x1000);fs.readSync(fd,header,0,header.length,0);fs.closeSync(fd);const rawTitle=header.subarray(0,12).toString('ascii').replace(/\0.*$/,'').trim(),id=header.subarray(12,16).toString('ascii').replace(/\0.*$/,'').trim(),folder=path.dirname(file),cover=fs.readdirSync(folder).map(name=>path.join(folder,name)).find(item=>/- Cover\.(png|jpe?g|webp)$/i.test(item));return{platform:'ds',path:file,title:rawTitle||path.parse(file).name,id,region:id.endsWith('E')?'NTSC-U':id.endsWith('P')?'PAL':null,coverUrl:cover?safeArt('ds',cover):null,artKind:cover?'front cover':'embedded 32×32 icon only',source:'NDS header'};});}
function scanLibrary(force=false){
  const now=Date.now();if(!force&&cache&&now-cache.createdAt<120000)return cache.payload;
  const platformGames={ps1:scanPs1(),ps2:scanPs2(),ps3:scanPs3(),wii:scanWii(),ds:scanDs(),xbox360:[]};
  const payload={generatedAt:new Date().toISOString(),platforms:Object.entries(platformGames).map(([id,games])=>({id,name:labels[id],games}))};cache={createdAt:now,payload};return payload;
}
function resolveArt(platform,token){const root=roots[platform];if(!root||!token)return null;let relative;try{relative=Buffer.from(token,'base64url').toString('utf8');}catch{return null;}const file=path.resolve(root,relative),within=path.relative(root,file);return within.startsWith('..')||path.isAbsolute(within)||!fs.existsSync(file)||!fs.statSync(file).isFile()?null:file;}
module.exports={scanLibrary,resolveArt};
