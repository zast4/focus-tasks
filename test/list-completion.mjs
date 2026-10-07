import test from 'node:test';
import assert from 'node:assert/strict';
import {FakeApp,loadPlugin,areaNote,frontmatter,bodyOf} from './harness.mjs';
const today=()=>new Date().toLocaleDateString('sv-SE');
async function setup(){const app=new FakeApp();areaNote(app,'Work');const p=await loadPlugin(app),list=await p.createIntentList('Options','Work');return{app,p,list};}
const target=list=>({area:list.area,project:list.file.basename,projectFile:list.file,intentList:true,listUid:list.uid});
for(const state of ['empty','done','cancelled','someday'])test(`${state} idea list completes privately and reopens with one Undo`,async()=>{
 const{app,p,list}=await setup();
 if(state!=='empty'){const entry=await p.createTask('Possibility',target(list),null);await p.frontOwned(entry.file,fm=>{fm.status=state;fm.custom={keep:true};});}
 const entries=new Map(p.intentEntries(list).map(t=>[t.file.path,app.vault.files.get(t.file.path)])),before=app.vault.files.get(list.file.path);
 p.history=[];await p.setProjectDone(list.file,true,list.uid);
 const fm=frontmatter(app,list.file.path),closed=p.intentOf(list.file);
 assert.equal(fm.type,'список замыслов');assert.equal(fm.uid,list.uid);assert.equal(fm.status,'done');assert.equal(fm.completedDate,today());
 assert.equal(p.closedIntentList(closed),true);assert.equal(p.tasks().length,0);assert.equal(p.read().closed.length,0);
 for(const[path,text]of entries)assert.equal(app.vault.files.get(path),text);
 assert.equal(p.history.length,1);await p.undo();assert.equal(app.vault.files.get(list.file.path),before);
 await p.setProjectDone(list.file,true,list.uid);await p.setProjectDone(list.file,false,list.uid);
 assert.equal(p.closedIntentList(p.intentOf(list.file)),false);assert.equal(frontmatter(app,list.file.path).completedDate,undefined);
});
for(const status of ['open','in-progress','waiting'])test(`a list with a live ${status} idea cannot be completed`,async()=>{
 const{app,p,list}=await setup(),entry=await p.createTask('Keep visible',target(list),null);
 await p.frontOwned(entry.file,fm=>{fm.status=status;});const before=app.vault.files.get(list.file.path);p.history=[];
 await assert.rejects(p.setProjectDone(list.file,true,list.uid));
 assert.equal(app.vault.files.get(list.file.path),before);assert.equal(p.history.length,0);
});
test('completion reads an externally reopened entry instead of the cached completed row',async()=>{
 const{app,p,list}=await setup(),entry=await p.createTask('Possibility',target(list),null);await p.toggle(entry);p.intentEntries(list);
 // Suppress metadata events to exercise a stale reader.
 const raw=app.vault.files.get(entry.file.path).replace('status: done','status: open');app.vault.files.set(entry.file.path,raw);
 await assert.rejects(p.setProjectDone(list.file,true,list.uid));assert.equal(frontmatter(app,list.file.path).status,undefined);
});
test('a replaced list identity cannot be completed by an old checkbox',async()=>{
 const{app,p,list}=await setup();await p.frontOwned(list.file,fm=>{fm.uid='replacement';});const before=app.vault.files.get(list.file.path);
 await assert.rejects(p.setProjectDone(list.file,true,list.uid));assert.equal(app.vault.files.get(list.file.path),before);
});
test('adding an idea reopens its completed list; one Undo restores both files',async()=>{
 const{app,p,list}=await setup();await p.setProjectDone(list.file,true,list.uid);const before=app.vault.files.get(list.file.path);p.history=[];
 const entry=await p.createTask('New possibility',target(list),null);
 assert.equal(p.closedIntentList(p.intentOf(list.file)),false);assert.equal(frontmatter(app,list.file.path).completedDate,undefined);
 assert.equal(p.history.length,1);await p.undo();assert.equal(app.vault.files.has(entry.file.path),false);assert.equal(app.vault.files.get(list.file.path),before);
});
test('moving a task into a completed list reopens it without losing its context or identity',async()=>{
 const{app,p,list}=await setup();await p.setProjectDone(list.file,true,list.uid);
 const task=await p.createTask('An option now',{area:'Work'},today()),body=bodyOf(app,task.file.path),uid=task.uid;
 await p.moveTasks([task],{into:true,pile:'intents',target:{type:'project',area:{name:'Work'},project:{...list,intentList:true}}});
 assert.equal(p.closedIntentList(p.intentOf(list.file)),false);assert.equal(p.tasks().length,0);
 assert.equal(p.intentEntries(p.intentOf(list.file))[0].uid,uid);assert.equal(bodyOf(app,task.file.path),body);
 await p.undo();assert.equal(p.closedIntentList(p.intentOf(list.file)),true);assert.equal(p.tasks()[0].uid,uid);
});
