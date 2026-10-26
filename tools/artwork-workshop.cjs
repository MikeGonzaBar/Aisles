const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const cacheRoot = process.env.AISLES_ARTWORK_CACHE || path.resolve(__dirname, '../.cache/artwork');
const stateFile = path.join(cacheRoot, 'index.json');
const platforms = {ps1:'Sony Playstation', ps2:'Sony Playstation 2', ps3:'Sony Playstation 3', wii:'Nintendo Wii', ds:'Nintendo DS', xbox360:'Microsoft Xbox 360'};
let state;
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { state = {version:1, games:{}}; }
const pending = new Map();
let requestQueue = Promise.resolve();

function keyFor(game) { return crypto.createHash('sha256').update(game.platform + ':' + path.resolve(game.path).toLowerCase()).digest('hex'); }
function kindsFor(game) { return ['frontCover', game.platform === 'ds' ? 'cartridgeLabel' : 'discLabel']; }
function normalize(value) { return String(value || '').normalize('NFKD').replace(/™|®/g,'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function titleFor(game) {
  if (game.platform !== 'ds') return game.title.replace(/[™®]/g,'').replace(/^Disney\s*\/\s*Pixar\s+/i,'').trim();
  return path.parse(game.path).name.replace(/^\d+\s*-\s*/, '').replace(/\s*\([^)]*\)|\s*\[[^\]]*\]/g,'').trim();
}
function regionFor(game) {
  const value=String(game.region || '').toUpperCase();
  if (/NTSC-U|USA|NORTH AMERICA/.test(value)) return 'North America';
  if (/PAL|EUROPE/.test(value)) return 'Europe';
  if (/NTSC-J|JAPAN/.test(value)) return 'Japan';
  return null;
}
function edition(value) { return String(value).toLowerCase().match(/special edition|game of the year|greatest hits|collector.?s? edition|platinum|essentials|extras edition|disc\s*\d+/g)?.sort().join('|') || ''; }
function entryFor(game) { return state.games[keyFor(game)] ||= {candidates:[], selections:{}, searchedAt:null, errors:[]}; }
function save() { fs.mkdirSync(cacheRoot,{recursive:true}); const temp=stateFile+'.tmp'; fs.writeFileSync(temp,JSON.stringify(state,null,2)); fs.renameSync(temp,stateFile); }
function hasFile(candidate) { return /^[a-f0-9]{64}\.png$/.test(candidate.file || '') && fs.existsSync(path.join(cacheRoot,candidate.file)); }
function summary(candidate, match) { return {...candidate, conflict:candidate.conflict || (candidate.width && Math.min(candidate.width,candidate.height)<384?`Low resolution: ${candidate.width} × ${candidate.height}`:candidate.editionUnverified?'Edition/disc number needs review':null), url:'/artwork-cache/'+candidate.file, match}; }
function eligible(game, candidate) {
  if(candidate.platform && normalize(candidate.platform)!==normalize(platforms[game.platform]))return false;
  if (candidate.conflict || candidate.preparationRequired || (candidate.width && Math.min(candidate.width,candidate.height)<384) || !hasFile(candidate)) return false;
  if (candidate.exactId && normalize(candidate.exactId) === normalize(game.id)) return true;
  return normalize(candidate.title) === normalize(titleFor(game)) && candidate.region === regionFor(game) && edition(candidate.title) === edition(titleFor(game)) && !candidate.editionUnverified;
}
function firstUsableArtwork(game, kind, entry) {
  return entry.candidates.find(candidate=>candidate.kind===kind && hasFile(candidate) && !candidate.conflict && !candidate.preparationRequired &&
    (!candidate.platform || normalize(candidate.platform)===normalize(platforms[game.platform])) &&
    ((candidate.exactId && normalize(candidate.exactId)===normalize(game.id)) ||
      (normalize(candidate.title)===normalize(titleFor(game)) && candidate.region===regionFor(game))));
}
function resolveKind(game, kind, entry) {
  const selected=entry.selections[kind];
  if (selected === 'generated') return {source:'generated', match:'manual generated fallback', url:null};
  const manual=entry.candidates.find(c=>c.id===selected && c.kind===kind && firstUsableArtwork(game,kind,{...entry,candidates:[c]}));
  if (manual) return summary(manual,'manual selection');
  if (kind==='frontCover' && game.coverUrl && game.artKind !== 'menu icon') return {source:'emulator',match:'existing local artwork',url:game.coverUrl};
  if (kind==='frontCover' || kind==='discLabel') {
    const first=firstUsableArtwork(game,kind,entry);
    if (first) return summary(first,`first available ${kind==='frontCover'?'box':'disc'} artwork`);
  }
  const candidates=entry.candidates.filter(c=>c.kind===kind && eligible(game,c));
  const exact=candidates.filter(c=>c.exactId && normalize(c.exactId)===normalize(game.id));
  if (exact.length===1) return summary(exact[0],'exact game ID');
  if (!exact.length && candidates.length===1) return summary(candidates[0],'title + platform + region');
  return {source:'generated',url:null,match:(exact.length>1 || candidates.length>1)?'multiple matches: choose artwork':'no safe match: generated artwork'};
}
function describe(game) {
  const entry=entryFor(game);
  return {key:keyFor(game), searchTitle:titleFor(game), region:regionFor(game), searchedAt:entry.searchedAt, errors:entry.errors, searching:pending.has(keyFor(game)), resolved:Object.fromEntries(kindsFor(game).map(kind=>[kind,resolveKind(game,kind,entry)])), candidates:entry.candidates.map(c=>summary(c,eligible(game,c)?'eligible':'review required'))};
}
function decorateLibrary(library) { return {...library,platforms:library.platforms.map(platform=>({...platform,games:platform.games.map(game=>({...game,artwork:describe(game)}))}))}; }
function decode(value) { return String(value).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#x([a-f0-9]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&nbsp;/g,' '); }
function plain(value) { return decode(value.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim(); }
function parseSearch(html) {
  return [...html.matchAll(/href="(\/games\/details\/\d+-[^"?#]+)"([\s\S]*?)(?=<a class="list-item|$)/g)].map(m=>{
    const heading=m[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>\s*<p\b[^>]*>([\s\S]*?)<\/p>/);
    return heading?{page:'https://gamesdb.launchbox-app.com'+m[1].replace('/details/','/images/'),title:plain(heading[1]),platform:plain(heading[2])}:null;
  }).filter(Boolean);
}
function parseImages(html, gameRecord) {
  return [...html.matchAll(/href="(https:\/\/images\.launchbox-app\.com\/[^"\s]+)"\s+data-gameimageid="(\d+)"[\s\S]*?data-title="([^"]+)"/g)].map(m=>{
    const label=decode(m[3]), type=label.match(/ - (Box - Front|Disc|Cart - Front) Image(?: \(([^)]+)\))?$/);
    if (!type) return null;
    return {id:'launchbox-'+m[2],source:'LaunchBox',sourceUrl:m[1],page:gameRecord.page,title:gameRecord.title,platform:gameRecord.platform,region:type[2]||null,kind:{'Box - Front':'frontCover',Disc:'discLabel','Cart - Front':'cartridgeLabel'}[type[1]],preparationRequired:type[1]==='Cart - Front',editionUnverified:type[1]==='Disc',label};
  }).filter(Boolean);
}
async function request(url) {
  const target=new URL(url);
  if (target.protocol!=='https:' || !['gamesdb.launchbox-app.com','images.launchbox-app.com','art.gametdb.com'].includes(target.hostname)) throw new Error('Artwork host is not allowed');
  const previous=requestQueue;
  let release; requestQueue=new Promise(resolve=>{release=resolve;});
  await previous;
  try {
    const response=await fetch(target,{signal:AbortSignal.timeout(12000),redirect:'error',headers:{'User-Agent':'Aisles-Workshop/0.1'}});
    if (!response.ok) { await response.body?.cancel(); throw new Error(`${target.hostname}: HTTP ${response.status}`); }
    const chunks=[];let size=0;
    for await(const chunk of response.body) { size+=chunk.length;if(size>12*1024*1024)throw new Error('Artwork response exceeds 12 MiB');chunks.push(chunk); }
    return Buffer.concat(chunks);
  } finally { setTimeout(release,250); }
}
async function cacheImage(candidate) {
  const bytes=await request(candidate.sourceUrl);
  const image=sharp(bytes,{limitInputPixels:32*1024*1024}),meta=await image.metadata();
  if (!meta.width || !meta.height || !['png','jpeg','webp'].includes(meta.format)) throw new Error('Unsupported artwork image');
  const output=await image.png().toBuffer(),file=crypto.createHash('sha256').update(candidate.sourceUrl).digest('hex')+'.png';
  fs.mkdirSync(cacheRoot,{recursive:true});fs.writeFileSync(path.join(cacheRoot,file),output);
  return {...candidate,file,width:meta.width,height:meta.height,qualityNote:Math.min(meta.width,meta.height)<384?'Low resolution: review before use':null};
}
// These findings came from visual inspection, not merely the site's region tag.
function reviewed(candidate, game) {
  if(candidate.id==='launchbox-308984') {
    Object.assign(candidate,{printedId:'BCUS-98199',exactId:'BCUS98199',editionUnverified:false});
    if(normalize(game.id)!==normalize(candidate.exactId))candidate.conflict='Printed BCUS-98199; local ID is '+game.id;
  }
  if(candidate.id==='launchbox-1980124') candidate.conflict='Image says Special Edition; verify your edition';
  if(candidate.id==='launchbox-873660') Object.assign(candidate,{exactId:'AMCE',labelRect:[43,20,429,475],preparationRequired:false});
  if(candidate.id==='launchbox-20131120') Object.assign(candidate,{exactId:'B3CE',labelRect:[43,20,429,475],preparationRequired:false});
  return candidate;
}
async function search(game, {kinds=null}={}) {
  const key=keyFor(game);if(pending.has(key))return pending.get(key);
  const task=(async()=>{
    const entry=entryFor(game);entry.errors=[];
    try {
      // Exact-ID provider first. Do not probe unknown title IDs or guess regions.
      const wanted=kindsFor(game).filter(kind=>(!kinds || kinds.includes(kind)) && resolveKind(game,kind,entry).source==='generated');
      if (['ps3','wii'].includes(game.platform) && /^[A-Z0-9]{6,9}$/.test(game.id||'') && regionFor(game)) {
        const locale={ 'North America':'US',Europe:'EN',Japan:'JA'}[regionFor(game)];
        for(const kind of wanted) {
          const candidate={id:`gametdb-${game.platform}-${game.id}-${kind}-${locale}`,source:'GameTDB',platform:platforms[game.platform],title:titleFor(game),region:regionFor(game),kind,exactId:game.id,page:`https://www.gametdb.com/${game.platform==='ps3'?'PS3':'Wii'}/${game.id}`,sourceUrl:`https://art.gametdb.com/${game.platform}/${kind==='frontCover'?'cover':'disc'}/${locale}/${game.id}.png`};
          try { upsert(entry,await cacheImage(candidate)); } catch(error) { entry.errors.push(error.message+` (${kind}, exact ID)`); }
        }
      }
      if(regionFor(game) && wanted.length) {
        // Search punctuation is provider-specific; use the title stem for discovery,
        // then require the full normalized title on the returned platform record.
        const query=titleFor(game).split(/\s+-\s+|:/)[0].trim();
        const searchPage='https://gamesdb.launchbox-app.com/games/results?id='+encodeURIComponent(query);
        const records=parseSearch((await request(searchPage)).toString('utf8')).filter(r=>normalize(r.platform)===normalize(platforms[game.platform]) && normalize(r.title)===normalize(titleFor(game))).slice(0,2);
        const missingKinds=wanted.filter(kind=>resolveKind(game,kind,entry).source==='generated');
        for(const record of records) {
          const candidates=parseImages((await request(record.page)).toString('utf8'),record).filter(c=>kindsFor(game).includes(c.kind) && c.region===regionFor(game));
          // Bound each request to at most three alternatives per asset type.
          for(const kind of missingKinds) for(const candidate of candidates.filter(c=>c.kind===kind).slice(0,3)) {
            try { upsert(entry,await cacheImage(reviewed(candidate,game))); } catch(error) { entry.errors.push(error.message); }
          }
        }
        if(!records.length)entry.errors.push('No exact title + platform search result; generated artwork retained.');
      }
      if(!regionFor(game))entry.errors.push('Region is unknown; automatic title matching is unavailable.');
    } catch(error) { entry.errors.push(error.message); }
    entry.searchedAt=new Date().toISOString();save();return describe(game);
  })();pending.set(key,task);
  try { return await task; } finally { pending.delete(key); }
}
async function searchMissingArtwork(library, onProgress=()=>{}) {
  const wantedFor=game=>game.platform==='ds'?['frontCover']:['frontCover','discLabel'];
  const games=library.platforms.flatMap(platform=>platform.games).filter(game=>wantedFor(game).some(kind=>resolveKind(game,kind,entryFor(game)).source==='generated'));
  let completed=0;onProgress({completed,total:games.length,game:null});
  for (const game of games) {
    try { await search(game,{kinds:wantedFor(game)}); } finally { completed++; onProgress({completed,total:games.length,game}); }
  }
  return {completed,total:games.length};
}
function upsert(entry,candidate) { const index=entry.candidates.findIndex(c=>c.id===candidate.id);if(index<0)entry.candidates.push(candidate);else entry.candidates[index]=candidate; }
function select(game,kind,candidateId) {
  if(!kindsFor(game).includes(kind))throw new Error('Invalid artwork type');
  const entry=entryFor(game);
  if(!['automatic','generated'].includes(candidateId) && !entry.candidates.some(c=>c.kind===kind && c.id===candidateId && hasFile(c) && !c.preparationRequired))throw new Error('Artwork is unavailable or needs label preparation');
  if(candidateId==='automatic')delete entry.selections[kind];else entry.selections[kind]=candidateId;
  save();return describe(game);
}
function resolveFile(name) { return /^[a-f0-9]{64}\.png$/.test(name) && fs.existsSync(path.join(cacheRoot,name))?path.join(cacheRoot,name):null; }
module.exports={decorateLibrary,search,searchMissingArtwork,select,resolveFile,keyFor,describe,normalize,titleFor,regionFor,eligible,parseSearch,parseImages,resolveKind};
