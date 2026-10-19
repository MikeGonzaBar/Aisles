const http=require('http'),fs=require('fs'),path=require('path'),{scanLibrary,resolveArt}=require('./library-workshop.cjs');
const artwork=require('./artwork-workshop.cjs');
const root=path.resolve(__dirname,'..');
let mediaJob=null;
http.createServer(async(req,res)=>{
 if(req.method==='POST' && ['/api/artwork/search','/api/artwork/select','/api/artwork/search-missing'].includes(req.url)){
  if(req.headers['content-type']!=='application/json' || (req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)){res.writeHead(403).end();return;}
  try{
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096){res.writeHead(413).end();return;}}
   const body=JSON.parse(raw);
   if(req.url==='/api/artwork/search-missing'){
    if(!mediaJob?.running){
     const library=scanLibrary();mediaJob={running:true,completed:0,total:0,failed:0};
     artwork.searchMissingArtwork(library,progress=>{mediaJob.completed=progress.completed;mediaJob.total=progress.total;}).then(result=>Object.assign(mediaJob,result,{running:false})).catch(error=>Object.assign(mediaJob,{running:false,failed:mediaJob.completed+1,error:error.message}));
    }
    res.writeHead(202,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(mediaJob));return;
   }
   const game=scanLibrary().platforms.flatMap(p=>p.games).find(g=>artwork.keyFor(g)===body.gameKey);
   if(!game){res.writeHead(404).end();return;}
   const result=req.url.endsWith('/search')?await artwork.search(game):artwork.select(game,body.kind,body.candidateId);
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));
  }catch(error){res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.message}));}return;
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
 let urlPath,requestUrl;
 try{requestUrl=new URL(req.url,'http://localhost');urlPath=decodeURIComponent(requestUrl.pathname);}catch{res.writeHead(400).end();return;}
 if(urlPath==='/api/library'){
  try{const body=Buffer.from(JSON.stringify(artwork.decorateLibrary(scanLibrary(requestUrl.searchParams.get('refresh')==='1'))));res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-cache','Content-Length':body.length});if(req.method==='GET')res.end(body);else res.end();}catch(error){res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.message}));}return;
 }
 if(urlPath==='/api/artwork/media-job'){
  const body=Buffer.from(JSON.stringify(mediaJob||{running:false,completed:0,total:0}));res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Content-Length':body.length});if(req.method==='GET')res.end(body);else res.end();return;
 }
 const cachedArt=urlPath.match(/^\/artwork-cache\/([a-f0-9]{64}\.png)$/);
 if(cachedArt){const file=artwork.resolveFile(cachedArt[1]);if(!file){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':'image/png','Content-Length':fs.statSync(file).size,'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')res.end();else fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);return;}
 const artMatch=urlPath.match(/^\/library-art\/(ps1|ps2|ps3|ds|wii|wiiCustom)\/([A-Za-z0-9_-]+)$/);
 if(artMatch){
  const artFile=resolveArt(artMatch[1],artMatch[2]);if(!artFile){res.writeHead(404).end();return;}
  const extension=path.extname(artFile).toLowerCase(),mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extension]||'application/octet-stream';
  res.setHeader('Content-Type',mime);res.setHeader('Cache-Control','no-cache');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Length',fs.statSync(artFile).size);if(req.method==='HEAD'){res.end();return;}fs.createReadStream(artFile).on('error',()=>res.destroy()).pipe(res);return;
 }
 if(urlPath==='/'){res.writeHead(302,{Location:'/prototype/model-preview.html'}).end();return;}
 let file;
 try{file=path.resolve(root,'.'+urlPath);}catch{res.writeHead(400).end();return;}
 const relative=path.relative(root,file);
 if(relative.startsWith('..')||path.isAbsolute(relative)){res.writeHead(403).end();return;}
 const normalized='/'+relative.split(path.sep).join('/');
 if(!['/prototype/','/assets/models/','/3d models/','/node_modules/three/'].some(prefix=>normalized.startsWith(prefix))&&normalized!=='/docs/model-audit-data.json'){res.writeHead(403).end();return;}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.json':'application/json','.glb':'model/gltf-binary','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');
 res.setHeader('Cache-Control','no-cache');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Length',fs.statSync(file).size);
 if(req.method==='HEAD'){res.end();return;}
 fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
}).listen(Number(process.env.AISLES_PREVIEW_PORT||8766),'127.0.0.1',()=>console.log('Console workshop: http://127.0.0.1:'+(process.env.AISLES_PREVIEW_PORT||8766)+'/prototype/model-preview.html'));
