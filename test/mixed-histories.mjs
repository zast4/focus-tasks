// Mixed task/idea lifecycles. Assertions read raw notes, independently of the renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FakeApp, loadPlugin, areaNote, projectNote, taskNote, frontmatter, bodyOf} from './harness.mjs';
const today=()=>new Date().toLocaleDateString('sv-SE');
const rng=seed=>()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
const privateTarget=l=>({area:l.area,project:l.file.basename,projectFile:l.file,intentList:true,listUid:l.uid});
const raw=app=>app.vault.getMarkdownFiles().map(f=>({f,fm:frontmatter(app,f.path),body:bodyOf(app,f.path)})).filter(x=>['задача','замысел'].includes(x.fm.type));
const seeds=Number(process.env.FT_MIXED_SEEDS||30),steps=Number(process.env.FT_MIXED_STEPS||100);

test(`${seeds} mixed histories of ${steps} actions preserve private domains, identity and discoverability`,async()=>{
 for(let seed=1;seed<=seeds;seed++){
  const random=rng(seed),app=new FakeApp();
  for(const a of ['Work','Life','Study'])areaNote(app,a);
  for(const a of ['Work','Life'])projectNote(app,a,`${a} project`,{uid:`project-${a}`});
  for(let n=0;n<6;n++)taskNote(app,`Seed ${n}`,{area:n%2?'Work':'Life',scheduled:n%2?today():null,custom:{seed,n}},`Context ${n}\n\n- instruction`);
  const p=await loadPlugin(app);
  for(const a of ['Work','Life']){
   const l=await p.createIntentList(`${a} ideas`,a);
   const t=await p.createTask(`${a} possibility`,privateTarget(l),null);
   await p.frontOwned(t.file,fm=>{fm.custom={private:true};});
  }
  for(let n=0;n<steps;n++){
   p.forgetScan();
   const all=[...p.tasks(),...p.read().intentTasks],t=all[Math.floor(random()*all.length)];
   if(!t)throw Error('fixture unexpectedly empty');
   const before=new Map(raw(app).map(x=>[x.fm.uid,x]));
   const op=Math.floor(random()*15),area=['Work','Life','Study'][Math.floor(random()*3)];
   try{
    if(op===0)await p.setScheduled(t,random()<.3?null:today(),random()<.5?null:'16:30');
    if(op===1)await p.setPriority(t,random()<.5?'low':'high');
    if(op===2)await p.toggle(t);
    if(op===3)await p.rename(t,`Mixed ${seed} ${n}`);
    if(op===4&&all.length<35)await p.duplicateTasks([t]);
    if(op===5)await p.setWaiting(t,true,'2035-08-12','12:15');
    if(op===6)await p.setWaiting(t,false);
    if(op===7)await p.moveTasks([t],{target:{type:'area',area:{name:area}},pile:random()<.5?'focus':'ahead',into:true});
    if(op===8){const l=p.read().intents.filter(x=>x.isList)[Math.floor(random()*2)];await p.moveTasks([t],{target:{type:'project',area:{name:l.area},project:{...l,intentList:true}},pile:'intents',into:true});}
    if(op===14)await p.moveTasks([t],{target:{type:'area-title',area:{name:area}},pile:'intents',into:true});
    if(op===9&&t.intent)await p.promoteIntentTask(t,today());
    if(op===10&&all.length>2)await p.removeTask(t);
    if(op===11)await p.undo();
    if(op===12){const l=p.read().intents.filter(x=>x.isList)[Math.floor(random()*2)];await p.moveIntentList(l,area);}
    if(op===13){const project=p.notes().find(x=>x.project&&x.area==='Work');await p.moveTasks([t],{target:{type:'project',area:{name:'Work'},project},pile:'focus',into:true});}
    p.forgetScan();
    const disk=raw(app),uids=disk.map(x=>x.fm.uid);
    assert.ok(uids.every(Boolean),'every entry has a stable identity');
    assert.equal(new Set(uids).size,uids.length,'identities remain distinct across both domains');
    const canonical=disk.filter(x=>x.fm.type==='задача'),privateNotes=disk.filter(x=>x.fm.type==='замысел');
    assert.deepEqual(new Set(p.tasks().map(x=>x.uid)),new Set(canonical.map(x=>x.fm.uid)),'all canonical files are indexed');
    assert.deepEqual(new Set(p.read().intentTasks.map(x=>x.uid)),new Set(privateNotes.map(x=>x.fm.uid)),'all private entries are indexed');
    for(const x of disk){
     assert.ok(!x.fm.scheduled || /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(x.fm.scheduled),'stored schedules remain valid dates or local datetimes');
     const old=before.get(x.fm.uid);
     if(old){assert.equal(x.body,old.body,'body survives transitions and Undo');assert.deepEqual(x.fm.custom,old.fm.custom,'foreign YAML survives');}
    }
    const shown=(await p.collect(true)).flatMap(a=>[...a.rows,...a.ahead,...a.done].flatMap(r=>r.kind==='project'?r.steps:[r.task]).filter(Boolean));
    const found=new Set([...shown,...p.waitingAll()].map(x=>x.uid));
    for(const x of canonical.filter(x=>!['done','cancelled','someday'].includes(x.fm.status)))assert.ok(found.has(x.fm.uid),'active task remains discoverable');
    for(const x of privateNotes){
     const entry=p.read().intentTasks.find(e=>e.uid===x.fm.uid),list=p.read().intents.find(l=>l.isList&&l.uid===entry.listUid);
     if(entry.loose){assert.ok(entry.area,'loose private entry belongs to an area');assert.equal(entry.listUid,null);assert.equal(entry.project,null);}else{
     assert.ok(list,'private entry has a live owning list');
     assert.ok(p.intentEntries(list).some(e=>e.uid===entry.uid),'list contains its entry');}
     assert.ok(!found.has(entry.uid),'private entry never leaks into actionable queues');
     assert.equal(p.calendarStatus(entry,{enabled:true}),null,'private entry never claims a Calendar reminder');
    }
   }catch(e){e.message=`seed=${seed}, action=${n}, operation=${op}: ${e.message}`;throw e;}
  }
 }
});
