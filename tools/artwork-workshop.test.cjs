const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'aisles-artwork-test-'));
process.env.AISLES_ARTWORK_CACHE=cache;
const a=require('./artwork-workshop.cjs');
const file='a'.repeat(64)+'.png';fs.writeFileSync(path.join(cache,file),'fixture');
const game={platform:'ps2',path:'D:\\Games\\Example.iso',title:'Example Game',id:'SLUS-20001',region:'NTSC-U',coverUrl:'/library-art/local',artKind:'front cover'};
const candidate={id:'example',kind:'frontCover',file,title:'Example Game',region:'North America',width:800,height:1000,source:'test'};
const entry=candidates=>({candidates,selections:{}});
after(()=>fs.rmSync(cache,{recursive:true,force:true}));
test('manual selection survives resolution and precedes emulator artwork',()=>{
 const e=entry([candidate]);e.selections.frontCover=candidate.id;
 assert.equal(a.resolveKind(game,'frontCover',e).match,'manual selection');
});
test('emulator cover precedes all online images while disc remains independent',()=>{
 const e=entry([{...candidate,exactId:game.id}]);
 assert.equal(a.resolveKind(game,'frontCover',e).source,'emulator');
 assert.equal(a.resolveKind(game,'discLabel',e).source,'generated');
});
test('exact game ID wins over ambiguous title-and-region alternatives',()=>{
 const g={...game,coverUrl:null},e=entry([{...candidate,id:'exact',exactId:game.id},{...candidate,id:'other'}]);
 assert.equal(a.resolveKind(g,'frontCover',e).id,'exact');
});
test('the first matching box artwork is used, while wrong regions stay generated',()=>{
 const g={...game,coverUrl:null};
 assert.equal(a.resolveKind(g,'frontCover',entry([candidate])).match,'first available box artwork');
 assert.equal(a.resolveKind(g,'frontCover',entry([candidate,{...candidate,id:'other'}])).match,'first available box artwork');
 assert.equal(a.resolveKind(g,'frontCover',entry([{...candidate,region:'Europe'}])).source,'generated');
});
test('a disc uses the first available matching result when several labels exist',()=>{
 const disc={...candidate,kind:'discLabel',editionUnverified:true};
 const second={...disc,id:'second'};
 assert.equal(a.resolveKind(game,'discLabel',entry([disc,second])).id,'example');
 assert.equal(a.resolveKind(game,'discLabel',entry([disc,second])).match,'first available disc artwork');
});
test('known conflicts and unprepared cart photos cannot auto-apply',()=>{
 const g={...game,coverUrl:null};
 for(const changes of [{conflict:'printed serial differs'},{preparationRequired:true}]) assert.equal(a.resolveKind(g,'frontCover',entry([{...candidate,...changes}])).source,'generated');
});
test('generated override precedes emulator and online images',()=>{
 const e=entry([candidate]);e.selections.frontCover='generated';
 assert.equal(a.resolveKind(game,'frontCover',e).source,'generated');
});
test('DS search uses readable filename rather than abbreviated ROM header',()=>{
 assert.equal(a.titleFor({platform:'ds',title:'COOKINGMAMA3',path:'D:\\Games\\4309 - Cooking Mama 3 - Shop & Chop (US).nds'}),'Cooking Mama 3 - Shop & Chop');
});
test('known publisher prefix does not prevent title fallback',()=>{
 assert.equal(a.titleFor({...game,title:'Disney/Pixar Cars'}),'Cars');
});
test('search and gallery parser preserve platform and asset classification',()=>{
 const rows=a.parseSearch('<a class="list-item" href="/games/details/123-example"><h3>Example Game</h3><p>Sony Playstation 2</p></a>');
 assert.equal(rows[0].platform,'Sony Playstation 2');
 const images=a.parseImages('<a href="https://images.launchbox-app.com/example.png" data-gameimageid="123" data-title="Example Game - Disc Image (North America)">',rows[0]);
 assert.equal(images[0].kind,'discLabel');assert.equal(images[0].editionUnverified,true);
});
test('cache route rejects paths outside its image whitelist',()=>{
 assert.equal(a.resolveFile('../index.json'),null);assert.equal(a.resolveFile('index.json'),null);assert.equal(a.resolveFile(file),path.join(cache,file));
});
test('even an identical title and region cannot cross platforms',()=>{
 assert.equal(a.eligible({...game,coverUrl:null},{...candidate,platform:'Nintendo DS'}),false);
});
test('saved override is read by a new process',()=>{
 a.select(game,'frontCover','generated');
 const {spawnSync}=require('child_process');
 const child=spawnSync(process.execPath,['-e',`const a=require(${JSON.stringify(path.join(__dirname,'artwork-workshop.cjs'))});console.log(a.describe(${JSON.stringify(game)}).resolved.frontCover.match);`],{encoding:'utf8',env:{...process.env,AISLES_ARTWORK_CACHE:cache},windowsHide:true});
 assert.equal(child.status,0);assert.equal(child.stdout.trim(),'manual generated fallback');
 a.select(game,'frontCover','automatic');
});
