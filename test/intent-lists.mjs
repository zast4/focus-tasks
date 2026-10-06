import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeApp, loadPlugin, areaNote, writeNote, frontmatter } from './harness.mjs';

async function setup() { const app=new FakeApp();areaNote(app,'Work');areaNote(app,'Life');return {app,p:await loadPlugin(app)}; }
const target=list=>({area:list.area,project:list.file.basename,projectFile:list.file,intentList:true,listUid:list.uid});
const into=list=>({into:true,pile:'intents',target:{type:'project',area:{name:list.area},project:{...list,intentList:true}}});

test('intent lists and dated entries never become areas, actionable tasks, Waiting or reminders',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('Plans','Work');
  const entry=await p.createTask('A possibility',target(list),'2026-10-06T10:00');
  assert.equal(entry.intent,true);assert.equal(p.tasks().length,0);assert.equal(p.read().intentTasks.length,1);
  assert.equal(p.intentEntries(list)[0].uid,entry.uid);assert.equal((await p.collect(false)).length,0);
  assert.equal(p.calendarStatus(entry,{enabled:true}),null);assert.equal(p.waitingAll().length,0);
  assert.equal(frontmatter(app,list.file.path).type,'список замыслов');
  assert.equal(frontmatter(app,entry.file.path).area,undefined);
  assert.deepEqual(p.notes().map(x=>x.area).sort(),['Life','Work']);
});

test('list parsing preserves nested material, numbered entries, historical ticks and code examples',async()=>{
  const {p}=await setup();const r=p.parseIntentListBody('Context\n\n- One\n\t- Nested\n\n1. Two\n```md\n- example\n```\n- ~~Past~~\n- [x] Checked\n');
  assert.equal(r.description,'Context');assert.deepEqual(r.items.map(x=>x.text),['One','Two','Past','Checked']);
  assert.equal(r.items[0].body,'- Nested');assert.match(r.items[1].body,/- example/);
  assert.equal(r.items[2].done,true);assert.equal(r.items[3].done,true);
  const prose=p.parseIntentListBody('One paragraph\n\nFurther context [[Link]]');
  assert.equal(prose.items[0].text,'One paragraph');assert.match(prose.items[0].body,/Further context/);
});

test('migration keeps the old identity and source while creating ordered independently editable entries',async()=>{
  const {app,p}=await setup(),card=await p.createIntent('Material','- First\n  - Details\n- ~~Past~~\n- Last','Work');
  const result=await p.convertIntentCard(card,'Life');
  assert.equal(result.list.uid,card.uid);assert.equal(frontmatter(app,card.file.path).intentArea,'Life');
  assert.equal(p.read().intentTasks.length,3);assert.equal(p.tasks().length,0);
  assert.equal(frontmatter(app,result.entries[1].file.path).status,'done');
  assert.match(await app.vault.read(result.entries[0].file),/- Details/);
  assert.deepEqual(p.data.order.tasks['intent:'+card.uid],result.entries.map(x=>x.uid));
  assert.equal((await p.convertIntentCard(card,'Life')).reused,true);assert.equal(p.read().intentTasks.length,3);
  await p.undo();assert.equal(p.read().intentTasks.length,0);assert.equal(await app.vault.read(card.file),card.raw);
});

test('migration refuses stale source bytes before creating any entry',async()=>{
  const {app,p}=await setup(),card=await p.createIntent('Material','- First','Work');
  await app.vault.modify(card.file,card.raw+'\nCloud change');
  await assert.rejects(p.convertIntentCard(card,'Life'),/intent-conflict/);
  assert.equal(p.read().intentTasks.length,0);assert.match(await app.vault.read(card.file),/Cloud change/);
});

test('a partial migration preserves the card and retries without duplicating verified recovery entries',async()=>{
  const {app,p}=await setup(),card=await p.createIntent('Material','- First\n- Last','Work');
  const original=p.createTask.bind(p);let calls=0;
  p.createTask=async(...args)=>{if(++calls===2)throw Error('disk failure');return original(...args);};
  await assert.rejects(p.convertIntentCard(card,'Life'),/disk failure/);
  assert.equal(await app.vault.read(card.file),card.raw);assert.equal(p.read().intentTasks.length,1);
  p.createTask=original;const r=await p.convertIntentCard(card,'Life');
  assert.equal(r.entries.length,2);assert.equal(p.read().intentTasks.length,2);
});

test('normal task mutations work on idea rows and Undo preserves their membership',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('List','Work'),entry=await p.createTask('One',target(list),null);
  await p.setScheduled(entry,'2026-10-07','12:30');await p.toggle(entry);
  assert.equal(frontmatter(app,entry.file.path).status,'done');await p.undo();
  assert.equal(frontmatter(app,entry.file.path).status,'open');assert.equal(p.tasks().length,0);
  await p.rename(entry,'Renamed');assert.equal(entry.uid,frontmatter(app,entry.file.path).uid);
  assert.equal(frontmatter(app,entry.file.path).projects,undefined);
  assert.equal(frontmatter(app,entry.file.path).intentListUid,list.uid);
  assert.equal(p.intentEntries(list).length,1);assert.equal(p.tasks().length,0);
});

test('Enter and addLine preserve the idea list instead of leaking new actions into the backlog',async()=>{
  const {p}=await setup(),list=await p.createIntentList('List','Work'),a=await p.createTask('One',target(list),null);
  const b=await p.insertAfter(a,'Two',null);await p.addLine(target(list),'Three',null);
  assert.equal(b.intent,true);assert.equal(p.tasks().length,0);assert.equal(p.intentEntries(list).length,3);
  assert.deepEqual(p.data.order.tasks['intent:'+list.uid].slice(0,2),[a.uid,b.uid]);
});

test('Cmd+D keeps list membership and places the copy immediately above the source',async()=>{
  const {p}=await setup(),list=await p.createIntentList('List','Work'),a=await p.createTask('A',target(list),null),b=await p.insertAfter(a,'B',null);
  const [copy]=await p.duplicateTasks([b]);assert.equal(copy.intent,true);assert.notEqual(copy.uid,b.uid);
  assert.deepEqual(p.data.order.tasks['intent:'+list.uid],[a.uid,copy.uid,b.uid]);assert.equal(p.tasks().length,0);
});

test('explicit promotion keeps identity and description; one Undo returns the item to its list',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('List','Work'),a=await p.createTask('A',target(list),null);
  await app.vault.modify(a.file,(await app.vault.read(a.file))+'Details [[Context]]');
  assert.equal(await p.promoteIntentTask(a,'2026-10-06'),true);
  assert.equal(p.tasks().length,1);assert.equal(p.tasks()[0].uid,a.uid);assert.equal(p.intentEntries(list).length,0);
  assert.match(await app.vault.read(a.file),/Details/);assert.equal(frontmatter(app,a.file.path).intentList,undefined);
  await p.undo();assert.equal(p.tasks().length,0);assert.equal(p.intentEntries(list)[0].uid,a.uid);
});

test('stale idea handles cannot mutate an item that another writer already promoted',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('List','Work'),a=await p.createTask('A',target(list),null);
  await app.fileManager.processFrontMatter(a.file,fm=>{fm.type='задача';fm.area='Work';delete fm.intentList;});
  const before=await app.vault.read(a.file);assert.equal(await p.setDate(a,'2026-10-06'),false);
  assert.equal(await app.vault.read(a.file),before);
});

test('moving rows between lists keeps clocks and order without promoting them',async()=>{
  const {p}=await setup(),l=await p.createIntentList('First','Work'),r=await p.createIntentList('Second','Life');
  const a=await p.createTask('A',target(l),'2026-10-08T09:00'),b=await p.createTask('B',target(r),null);
  await p.moveTasks([a],{...into(r),into:false,target:{type:'task',task:b}},{['intent:'+r.uid]:[b.uid]});
  assert.equal(p.intentEntries(l).length,0);assert.equal(p.intentEntries(r).length,2);assert.equal(p.tasks().length,0);
  assert.equal(a.date,'2026-10-08');assert.equal(a.at,'09:00');
  assert.deepEqual(p.data.order.tasks['intent:'+r.uid],[a.uid,b.uid]);
});

test('moving a list rehomes all its entries, parents and ordering, with Undo',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('List','Work'),a=await p.createTask('A',target(list),null);
  await p.moveIntentList(list,'Life');assert.equal(frontmatter(app,list.file.path).intentArea,'Life');
  assert.equal(p.read().intentTasks[0].area,'Life');assert.equal(p.intentEntries(list)[0].uid,a.uid);
  assert.deepEqual(frontmatter(app,list.file.path).parents,['[[Areas/Life]]']);
  await p.undo();assert.equal(p.read().intentTasks[0].area,'Work');
});

test('renaming lists keeps entry links and immutable identity',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('List','Work'),a=await p.createTask('A',target(list),null);
  const link=frontmatter(app,a.file.path).intentList;await p.renameIntentList(list,'New title');
  assert.equal(p.read().intents[0].title,'New title');assert.equal(frontmatter(app,a.file.path).intentList,link);
  assert.equal(p.intentEntries(list)[0].uid,a.uid);
});

test('same-named lists stay separate by identity, including their manual order',async()=>{
  const {p}=await setup(),a=await p.createIntentList('List','Work'),b=await p.createIntentList('List','Work');
  const x=await p.createTask('Same',target(a),null),y=await p.createTask('Same',target(b),null);
  assert.notEqual(a.uid,b.uid);assert.notEqual(x.uid,y.uid);assert.equal(p.intentEntries(a)[0].uid,x.uid);assert.equal(p.intentEntries(b)[0].uid,y.uid);
});

test('typing after a deleted or retyped list refuses to create a hidden orphan',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('List','Work');
  await app.fileManager.processFrontMatter(list.file,fm=>{fm.type='проект';});
  await assert.rejects(p.createTask('A',target(list),null),/intent-conflict/);assert.equal(p.allTasks().length,0);
});

test('group date changes preserve membership; group promotion is one reversible action',async()=>{
  const {p}=await setup(),list=await p.createIntentList('List','Work');
  const a=await p.createTask('A',target(list),null),b=await p.createTask('B',target(list),null);
  await p.setDates([a,b],'2026-10-07','13:00');assert.equal(p.tasks().length,0);
  assert.deepEqual(p.intentEntries(list).map(x=>x.at),['13:00','13:00']);
  await p.promoteIntentTasks([a,b],'2026-10-06');assert.equal(p.tasks().length,2);
  assert.deepEqual(p.tasks().map(x=>x.at),['13:00','13:00']);
  await p.undo();assert.equal(p.tasks().length,0);assert.equal(p.intentEntries(list).length,2);
});

test('promotion of an externally relocated idea moves it into the configured task folder',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('List','Work');
  const file=writeNote(app,'Other/Idea.md',{type:'замысел',uid:'relocated',title:'Idea',status:'open',intentArea:'Work',intentList:'[[Areas/List]]',intentListUid:list.uid},'Details');
  const entry=p.taskOf(file);assert.equal(entry.intent,true);
  await p.promoteIntentTask(entry,null);assert.equal(p.tasks()[0].uid,'relocated');assert.ok(entry.file.path.startsWith(p.tasksFolder+'/'));
  await p.undo();assert.ok(app.vault.getAbstractFileByPath('Other/Idea.md'));assert.equal(p.tasks().length,0);
});

test('dropping a whole list joins the drag transaction and never waits for itself',async()=>{
  const {p}=await setup(),list=await p.createIntentList('List','Work');await p.createTask('A',target(list),null);
  await Promise.race([p.drop({type:'project',area:{name:'Work'},project:{...list,intentList:true}},{into:true,target:{type:'area-title',area:{name:'Life'}}},{tasks:{}}),new Promise((_,reject)=>setTimeout(()=>reject(Error('drag transaction deadlock')),1000))]);
  assert.equal(p.read().intents[0].area,'Life');assert.equal(p.read().intentTasks[0].area,'Life');
  await p.undo();assert.equal(p.read().intents[0].area,'Work');assert.equal(p.read().intentTasks[0].area,'Work');
});

test('deleting through a stale list handle refuses a foreign replacement note',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('List','Work');
  await app.fileManager.processFrontMatter(list.file,fm=>{fm.type='проект';fm.uid='foreign';});
  const raw=await app.vault.read(list.file);await assert.rejects(p.deleteIntentList(list),/intent-conflict/);
  assert.equal(await app.vault.read(list.file),raw);
});

test('stale list membership cannot make deletion remove a promoted real task',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('List','Work'),a=await p.createTask('A',target(list),null);
  await app.fileManager.processFrontMatter(a.file,fm=>{fm.type='задача';fm.area='Work';delete fm.intentList;});
  p.intentEntries=()=>[a];const raw=await app.vault.read(a.file);
  await assert.rejects(p.deleteIntentList(list),/intent-conflict/);assert.equal(await app.vault.read(a.file),raw);
});

test('a stale list move cannot rehome an entry that was already moved to another list',async()=>{
  const {app,p}=await setup(),first=await p.createIntentList('First','Work'),second=await p.createIntentList('Second','Work');
  const a=await p.createTask('A',target(first),null);
  await app.fileManager.processFrontMatter(a.file,fm=>{fm.intentListUid=second.uid;fm.intentList='[[Areas/Second]]';});
  p.intentEntries=()=>[a];const raw=await app.vault.read(a.file),container=await app.vault.read(first.file);
  await assert.rejects(p.moveIntentList(first,'Life'),/intent-conflict/);
  assert.equal(await app.vault.read(a.file),raw);assert.equal(await app.vault.read(first.file),container);
});

test('renaming and duplicating relocated entries preserve their actual folder and avoid name collisions',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('List','Work');
  const file=writeNote(app,'Other/Idea.md',{type:'замысел',uid:'outside',status:'open',intentArea:'Work',intentList:'[[Areas/List]]',intentListUid:list.uid},'Details');
  writeNote(app,'Other/Renamed.md',{type:'заметка'},'Keep');
  const entry=p.taskOf(file);await p.rename(entry,'Renamed');assert.equal(entry.file.path,'Other/Renamed (2).md');
  const [copy]=await p.duplicateTasks([entry]);assert.equal(copy.file.path,'Other/Renamed (2) (2).md');
  assert.equal(frontmatter(app,copy.file.path).intentListUid,list.uid);assert.equal(frontmatter(app,copy.file.path).projects,undefined);
  assert.equal(await app.vault.read(app.vault.getAbstractFileByPath('Other/Renamed.md')).then(x=>x.includes('Keep')),true);
});

test('a linked-note idea title cannot shadow its destination, including after inline rename',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('List','Work');
  const original=writeNote(app,'Notes/Reference.md',{type:'заметка'},'Original');
  const entry=await p.createTask('[[Reference]]',target(list),null);
  assert.equal(entry.file.basename,'Reference (2)');assert.equal(entry.text,'[[Reference]]');
  await p.rename(entry,'Other');await p.rename(entry,'[[Notes/Reference#Section|Reference]]');
  assert.equal(entry.file.basename,'Reference (2)');assert.equal(await app.vault.read(original).then(x=>x.includes('Original')),true);
  assert.equal(frontmatter(app,entry.file.path).intentListUid,list.uid);
  await p.promoteIntentTask(entry,null);await p.rename(entry,'[[Reference]]');
  assert.equal(entry.file.basename,'Reference (2)');
});

test('deleting an area includes its idea lists and entries, preserves linked sources and restores everything with one Undo',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('List','Work'),entry=await p.createTask('Idea',target(list),null);
  const action=await p.createTask('Action',{area:'Work',project:null},null),source=writeNote(app,'Notes/Source.md',{type:'заметка'},'Keep');
  const before=await app.vault.read(list.file),order=structuredClone(p.data.order.tasks);
  await p.removeArea({name:'Work'});assert.equal(app.vault.getAbstractFileByPath(list.file.path),null);assert.equal(p.allTasks().length,0);
  assert.equal(p.notes().some(x=>x.area==='Work'),false);assert.match(await app.vault.read(source),/Keep/);
  await p.undo();assert.equal(await app.vault.read(app.vault.getAbstractFileByPath(list.file.path)),before);
  assert.equal(p.intentEntries(p.read().intents[0])[0].uid,entry.uid);assert.equal(p.tasks()[0].uid,action.uid);
  assert.deepEqual(p.data.order.tasks,order);assert.equal(p.notes().some(x=>x.area==='Work'),true);
});

test('area deletion refuses an externally replaced idea list before deleting any entries or the area',async()=>{
  const {app,p}=await setup(),list=await p.createIntentList('List','Work'),entry=await p.createTask('Idea',target(list),null);
  const original=p.undoable.bind(p);p.undoable=async(...args)=>{await app.fileManager.processFrontMatter(list.file,fm=>{fm.uid='foreign';});return original(...args);};
  await assert.rejects(p.removeArea({name:'Work'}),/intent-conflict/);
  assert.ok(app.vault.getAbstractFileByPath(entry.file.path));assert.equal(p.notes().some(x=>x.area==='Work'),true);
  assert.equal(frontmatter(app,list.file.path).uid,'foreign');
});

test('renaming a stale row cannot revert list membership changed by another writer',async()=>{
  const {app,p}=await setup(),first=await p.createIntentList('First','Work'),second=await p.createIntentList('Second','Life');
  const entry=await p.createTask('Old',target(first),null),stale={...entry};
  await p.moveTasks([entry],into(second),{});const link=frontmatter(app,entry.file.path).intentList;
  await p.rename(stale,'Renamed');const fm=frontmatter(app,stale.file.path);
  assert.equal(fm.intentList,link);assert.equal(fm.intentListUid,second.uid);assert.equal(fm.intentArea,'Life');
  assert.equal(fm.projects,undefined);assert.equal(p.intentEntries(second)[0].text,'Renamed');
});
