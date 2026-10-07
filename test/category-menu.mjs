import test from 'node:test';
import assert from 'node:assert/strict';
import {FakeApp,loadPlugin,areaNote,projectNote,writeNote} from './harness.mjs';
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
