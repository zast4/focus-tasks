// Selection contracts apply to the actual selected entities, not the first step shown in a compact project row.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FakeApp, loadPlugin, areaNote, projectNote, taskNote, frontmatter, bodyOf} from './harness.mjs';
const groups=['loose','two steps','project','project and step','task and idea','all domains'];
for(const group of groups)for(const gesture of ['day preserving hours','explicit clock','clear date']){
 test(`${group}: grouped ${gesture} preserves entity ownership and one Undo`,async()=>{
  const app=new FakeApp();areaNote(app,'Work');
  const project=projectNote(app,'Work','Project',{uid:'project-identity',scheduled:'2035-08-12'});
  taskNote(app,'Loose',{area:'Work',scheduled:'2035-08-12T00:00',custom:{untouched:true}},'Loose instructions');
  taskNote(app,'Step A',{area:'Work',project:'Project',scheduled:'2035-08-12T16:30'},'Step instructions');
  taskNote(app,'Step B',{area:'Work',project:'Project',scheduled:'2035-08-12T17:45',status:'waiting'},'Delegated instructions');
  const p=await loadPlugin(app),list=await p.createIntentList('Options','Work');
  await p.createTask('Idea',{area:'Work',project:list.file.basename,projectFile:list.file,intentList:true,listUid:list.uid},'2035-08-12T11:00');
  const loose=p.tasks().find(t=>t.text==='Loose'),steps=p.tasks().filter(t=>t.project==='Project'),idea=p.read().intentTasks[0],handle={isProject:true,file:project,uid:'p:'+project.path};
  const selected=group==='loose'?[loose]:group==='two steps'?steps:group==='project'?[handle]:group==='project and step'?[handle,steps[0]]:group==='task and idea'?[loose,idea]:[loose,...steps,handle,idea];
  const files=[project,...p.tasks().map(t=>t.file),idea.file,list.file];
  const before=new Map(files.map(f=>[f.path,app.vault.files.get(f.path)]));
  const old=new Map(files.map(f=>[f.path,{fm:frontmatter(app,f.path),body:bodyOf(app,f.path)}]));
  p.history=[];
  const day=gesture==='clear date'?null:'2035-09-13';
  await p.setDates(selected,day,gesture==='explicit clock'?'09:15':undefined);
  assert.equal(p.history.length,selected.some(x=>!x.isProject)?1:0,'only editable tasks own one undo entry');
  for(const f of files){
   const previous=old.get(f.path),fm=frontmatter(app,f.path),entity=selected.find(t=>t.file.path===f.path);
   assert.equal(bodyOf(app,f.path),previous.body);
   assert.equal(fm.uid,previous.fm.uid);
   assert.equal(fm.type,previous.fm.type);
   // Waiting is a dated return, not an indefinite holding pen. Removing its
   // return date explicitly returns the task to the ordinary open queue.
   assert.equal(fm.status,entity&&gesture==='clear date'&&previous.fm.status==='waiting'?'open':previous.fm.status);
   assert.deepEqual(fm.projects,previous.fm.projects);
   assert.deepEqual(fm.custom,previous.fm.custom);
   if(!entity||entity.isProject){assert.equal(app.vault.files.get(f.path),before.get(f.path),'unselected notes remain byte-identical');continue;}
   const hour=entity.isProject?null:gesture==='explicit clock'?'09:15':String(previous.fm.scheduled||'').split('T')[1];
   const expected=day?day+(hour?'T'+hour:''):undefined;
   assert.equal(fm.scheduled,expected,'project clocks do not spill into their steps; explicit midnight is preserved');
  }
  if(selected.some(x=>!x.isProject))await p.undo();
  for(const f of files)assert.equal(app.vault.files.get(f.path),before.get(f.path),'one Undo restores every original byte');
 });
}
