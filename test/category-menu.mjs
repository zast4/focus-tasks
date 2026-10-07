import test from 'node:test';
import assert from 'node:assert/strict';
import {FakeApp,loadPlugin,areaNote,projectNote,writeNote} from './harness.mjs';

for(const kind of ['focus','backlog','intents'])test(`closing the last project ${kind} retains its header without affecting siblings`,async()=>{
 const app=new FakeApp();areaNote(app,'Work');const file=projectNote(app,'Work','Project'),other=projectNote(app,'Work','Other'),p=await loadPlugin(app),path=file.path;
 const key='project-intents:'+path,focus={key:'project-focusoff:'+path,onKey:'project-focuson:'+path,defaultOpen:false},later={key:'later:'+path,projectPath:path,defaultOpen:false};
 const before=new Map(app.vault.files);
 await p.toggleSupplement(key,kind,later,focus);
 assert.equal(await p.toggleSupplement(key,kind,later,focus),false);
 assert.equal(p.categoryShown(focus),false);assert.equal(p.categoryShown(later),false);assert.equal(p.isShown(key,true),false);
 assert.equal(p.isShown('project-header:'+path,true),true);assert.equal(p.isShown('project-header:'+other.path,true),false);
 assert.deepEqual(new Map(app.vault.files),before);
 const loaded=await loadPlugin(app);assert.equal(loaded.isShown('project-header:'+path,true),true);
 assert.equal(await loaded.toggleSupplement(key,kind,later,focus),true);
});

test('an area category choice resets retained headers only in its own area',async()=>{
 const app=new FakeApp();areaNote(app,'Work');areaNote(app,'Life');const work=projectNote(app,'Work','Build'),life=projectNote(app,'Life','Rest'),p=await loadPlugin(app);
 for(const kind of ['focus','backlog','intents']){
  p.data.opened['project-header:'+work.path]=true;p.data.opened['project-header:'+life.path]=true;
  await p.toggleSupplement('intents:Work',kind,{key:'future:Work'},{key:'focusoff:Work',inverted:true});
  assert.equal(p.isShown('project-header:'+work.path,true),false);assert.equal(p.isShown('project-header:'+life.path,true),true);
 }
});

test('a retained project header follows a rename and is cleared when the project is removed',async()=>{
 const app=new FakeApp();areaNote(app,'Work');const file=projectNote(app,'Work','Project'),p=await loadPlugin(app),old=file.path;
 p.data.opened['project-header:'+old]=true;
 await app.vault.rename(file,'Areas/Renamed.md');await p.renamed(file.path,old);
 assert.equal(p.isShown('project-header:'+old,true),false);assert.equal(p.isShown('project-header:'+file.path,true),true);
 const area=(await p.collect(false,true)).find(a=>a.name==='Work'),project=p.notes().find(x=>x.file.path===file.path);
 await p.removeProject(area,project);
 assert.equal(p.isShown('project-header:'+file.path,true),false);
});
for(const presentation of ['focus-area','backlog-area','project']) for(let mask=0;mask<8;mask++) test(`${presentation} menu has only supported categories for population ${mask}`,async()=>{
 const p=await loadPlugin(new FakeApp());const focus={count:mask&1?3:0},later={count:mask&2?4:0},count=mask&4?5:0;
 const actual=p.categoryChoices({presentation,focus,later,count});const expected=[['focus',focus.count],['backlog',later.count],['intents',count]].filter(([kind,n])=>(kind!=='focus'||presentation!=='backlog-area')&&(presentation!=='project'||n>0)).map(([kind,n])=>({kind,n}));
 assert.deepEqual(actual,expected);assert.equal(new Set(actual.map(x=>x.kind)).size,actual.length);
});
test('project menu never offers a Focus excluded by the area/project day',async()=>{const p=await loadPlugin(new FakeApp());assert.deepEqual(p.categoryChoices({focus:{count:9,available:false},later:{count:3},count:2}),[{kind:'backlog',n:3},{kind:'intents',n:2}]);});
test('category population ignores current visibility and keeps simultaneous Backlog and Ideas',async()=>{
 const p=await loadPlugin(new FakeApp()),focus={key:'f',count:1},later={key:'b',count:2},args={focus,later,count:3};const before=p.categoryChoices(args);
 for(const kind of ['focus','backlog','intents'])await p.toggleSupplement('intents:Work',kind,later,focus);
 assert.deepEqual(p.categoryChoices(args),before);assert.equal(p.categoryShown(later),true);assert.equal(p.isShown('intents:Work',true),true);
});
test('only lists imported from the area itself belong to the default Ideas row',async()=>{
 const app=new FakeApp(),area=areaNote(app,'Work'),other=writeNote(app,'Context.md',{type:'note'},'Text'),pf=projectNote(app,'Work','Project');const p=await loadPlugin(app);
 const local=await p.createIntentList('Old area title','Work'),independent=await p.createIntentList('Independent','Work'),foreign=await p.createIntentList('Other source','Work');
 await p.frontOwned(local.file,fm=>fm.source='[[Work. Tasks]]'); // use an exact source path after the edit
 await p.frontOwned(local.file,fm=>fm.source='[['+area.path.replace(/\.md$/,'')+']]');
 await p.frontOwned(foreign.file,fm=>fm.source='[[Context]]');
 assert.deepEqual(p.areaDefaultIntentLists('Work').map(x=>x.uid),[local.uid]);
 await p.bindIntentList(p.intentOf(local.file),pf);assert.deepEqual(p.areaDefaultIntentLists('Work'),[]);
 assert.equal(p.read().intents.filter(x=>x.isList).length,3);assert.ok(independent.uid&&other);
});
test('the linked area note routes its imported lists into the default row without rewriting notes',async()=>{
 const app=new FakeApp(),area=areaNote(app,'Work'),context=writeNote(app,'Own context.md',{},'Original text');const p=await loadPlugin(app);await p.setLinked(area,context);
 const list=await p.createIntentList('Own context','Work');await p.frontOwned(list.file,fm=>fm.source='[[Own context]]');const before=new Map(app.vault.files);
 assert.deepEqual(p.areaDefaultIntentLists('Work').map(x=>x.uid),[list.uid]);assert.deepEqual(new Map(app.vault.files),before);
});

test('embedded own fences do not create recursive renderers while original Markdown is unchanged',async()=>{
 const p=await loadPlugin(new FakeApp());const fn=p.codeProcessors.get('focus-tasks');assert.ok(fn);let children=0;
 for(const kind of ['.focus-tasks-view','.ft-intent-description','.ft-text'])fn('area: Work',{closest:selector=>selector.includes(kind)?{}:null},{sourcePath:'Project.md',addChild:()=>children++});
 assert.equal(children,0);
});
