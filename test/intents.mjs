import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeApp, loadPlugin, areaNote, writeNote, frontmatter } from './harness.mjs';

async function setup(settings={}) {
  const app=new FakeApp();areaNote(app,'Work');areaNote(app,'Life');
  const p=await loadPlugin(app,settings);return {app,p};
}
const raw=(app,file)=>app.vault.read(file);

test('ideas keep unique identities and never become areas, tasks, Waiting or focus',async()=>{
  const {app,p}=await setup();
  const a=await p.createIntent('Work','Maybe someday','Work'),b=await p.createIntent('Work','Another possibility','Work');
  assert.notEqual(a.uid,b.uid);assert.notEqual(a.file.path,b.file.path);
  assert.equal(p.tasks().length,0);assert.equal(p.waitingAll().length,0);assert.equal((await p.collect(false)).length,0);
  assert.deepEqual(p.notes().map(n=>n.area).sort(),['Life','Work']);
  const fm=frontmatter(app,a.file.path);
  for(const key of ['status','scheduled','due','completedDate','priority','area'])assert.equal(fm[key],undefined);
  assert.equal(fm.type,'замысел');assert.equal(fm.intentArea,'Work');assert.equal((await p.intentCards()).length,2);
});

test('saving an idea preserves identity, custom metadata and rehomes its owned parent',async()=>{
  const {app,p}=await setup();
  const file=writeNote(app,'Areas/Idea.md',{type:'замысел',uid:'idea-id',title:'First',intentArea:'Work',parents:['[[Work]]','[[Context]]'],custom:{deep:['x']}},'Original');
  const idea=(await p.intentCards())[0];await p.saveIntent(idea,'Renamed','New text','Life');
  const fm=frontmatter(app,file.path);
  assert.equal(fm.uid,'idea-id');assert.equal(fm.title,'Renamed');assert.deepEqual(fm.custom,{deep:['x']});
  assert.deepEqual(fm.parents,['[[Context]]','[[Areas/Life]]']);assert.equal((await p.intentCards())[0].body,'New text');
});

test('a cloud body edit refuses a stale idea save',async()=>{
  const {app,p}=await setup();const idea=await p.createIntent('Idea','Original','Work');
  await app.vault.modify(idea.file,(await raw(app,idea.file)).replace('Original','External'));
  await assert.rejects(p.saveIntent(idea,'Local','Draft','Life'),/intent-conflict/);
  assert.match(await raw(app,idea.file),/External/);assert.equal(frontmatter(app,idea.file.path).title,'Idea');
});

test('same-named ideas cannot turn an external area parent into a self-link',async()=>{
  const {app,p}=await setup();const area=writeNote(app,'Base/Finance.md',{type:'область',area:'Money'});p.forgetScan();
  const idea=await p.createIntent('Finance','Possibility','Money'),fm=frontmatter(app,idea.file.path);
  assert.deepEqual(fm.parents,['[[Base/Finance]]']);assert.equal(app.metadataCache.getFirstLinkpathDest('Base/Finance',idea.file.path),area);
  await p.saveIntent(idea,idea.title,'Changed','Work');assert.deepEqual(frontmatter(app,idea.file.path).parents,['[[Areas/Work]]']);
});

test('deleting an area keeps its free material; Undo restores the area without duplicating cards',async()=>{
  const {app,p}=await setup(),idea=await p.createIntent('Consider options','Independent material','Work'),before=await raw(app,idea.file);
  await p.removeArea({name:'Work',projects:[]});assert.equal(await raw(app,idea.file),before);
  assert.equal((await p.intentCards()).length,1);assert.equal(p.notes().some(n=>n.area==='Work'),false);
  await p.undo();assert.equal(p.notes().some(n=>n.area==='Work'),true);assert.equal((await p.intentCards()).length,1);
});

test('another identity or deleted idea cannot be overwritten or generate tasks',async()=>{
  const {app,p}=await setup();const idea=await p.createIntent('Idea','Body','Work');
  await app.vault.modify(idea.file,(await raw(app,idea.file)).replace(idea.uid,'replacement-id'));
  await assert.rejects(p.taskFromIntent(idea,'Do it','Work'),/intent-conflict/);
  await assert.rejects(p.saveIntent(idea,'Local','Draft','Work'),/intent-conflict/);
  await app.vault.delete(idea.file);await assert.rejects(p.saveIntent(idea,'Local','Draft','Work'),/intent-conflict/);
  assert.equal(p.tasks().length,0);
});

test('an unrelated metadata edit survives an idea save',async()=>{
  const {app,p}=await setup();const idea=await p.createIntent('Idea','Body','Work');
  await app.vault.modify(idea.file,(await raw(app,idea.file)).replace('type: замысел','extra: external\ntype: замысел'));
  await p.saveIntent(idea,'Idea','Updated','Work');assert.equal(frontmatter(app,idea.file.path).extra,'external');
});

test('derived tasks keep their own identities and source; one Undo leaves the idea untouched',async()=>{
  const {app,p}=await setup();const idea=await p.createIntent('Consider travel','Possible routes','Life'),before=await raw(app,idea.file);
  const task=await p.taskFromIntent(idea,'Choose a city','Life');
  assert.equal(frontmatter(app,task.file.path).scheduled,undefined);assert.match(frontmatter(app,task.file.path).source,/Consider travel/);
  assert.notEqual(task.uid,idea.uid);assert.equal(await raw(app,idea.file),before);
  await p.undo();assert.equal(p.tasks().length,0);assert.equal(await raw(app,idea.file),before);
  const next=await p.taskFromIntent(idea,'Choose a date','Life','2030-01-05');assert.equal(frontmatter(app,next.file.path).scheduled,'2030-01-05');
});

test('TODO cards preserve original bytes, infer one area and exclude fenced examples',async()=>{
  const {app,p}=await setup();
  const body='# Context\nKeep this\n\n```md\n### TODO\n- [ ] Example only\n```\n\n### TODO Software\n- [ ] Explore tools\n\n### Material\nKeep that\n';
  const f=writeNote(app,'Notes/Source.md',{parents:['[[Work]]']},body),before=await raw(app,f);
  const cards=await p.intentCards();assert.equal(cards.length,1);assert.equal(cards[0].area,'Work');assert.match(cards[0].body,/Explore tools/);
  assert.equal(await raw(app,f),before);assert.equal(p.tasks().length,0);
});

test('nested TODO headings belong to one source card',async()=>{
  const {app,p}=await setup();writeNote(app,'Notes/Source.md',{},'## TODO\nIdea\n### TODO child\nDetails\n## Other\nRest');
  const cards=await p.intentCards();assert.equal(cards.length,1);assert.match(cards[0].body,/TODO child/);
});

test('ambiguous parents stay unassigned and disabling TODO discovery keeps real ideas',async()=>{
  const {app,p}=await setup();writeNote(app,'Notes/Source.md',{parents:['[[Work]]','[[Life]]']},'## TODO\nIdea');
  assert.equal((await p.intentCards())[0].area,null);
  await p.createIntent('A real idea','',null);p.settings.todoIdeas=false;
  assert.equal((await p.intentCards()).length,1);
});

test('editing a source card preserves other sections and external edits outside its block',async()=>{
  const {app,p}=await setup();const f=writeNote(app,'Notes/Source.md',{keep:['x']},'# Intro\nOld intro\n### TODO\nOld idea\n### Other\nKeep it\n');
  const card=(await p.intentCards())[0];await app.vault.modify(f,(await raw(app,f)).replace('Old intro','External intro'));
  await p.saveIntent(card,card.title,'New idea\n',null);
  const after=await raw(app,f);assert.match(after,/External intro/);assert.match(after,/### Other\nKeep it/);assert.match(after,/### TODO\nNew idea/);assert.deepEqual(frontmatter(app,f.path).keep,['x']);
});

test('binding one TODO card does not move another block of the same note',async()=>{
  const {app,p}=await setup();const f=writeNote(app,'Notes/Source.md',{parents:['[[Work]]']},'### TODO One\nFirst\n### TODO Two\nSecond\n');
  const card=(await p.intentCards()).find(c=>c.title.endsWith('One'));await p.saveIntent(card,card.title,card.body,'Life');
  const cards=await p.intentCards();assert.equal(cards.find(c=>c.title.endsWith('One')).area,'Life');assert.equal(cards.find(c=>c.title.endsWith('Two')).area,'Work');
  assert.deepEqual(frontmatter(app,f.path).parents,['[[Work]]']);
});

test('changed or ambiguous TODO blocks refuse stale writes',async()=>{
  const {app,p}=await setup();const f=writeNote(app,'Notes/Source.md',{},'### TODO\nOriginal\n');const card=(await p.intentCards())[0];
  await app.vault.modify(f,(await raw(app,f)).replace('Original','External'));
  await assert.rejects(p.saveIntent(card,card.title,'Draft',null),/intent-conflict/);assert.match(await raw(app,f),/External/);
});

test('source editing preserves CRLF, history and paragraphs outside TODO',async()=>{
  const {app,p}=await setup();const f=await app.vault.create('Notes/CRLF.md','---\r\nkeep: yes\r\n---\r\n## TODO\r\n- [x] Past\r\n- [ ] Idea\r\n## Other\r\nOutside\r\n');
  const card=(await p.intentCards())[0];await p.saveIntent(card,card.title,card.body.replace('Idea','Changed'),null);
  const after=await raw(app,f);assert.ok(!/(?<!\r)\n/.test(after));assert.match(after,/- \[x\] Past/);assert.match(after,/## Other\r\nOutside/);
});

test('empty titles do not create files',async()=>{const {app,p}=await setup();const n=app.vault.files.size;await assert.rejects(p.createIntent('  '));assert.equal(app.vault.files.size,n);});

test('a card deleted by Sync during reading does not break the Focus view',async()=>{
  const {app,p}=await setup();const idea=await p.createIntent('Remote deletion','Body','Work');p.read();
  const read=app.vault.cachedRead.bind(app.vault);app.vault.cachedRead=async file=>{if(file===idea.file){await app.vault.trash(file);throw Error('gone');}return read(file);};
  assert.equal((await p.intentCards()).length,0);assert.equal(p.notes().length,2);assert.equal(p.tasks().length,0);
});

test('deleting an idea preserves derived tasks; Undo restores its identity and body',async()=>{
  const {app,p}=await setup(),idea=await p.createIntent('Discard','Free text','Work'),task=await p.taskFromIntent(idea,'Ready action','Work');
  await p.removeIntent(idea);assert.equal(app.vault.getAbstractFileByPath(idea.file.path),null);assert.equal(p.tasks()[0].uid,task.uid);
  await p.undo();assert.equal(p.read().intents[0].uid,idea.uid);assert.equal(await raw(app,p.read().intents[0].file),idea.raw);assert.equal(p.tasks()[0].uid,task.uid);
});

test('a stale deletion never removes a cloud body or metadata edit',async()=>{
  const {app,p}=await setup(),idea=await p.createIntent('Guard deletion','Free text','Work');
  await app.vault.modify(idea.file,idea.raw.replace('type: замысел','external: changed\ntype: замысел'));
  await assert.rejects(p.removeIntent(idea),/intent-conflict/);assert.match(await raw(app,idea.file),/external: changed/);
  const current=(await p.intentCards())[0];await app.vault.modify(idea.file,current.raw.replace('Free text','Cloud body'));
  await assert.rejects(p.removeIntent(current),/intent-conflict/);assert.match(await raw(app,idea.file),/Cloud body/);
});

test('deleting source material preserves outside edits and views; changed block or type refuses',async()=>{
  const {app,p}=await setup(),f=writeNote(app,'Notes/Delete block.md',{},'Intro\n## TODO\nKeep idea\n```focus-tasks\n```\nOther\n');
  const card=(await p.intentCards())[0];await app.vault.modify(f,(await raw(app,f))+'External\n');
  await p.removeIntent(card);assert.match(await raw(app,f),/Intro\n```focus-tasks\n```\nOther\n\nExternal/);await p.undo();assert.match(await raw(app,f),/## TODO\nKeep idea/);
  const next=(await p.intentCards())[0];await app.vault.modify(f,(await raw(app,f)).replace('Keep idea','Changed idea'));await assert.rejects(p.removeIntent(next),/intent-conflict/);
  await app.vault.modify(f,(await raw(app,f)).replace('{}','type: задача'));const source=(await raw(app,f));
  await assert.rejects(p.removeIntent({...next,legacy:{...next.legacy,snapshot:next.legacy.snapshot.replace('Keep idea','Changed idea')}}),/intent-conflict/);assert.equal(await raw(app,f),source);
});

test('deriving an action requires its own text',async()=>{
  const {app,p}=await setup(),idea=await p.createIntent('Context note','Material','Work');await assert.rejects(p.taskFromIntent(idea,'  ','Work'),/intent-invalid/);assert.equal(p.tasks().length,0);
});

test('an ordinary note without type in the task folder is not a task',async()=>{
  const {app,p}=await setup();writeNote(app,'Tasks/Material.md',{uid:'ordinary'},'Context');p.forgetScan();
  assert.equal(p.tasks().length,0);assert.equal(p.isTaskType(undefined),false);
});

test('migration moves each block, keeps prose and history, and preserves all outside bytes',async()=>{
  const {app,p}=await setup();
  const f=writeNote(app,'Notes/Source.md',{parents:['[[Work]]'],other:'keep'},'Intro\n## TODO Tools\n- [ ] Explore\n  - [x] Old\n```md\n- [ ] Literal example\n```\n## Context\nKeep\n## TODO\nSecond idea\n## Tail\nEnd\n');
  const before=await raw(app,f), result=await p.migrateTodoFile(f,before);
  assert.equal(result.moved.length,2);assert.equal(p.tasks().length,0);assert.equal(p.notes().length,2);
  assert.equal(result.after,before.replace(/## TODO Tools[\s\S]*?(?=## Context)/,'').replace(/## TODO\n[\s\S]*?(?=## Tail)/,''));
  const cards=await p.intentCards();assert.equal(cards.length,2);assert.ok(cards.every(c=>c.area==='Work'&&c.sourceFile===f));
  assert.match(cards.find(c=>c.title.includes('Tools')).body,/- Explore\n  - ~~Old~~/);assert.match(cards[0].body,/Literal example|Second idea/);
  assert.match(cards.find(c=>c.title.includes('Tools')).body,/- \[ \] Literal example/);
  assert.equal((await p.migrateTodoFile(f)).moved.length,0);assert.equal((await p.intentCards()).length,2);
});

test('migration removes empty headings, preserves CRLF and duplicates as separate cards',async()=>{
  const {app,p}=await setup();const f=await app.vault.create('Notes/CRLF.md','---\r\nkeep: yes\r\n---\r\n## TODO\r\n- [x] Past\r\n## TODO\r\nSame heading\r\n## TODO Empty\r\n\r\n## Other\r\nOutside\r\n');
  const r=await p.migrateTodoFile(f);assert.equal(r.moved.length,3);assert.equal(r.moved.filter(c=>c.empty).length,1);
  assert.equal((await p.intentCards()).length,2);assert.equal(await raw(app,f),'---\r\nkeep: yes\r\n---\r\n## Other\r\nOutside\r\n');
  assert.match((await p.intentCards())[0].body,/\r\n/);
});

test('a source write failure preserves original and retry reuses verified copies',async()=>{
  const {app,p}=await setup();const f=writeNote(app,'Notes/Failure.md',{},'## TODO\nOne\n## TODO Next\nTwo\n'),before=await raw(app,f),process=app.vault.process.bind(app.vault);
  app.vault.process=async(file,fn)=>{if(file===f)throw Error('disk failure');return process(file,fn);};
  await assert.rejects(p.migrateTodoFile(f),/disk failure/);assert.equal(await raw(app,f),before);assert.equal(p.read().intents.length,2);
  app.vault.process=process;await p.migrateTodoFile(f,before);assert.equal(p.read().intents.length,2);assert.equal(await raw(app,f),before.slice(0,before.indexOf('## TODO')));
});

test('failed creation and concurrent source edits never remove original material',async()=>{
  const {app,p}=await setup();const f=writeNote(app,'Notes/Race.md',{},'## TODO\nOne\n## Tail\nKeep\n'),before=await raw(app,f),create=app.vault.create.bind(app.vault);
  app.vault.create=async()=>{throw Error('no space');};await assert.rejects(p.migrateTodoFile(f),/no space/);assert.equal(await raw(app,f),before);
  app.vault.create=async(path,text)=>{const out=await create(path,text);await app.vault.modify(f,before+'External\n');return out;};
  await assert.rejects(p.migrateTodoFile(f),/intent-conflict/);assert.equal(await raw(app,f),before+'External\n');assert.equal(p.read().intents.length,1);
});

test('edited recovery cards refuse migration; expected source and excluded files are guarded',async()=>{
  const {app,p}=await setup();const f=writeNote(app,'Notes/Guard.md',{},'## TODO\nKeep original\n'),before=await raw(app,f),process=app.vault.process.bind(app.vault);
  await assert.rejects(p.migrateTodoFile(f,'stale'),/intent-conflict/);assert.equal(p.read().intents.length,0);
  app.vault.process=async(file,fn)=>{if(file===f)throw Error('disk');return process(file,fn);};await assert.rejects(p.migrateTodoFile(f));app.vault.process=process;
  const card=p.read().intents[0];await app.vault.modify(card.file,(await raw(app,card.file)).replace('Keep original','Edited copy'));
  await assert.rejects(p.migrateTodoFile(f),/intent-conflict/);assert.equal(await raw(app,f),before);assert.equal(p.read().intents.length,1);
  const internal=writeNote(app,'Internals/Example.md',{},'## TODO\nLiteral\n');await assert.rejects(p.migrateTodoFile(internal),/intent-ineligible/);
});

test('one migration Undo restores the source and removes only its imported cards',async()=>{
  const {app,p}=await setup();const f=writeNote(app,'Notes/Undo.md',{},'Intro\n## TODO\nOne\n## TODO More\nTwo\n'),before=await raw(app,f);
  await p.migrateTodoFile(f);await p.undo();assert.equal(await raw(app,f),before);assert.equal(p.read().intents.length,0);
});

test('embedded Focus views terminate TODO material and remain in their original note',async()=>{
  const {app,p}=await setup();const f=writeNote(app,'Notes/Area source.md',{parents:['[[Work]]']},'## TODO\n- [ ] Consider\n\n```focus-tasks\n```\nFollowing context\n'),before=await raw(app,f);
  const r=await p.migrateTodoFile(f);assert.equal(r.moved.length,1);assert.ok((await raw(app,f)).endsWith('```focus-tasks\n```\nFollowing context\n\n'));
  assert.equal((await p.intentCards())[0].body,'- Consider\n\n');
  await p.undo();assert.equal(await raw(app,f),before);
  const empty=writeNote(app,'Notes/Empty source.md',{},'## TODO\n\n```focus-tasks\n```\n');
  assert.equal((await p.migrateTodoFile(empty)).moved[0].empty,true);assert.ok((await raw(app,empty)).endsWith('```focus-tasks\n```\n\n'));
});

test('indented TODO headings migrate while info-bearing markers inside examples never end their fence',async()=>{
  const {app,p}=await setup(),example='```md\n```js\n# TODO Literal\n- [ ] Example\n```\n',f=writeNote(app,'Notes/Fences.md',{},example+'  ## TODO Real\n- [ ] Material\n## Tail\nKeep\n');
  const r=await p.migrateTodoFile(f);assert.equal(r.moved.length,1);assert.match(await raw(app,f),/```js\n# TODO Literal\n- \[ \] Example/);assert.equal((await p.intentCards())[0].body,'- Material\n');
});
