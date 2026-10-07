import test from 'node:test';
import assert from 'node:assert/strict';
import {FakeApp,loadPlugin,areaNote,projectNote,taskNote,frontmatter,bodyOf,writeNote} from './harness.mjs';
const today=()=>new Date().toLocaleDateString('sv-SE');
async function setup(){const app=new FakeApp();const work=areaNote(app,'Work'),home=areaNote(app,'Home');const p=await loadPlugin(app);return{app,p,work,home};}
const areaDrop=area=>({into:true,pile:'intents',target:{type:'area-title',area:{name:area}}});
test('loose ideas have identity and an area without becoming legacy cards or canonical tasks',async()=>{
 const{app,p}=await setup();const entry=await p.createTask('Possibility',{area:'Work',intentLoose:true},today()+'T11:00');
 assert.equal(entry.intent,true);assert.equal(entry.loose,true);assert.equal(entry.project,null);assert.equal(entry.listUid,null);
 assert.equal(p.tasks().length,0);assert.equal((await p.collect(true)).flatMap(a=>a.rows).length,0);
 assert.equal(p.read().intents.length,0);assert.equal(p.read().intentTasks.length,1);
 const legacy=await p.createIntent('Old card','prose','Work');assert.equal(p.intentOf(legacy.file).isList,false);assert.equal(p.read().intentTasks.length,1);
 assert.equal(frontmatter(app,entry.file.path).projects,undefined);
});
test('loose idea rename, duplicate, scheduling, movement, completion and undo preserve the private domain',async()=>{
 const{app,p}=await setup();let entry=await p.createTask('Possibility',{area:'Work',intentLoose:true},null);
 await p.frontOwned(entry.file,fm=>{fm.custom={keep:'yes'};});const body=bodyOf(app,entry.file.path);
 await p.rename(entry,'New possibility');entry=p.read().intentTasks.find(x=>x.uid===entry.uid);
 await p.setScheduled(entry,today(),'12:34');const[copied]=await p.duplicateTasks([entry]);assert.notEqual(copied.uid,entry.uid);assert.equal(copied.intent,true);assert.equal(copied.loose,true);await p.undo();
 await p.moveTasks([entry],areaDrop('Home'));entry=p.read().intentTasks.find(x=>x.uid===entry.uid);assert.equal(entry.area,'Home');assert.equal(entry.at,'12:34');assert.equal(entry.loose,true);assert.equal(p.tasks().length,0);
 await p.toggle(entry);assert.equal(p.read().intentTasks.find(x=>x.uid===entry.uid).status,'done');await p.undo();
 const fm=frontmatter(app,entry.file.path);assert.deepEqual(fm.custom,{keep:'yes'});assert.equal(bodyOf(app,entry.file.path),body);
});
for(const destination of ['focus','ahead'])test(`a loose idea is explicitly promoted into ${destination}, without a null source link`,async()=>{
 const{app,p}=await setup();const entry=await p.createTask('Possibility',{area:'Work',intentLoose:true},today()+'T11:20');
 p.history=[];await p.moveTasks([entry],{into:true,pile:destination,target:{type:'area-title',area:{name:'Home'}}});
 const task=p.tasks().find(x=>x.uid===entry.uid),fm=frontmatter(app,entry.file.path);assert.equal(task.area,'Home');assert.equal(fm.intentLoose,undefined);assert.equal(fm.source,undefined);assert.equal(fm.type,'задача');assert.equal(p.history.length,1);await p.undo();assert.equal(p.read().intentTasks[0].loose,true);
});
test('a canonical task becomes a loose idea through the same drop operation and undoes atomically',async()=>{
 const{app,p}=await setup(),file=taskNote(app,'Step',{area:'Work',scheduled:today()+'T10:45',custom:{a:1}},'Important description');const entry=p.taskOf(file),before=app.vault.files.get(file.path),body=bodyOf(app,file.path);
 p.history=[];await p.moveTasks([entry],areaDrop('Home'));assert.equal(p.tasks().length,0);const privateEntry=p.read().intentTasks[0];assert.equal(privateEntry.uid,entry.uid);assert.equal(privateEntry.loose,true);assert.equal(privateEntry.area,'Home');assert.equal(privateEntry.at,'10:45');assert.equal(bodyOf(app,file.path),body);assert.deepEqual(frontmatter(app,file.path).custom,{a:1});assert.equal(p.history.length,1);await p.undo();assert.equal(app.vault.files.get(file.path),before);
});
test('a loose idea can enter and leave a list while keeping its UID, time and description',async()=>{
 const{app,p}=await setup(),list=await p.createIntentList('List','Home'),entry=await p.createTask('Possibility',{area:'Work',intentLoose:true},today()+'T13:15');
 await p.moveTasks([entry],{into:true,pile:'intents',target:{type:'project',area:{name:'Home'},project:{...list,intentList:true}}});
 assert.equal(frontmatter(app,entry.file.path).intentLoose,undefined);assert.equal(p.intentEntries(list)[0].uid,entry.uid);
 await p.moveTasks([p.intentEntries(list)[0]],areaDrop('Work'));const moved=p.read().intentTasks[0];assert.equal(moved.loose,true);assert.equal(moved.listUid,null);assert.equal(moved.at,'13:15');assert.equal(p.intentEntries(list).length,0);
});
for(const status of ['open','done','cancelled','waiting','someday'])test(`project conversion preserves a ${status} step and one undo restores both entities`,async()=>{
 const{app,p,work}=await setup(),file=projectNote(app,'Work','Project',{uid:'project-uid',custom:{x:1},parents:['[[Areas/Work]]','[[Reference]]']}),stepFile=taskNote(app,'Step',{area:'Work',projects:['[[Project]]'],status,scheduled:today()+'T14:00',priority:'low',custom:{keep:1}},'Step details');
 const before=new Map(app.vault.files),body=bodyOf(app,stepFile.path);p.history=[];
 const list=await p.projectToIntentList({file,uid:'project-uid'},'Home');
 assert.equal(list.uid,'project-uid');assert.equal(list.isList,true);assert.equal(list.area,'Home');assert.equal(p.notes().some(x=>x.file===file),false);assert.equal(p.tasks().length,0);
 const step=p.intentEntries(list)[0];assert.equal(step.uid,frontmatter(app,stepFile.path).uid);assert.equal(step.status,status);assert.equal(step.at,'14:00');assert.equal(step.area,'Home');assert.equal(bodyOf(app,stepFile.path),body);assert.deepEqual(frontmatter(app,stepFile.path).custom,{keep:1});assert.deepEqual(frontmatter(app,file.path).custom,{x:1});assert.ok(frontmatter(app,file.path).parents.includes('[[Reference]]'));
 assert.equal(p.history.length,1);await p.undo();for(const[path,raw]of before)assert.equal(app.vault.files.get(path),raw,path);
});
test('dragging a project onto Ideas changes its kind instead of silently dropping the gesture',async()=>{
 const{app,p,work,home}=await setup(),file=projectNote(app,'Work','Project',{uid:'p'}),step=taskNote(app,'Step',{area:'Work',projects:['[[Project]]']});p.history=[];
 await p.drop({type:'project',area:{name:'Work',note:work},project:{file,uid:'p'}},{...areaDrop('Home'),target:{type:'area-title',area:{name:'Home',note:home}}},{tasks:{}});
 assert.equal(frontmatter(app,file.path).type,'список замыслов');assert.equal(frontmatter(app,step.path).intentListUid,'p');assert.equal(p.history.length,1);await p.undo();assert.equal(frontmatter(app,file.path).type,'project');
});
test('project conversion keeps pre-existing bound idea lists and unbinds them without deleting descriptions',async()=>{
 const{app,p}=await setup(),file=projectNote(app,'Work','Project',{uid:'p'}),list=await p.createIntentList('Existing possibilities','Work');await p.bindIntentList(list,file);
 const entry=await p.createTask('Old idea',{area:'Work',projectFile:list.file,project:list.file.basename,intentList:true,listUid:list.uid},null);const before=app.vault.files.get(entry.file.path);
 await p.projectToIntentList({file,uid:'p'});assert.equal(p.read().intents.filter(x=>x.isList).length,2);assert.equal(app.vault.files.get(entry.file.path),before);assert.equal(frontmatter(app,list.file.path).intentProjectUid,undefined);await p.undo();assert.equal(frontmatter(app,list.file.path).intentProjectUid,'p');
});
test('project conversion refuses a replaced UID before touching steps',async()=>{
 const{app,p}=await setup(),file=projectNote(app,'Work','Project',{uid:'old'}),step=taskNote(app,'Step',{area:'Work',projects:['[[Project]]']});const before=app.vault.files.get(step.path);await p.frontOwned(file,fm=>{fm.uid='replacement';});
 await assert.rejects(()=>p.projectToIntentList({file,uid:'old'}),/intent-conflict/);assert.equal(app.vault.files.get(step.path),before);assert.equal(frontmatter(app,file.path).type,'project');
});
test('new private entries return their true domain before Obsidian publishes metadata',async()=>{
 const{app,p}=await setup(),list=await p.createIntentList('Options','Work');
 const read=app.metadataCache.getFileCache.bind(app.metadataCache);app.metadataCache.getFileCache=file=>file.path.startsWith('Tasks/')?null:read(file);
 const entry=await p.createTask('First idea',{area:'Work',intentList:true,projectFile:list.file,project:list.file.basename,listUid:list.uid},null);
 assert.equal(entry.intent,true);assert.equal(entry.listUid,list.uid);assert.equal(entry.uid,frontmatter(app,entry.file.path).uid);
 app.metadataCache.getFileCache=read;
});
test('binding returns the written list and project UID despite stale list metadata',async()=>{
 const{app,p}=await setup(),project=projectNote(app,'Work','Project'),list=await p.createIntentList('Options','Work'),read=app.metadataCache.getFileCache.bind(app.metadataCache),stale=read(list.file);
 app.metadataCache.getFileCache=file=>file===list.file?stale:read(file);
 const bound=await p.bindIntentList(list,project);assert.equal(bound.isList,true);assert.equal(bound.projectUid,frontmatter(app,project.path).uid);assert.equal(bound.projectLink,'[['+project.path.replace(/\.md$/,'')+']]');app.metadataCache.getFileCache=read;
});

test('removing an area includes loose ideas and one Undo restores every original byte',async()=>{
 const{app,p,work}=await setup();const task=await p.createTask('Loose',{area:'Work',intentLoose:true,noDate:true},null);const before=new Map(app.vault.files);p.history=[];
 await p.removeArea({name:'Work',note:work});assert.equal(app.vault.getAbstractFileByPath(task.file.path),null);assert.equal(p.read().intentTasks.length,0);assert.equal(p.history.length,1);
 await p.undo();for(const[path,text]of before)assert.equal(app.vault.files.get(path),text,path);
});

test('a converted project code block remains scoped to the same idea container',async()=>{
 const{p,app}=await setup(),file=projectNote(app,'Work','Scoped');const before=p.blockPage('',file.path);assert.equal(before.project,file);
 const list=await p.projectToIntentList({file});assert.equal(p.blockPage('',file.path).intent,file);assert.equal(p.blockPage('project: [[Scoped]]','Other.md').intent,file);await p.undo();assert.equal(p.blockPage('',file.path).project,file);assert.equal(list.uid,frontmatter(app,file.path).uid||list.uid);
});

test('an idea whose list is temporarily missing stays visible under its area without losing the binding',async()=>{
 const{app,p}=await setup(),list=await p.createIntentList('Sync list','Work'),entry=await p.createTask('Partial sync',{area:'Work',projectFile:list.file,project:list.file.basename,intentList:true,listUid:list.uid},null);const body=app.vault.files.get(list.file.path),entryBefore=app.vault.files.get(entry.file.path);
 assert.equal(p.unboundIntent(p.read().intentTasks.find(x=>x.uid===entry.uid)),false);await app.vault.delete(list.file);const pending=p.read().intentTasks.find(x=>x.uid===entry.uid);assert.equal(p.unboundIntent(pending),true);assert.equal(pending.area,'Work');assert.equal(pending.listUid,list.uid);assert.equal(app.vault.files.get(entry.file.path),entryBefore);
 await app.vault.create(list.file.path,body);assert.equal(p.unboundIntent(p.read().intentTasks.find(x=>x.uid===entry.uid)),false);assert.equal(app.vault.files.get(entry.file.path),entryBefore);assert.equal(p.intentEntries(p.intentOf(app.vault.getAbstractFileByPath(list.file.path)))[0].uid,entry.uid);
});
for(const kind of ['project','idea list'])test(`duplicating a completed entry reopens its ${kind} in the same Undo`,async()=>{
 const{app,p}=await setup();let parent,entry;
 if(kind==='project'){parent=projectNote(app,'Work','Closed project',{uid:'closed-project',status:'done'});const f=taskNote(app,'Finished',{area:'Work',project:'Closed project',status:'done',completedDate:today(),scheduled:today()},'Keep instructions');entry=p.taskOf(f);}
 else{const list=await p.createIntentList('Closed list','Work');parent=list.file;entry=await p.createTask('Finished',{area:'Work',projectFile:parent,project:parent.basename,intentList:true,listUid:list.uid},null);await p.frontOwned(entry.file,fm=>{fm.status='done';fm.completedDate=today();});await p.setProjectDone(parent,true,list.uid);entry=p.read().intentTasks.find(x=>x.uid===entry.uid);}
 const before=new Map(app.vault.files);p.history=[];const[copy]=await p.duplicateTasks([entry]);assert.equal(copy.status,'open');assert.notEqual(copy.uid,entry.uid);assert.equal(frontmatter(app,parent.path).status,undefined);assert.equal(p.history.length,1);
 if(kind==='project'){const a=(await p.collect(true)).find(a=>a.name==='Work');assert.ok([...a.rows,...a.ahead].some(r=>r.kind==='project'&&r.project.file===parent&&r.steps.some(t=>t.uid===copy.uid)));}
 else{const list=p.intentOf(parent);assert.equal(list.done,false);assert.equal(p.closedIntentList(list),false);assert.ok(p.intentEntries(list).some(t=>t.uid===copy.uid));}
 await p.undo();assert.deepEqual(new Map(app.vault.files),before);
});

test('duplicating an imported idea gets its own identity without another migration item key',async()=>{
 const{app,p}=await setup(),list=await p.createIntentList('Imported','Work');const task=await p.createTask('Possibility',{area:'Work',projectFile:list.file,project:list.file.basename,intentList:true,listUid:list.uid},null);
 await p.frontOwned(task.file,fm=>{fm.intentItemImportKey='source-item';fm.custom={keep:true};});const before=new Map(app.vault.files);p.history=[];const[copy]=await p.duplicateTasks([task]);assert.equal(frontmatter(app,task.file.path).intentItemImportKey,'source-item');assert.equal(frontmatter(app,copy.file.path).intentItemImportKey,undefined);assert.deepEqual(frontmatter(app,copy.file.path).custom,{keep:true});await p.undo();assert.deepEqual(new Map(app.vault.files),before);
});
