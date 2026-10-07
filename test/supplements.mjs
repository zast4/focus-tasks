import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeApp, loadPlugin, areaNote, projectNote, frontmatter, writeNote } from './harness.mjs';

async function setup() {
  const app = new FakeApp(); areaNote(app, 'Work'); areaNote(app, 'Life');
  const file = projectNote(app, 'Work', 'Build');
  return { app, file, p: await loadPlugin(app) };
}
const target = list => ({ area: list.area, project: list.file.basename, projectFile: list.file, intentList: true, listUid: list.uid });
async function entry(p, file, title = 'Possibility') { const list = await p.ensureProjectIntentList(file); return { list, task: await p.createTask(title, target(list), null) }; }

test('local supplement toggles are independent, collapse on repeat and never touch All', async () => {
  const { p } = await setup(); p.setEverything(true);
  const later = { key: 'future:Work' };
  await p.toggleSupplement('intents:Work', 'backlog', later);
  assert.equal(p.isShown(later.key, true), true);
  await p.toggleSupplement('intents:Work', 'intents', later);
  assert.equal(p.isShown(later.key, true), true); assert.equal(p.isShown('intents:Work', true), true);
  await p.toggleSupplement('intents:Work', 'intents', later);
  assert.equal(p.isShown('intents:Work', true), false); assert.equal(p.isShown(later.key, true), true);
  assert.equal(p.everything(), true);
});

test('revealing a folded area keeps an enabled category on and leaves the others unchanged', async () => {
  const { p, file } = await setup();
  const key='intents:Work',later={key:'futureoff:Work',inverted:true},focus={key:'focusoff:Work',inverted:true};
  await p.toggleSupplement(key,'intents',later,focus);
  p.data.opened['project-focuson:'+file.path]=true;p.data.opened['later:'+file.path]=true;
  for(const kind of ['focus','backlog','intents']){
    assert.equal(await p.toggleSupplement(key,kind,later,focus,true),true);
    assert.equal(p.categoryShown(focus),true);assert.equal(p.categoryShown(later),true);assert.equal(p.isShown(key,true),true);
  }
  assert.equal(p.categoryShown(focus),true); assert.equal(p.categoryShown(later),true);
  assert.equal(p.isShown('later:'+file.path,true),false);
  assert.equal(p.everything(),false);
});

test('revealing a disabled category enables it without enabling other categories', async () => {
  const { p } = await setup();
  const key='intents:Work',later={key:'future:Work'},focus={key:'focusoff:Work',inverted:true};
  await p.toggleSupplement(key,'focus',later,focus);
  assert.equal(await p.toggleSupplement(key,'backlog',later,focus,true),true);
  assert.equal(p.categoryShown(later),true);assert.equal(p.categoryShown(focus),true);assert.equal(p.isShown(key,true),false);
  assert.equal(await p.toggleSupplement(key,'backlog',later,focus),false);
});

test('inverted All backlog folds correctly when selecting and closing ideas', async () => {
  const { p } = await setup(); const later = { key: 'futureoff:Work', inverted: true };
  await p.toggleSupplement('intents:Work', 'intents', later);
  assert.equal(p.isShown(later.key, true), false);
  await p.toggleSupplement('intents:Work', 'backlog', later);
  assert.equal(p.isShown(later.key, true), true); assert.equal(p.isShown('intents:Work', true), true);
  await p.toggleSupplement('intents:Work', 'backlog', later); assert.equal(p.isShown(later.key, true), false);
});

test('project note and common row share supplement selection; other areas stay independent', async () => {
  const { p, file } = await setup(); const key = 'project-intents:' + file.path;
  await p.toggleSupplement('intents:Life', 'intents');
  await p.toggleSupplement(key, 'intents', { key: 'pagefold:' + file.path, inverted: true });
  assert.equal(p.isShown('later:' + file.path, true), false);
  await p.toggleSupplement(key, 'backlog', { key: 'later:' + file.path });
  assert.equal(p.isShown('pagefold:' + file.path, true), false); assert.equal(p.isShown(key, true), true);
  assert.equal(p.isShown('intents:Life', true), true);
});

test('opening an empty project ideas view is read-only and list creation is idempotent', async () => {
  const { app, p, file } = await setup(); const before = await app.vault.read(file);
  await p.toggleSupplement('project-intents:' + file.path, 'intents');
  assert.equal(p.projectIntentLists(file).length, 0); assert.equal(await app.vault.read(file), before);
  const [a, b] = await Promise.all([p.ensureProjectIntentList(file), p.ensureProjectIntentList(file)]);
  assert.equal(a.uid, b.uid); assert.equal(p.read().intents.length, 1); assert.equal(p.tasks().length, 0);
  assert.equal(a.projectUid, frontmatter(app, file.path).uid);
  assert.equal(frontmatter(app, a.file.path).projects, undefined);
});

test('an existing list can be bound without changing its entries or source context', async () => {
  const { app, p, file } = await setup(); const list = await p.createIntentList('Ideas', 'Work');
  const task = await p.createTask('Keep me', target(list), null); const before = await app.vault.read(task.file);
  const bound = await p.bindIntentList(list, file);
  assert.equal(bound.uid, list.uid); assert.equal(await app.vault.read(task.file), before);
  assert.equal(p.projectIntentLists(file)[0].uid, list.uid);
  const detached = await p.bindIntentList(bound, null); assert.equal(detached.projectUid, null);
  assert.equal(p.read().intentTasks[0].uid, task.uid);
});

test('a project has one collection; conflicting binding preserves both collections', async () => {
  const { app, p, file } = await setup(); const first = await p.ensureProjectIntentList(file), second = await p.createIntentList('Other', 'Work');
  const before = await app.vault.read(second.file);
  await assert.rejects(p.bindIntentList(second, file), /already|уже/);
  assert.equal(await app.vault.read(second.file), before); assert.equal(p.projectIntentLists(file)[0].uid, first.uid);
});

test('project rename keeps UID, list identity, entry bytes and scoped fold; Undo restores binding', async () => {
  const { app, p, file } = await setup(); const { list, task } = await entry(p, file); const bytes = await app.vault.read(task.file), uid = frontmatter(app, file.path).uid;
  await p.setOpen('project-intents:' + file.path, true);
  await p.renameProject(file, 'Build renamed');
  assert.equal(frontmatter(app, file.path).uid, uid); assert.equal(p.projectIntentLists(file)[0].uid, list.uid);
  assert.equal(await app.vault.read(task.file), bytes);
  assert.equal(p.isShown('project-intents:' + file.path, true), true);
  assert.equal(frontmatter(app, list.file.path).intentProject, '[[Areas/Build renamed]]');
  await p.undo(); assert.equal(file.path, 'Areas/Build.md'); assert.equal(p.projectIntentLists(file)[0].uid, list.uid);
});

test('external rename with automatic link updates disabled still resolves project by UID', async () => {
  const { app, p, file } = await setup(); const { list } = await entry(p, file);
  await app.vault.rename(file, 'Areas/External.md');
  assert.equal(p.intentProjectFile(list)?.path, file.path); assert.equal(p.projectIntentLists(file)[0].uid, list.uid);
});

test('moving a project moves its private collection and entries as one undoable operation', async () => {
  const { app, p, file } = await setup(); const { list, task } = await entry(p, file);
  const areas = await p.collect(true), from = areas.find(a => a.name === 'Work'), to = areas.find(a => a.name === 'Life');
  await p.track('Move', [file], tx => p.moveProject(from.projects[0], from, to, tx));
  assert.equal(frontmatter(app, list.file.path).intentArea, 'Life'); assert.equal(frontmatter(app, task.file.path).intentArea, 'Life');
  assert.equal(p.projectIntentLists(file)[0].uid, list.uid); assert.equal(p.tasks().length, 0);
  await p.undo(); assert.equal(frontmatter(app, file.path).area, 'Work'); assert.equal(frontmatter(app, task.file.path).intentArea, 'Work');
});

test('an external project area edit is reflected in idea views without editing private notes', async () => {
  const { app, p, file } = await setup(); const { list, task } = await entry(p, file), before = await app.vault.read(task.file);
  await app.fileManager.processFrontMatter(file, fm => fm.area = 'Life');
  assert.equal(p.read().intents.find(x => x.uid === list.uid).area, 'Life'); assert.equal(p.read().intentTasks.find(x => x.uid === task.uid).area, 'Life');
  assert.equal(await app.vault.read(task.file), before);
});

test('moving a linked collection itself to another area detaches its project; Undo restores it', async () => {
  const { p, file } = await setup(); const { list, task } = await entry(p, file);
  await p.moveIntentList(list, 'Life'); assert.equal(p.projectIntentLists(file).length, 0);
  assert.equal(p.read().intentTasks.find(x => x.uid === task.uid).area, 'Life');
  await p.undo(); assert.equal(p.projectIntentLists(file)[0].uid, list.uid);
});

test('promoting a project idea keeps its UID, body and project in the normal backlog', async () => {
  const { app, p, file } = await setup(); const { list, task } = await entry(p, file);
  await app.vault.modify(task.file, (await app.vault.read(task.file)) + '\nDetails [[Reference]]');
  await p.promoteIntentTask(task);
  const actual = p.tasks().find(x => x.uid === task.uid);
  assert.equal(p.projectFile(actual)?.path, file.path); assert.equal(actual.date, null);
  assert.match(await app.vault.read(actual.file), /Details \[\[Reference\]\]/); assert.equal(p.intentEntries(list).length, 0);
  await p.undo(); assert.equal(p.tasks().length, 0); assert.equal(p.intentEntries(list)[0].uid, task.uid);
});

test('deleting a project also deletes its ideas and one Undo restores all identities', async () => {
  const { app, p, file } = await setup(); const { list, task } = await entry(p, file), uid = frontmatter(app, file.path).uid;
  const area = (await p.collect(true)).find(a => a.name === 'Work');
  await p.removeProject(area, area.projects[0], true);
  assert.equal(app.vault.getAbstractFileByPath(file.path), null); assert.equal(p.read().intentTasks.length, 0); assert.equal(p.read().intents.length, 0);
  await p.undo(); assert.equal(frontmatter(app, 'Areas/Build.md').uid, uid); assert.equal(p.read().intents[0].uid, list.uid); assert.equal(p.read().intentTasks[0].uid, task.uid);
});

test('removing a project while keeping its tasks also keeps and detaches its idea collection', async () => {
  const { p, file } = await setup(); const { list, task } = await entry(p, file);
  const area = (await p.collect(true)).find(a => a.name === 'Work');
  await p.removeProject(area, area.projects[0], false);
  assert.equal(p.read().intents[0].uid, list.uid); assert.equal(p.read().intents[0].projectUid, null); assert.equal(p.read().intentTasks[0].uid, task.uid);
});

test('replacing a deleted project with the same filename never steals its ideas', async () => {
  const { app, p, file } = await setup(); const { list } = await entry(p, file);
  await app.vault.delete(file); const other = writeNote(app, 'Areas/Build.md', { type: 'project', area: 'Work', uid: 'foreign-project' });
  assert.equal(p.intentProjectFile(list), null); assert.equal(p.projectIntentLists(other).length, 0);
  assert.equal(p.read().intents[0].uid, list.uid);
});

test('a stale bind or unbind refuses another writer\'s changed project membership', async () => {
  const { app, p, file } = await setup(); const list = await p.createIntentList('Shared', 'Work');
  await app.fileManager.processFrontMatter(list.file, fm => { fm.intentProjectUid = 'foreign'; fm.intentProject = '[[Areas/Foreign]]'; });
  await assert.rejects(p.bindIntentList(list, file), /intent-conflict/);
  await assert.rejects(p.bindIntentList(list, null), /intent-conflict/);
  assert.equal(frontmatter(app, list.file.path).intentProjectUid, 'foreign');
});

test('renaming an automatic project collection makes its custom title explicit', async () => {
  const { app, p, file } = await setup(); const list = await p.ensureProjectIntentList(file);
  assert.equal(frontmatter(app, list.file.path).intentProjectDefault, true);
  await p.renameIntentList(list, 'Custom collection');
  assert.equal(frontmatter(app, list.file.path).intentProjectDefault, undefined);
  assert.equal(p.projectIntentLists(file)[0].title, 'Custom collection');
});

test('rebinding a project collection across areas moves every entry and Undo restores the old owner', async () => {
  const { app, p, file } = await setup(); const { list, task } = await entry(p, file);
  const other = projectNote(app, 'Life', 'Other');
  const moved = await p.bindIntentList(list, other);
  assert.equal(p.intentProjectFile(moved)?.path, other.path);
  assert.equal(frontmatter(app, list.file.path).intentArea, 'Life'); assert.equal(frontmatter(app, task.file.path).intentArea, 'Life');
  assert.equal(p.projectIntentLists(file).length, 0);
  await p.undo(); assert.equal(p.projectIntentLists(file)[0].uid, list.uid); assert.equal(frontmatter(app, task.file.path).intentArea, 'Work');
});

test('parent and child ideas open exclusively while unrelated areas remain open', async () => {
  const { p, file } = await setup(); const key = 'project-intents:' + file.path;
  await p.toggleSupplement('intents:Life', 'intents'); await p.toggleSupplement('intents:Work', 'intents');
  await p.toggleSupplement(key, 'intents'); assert.equal(p.isShown('intents:Work', true), false);
  await p.toggleSupplement('intents:Work', 'intents'); assert.equal(p.isShown(key, true), false);
  assert.equal(p.isShown('intents:Life', true), true);
});

test('programmatic opening after search or moving a list also respects parent/child exclusivity', async () => {
  const { p, file } = await setup(); const key = 'project-intents:' + file.path;
  await p.setOpen(key, true); await p.setOpen('intents:Work', true); assert.equal(p.isShown(key, true), false);
  await p.setOpen(key, true); assert.equal(p.isShown('intents:Work', true), false);
});

test('legacy hidden Focus preferences cannot hide tasks; other categories stay independent', async () => {
  for (let mask = 0; mask < 8; mask++) {
    const { p } = await setup(); p.setEverything(true);
    const later = { key: 'future:Work' }, focus = { key: 'focusoff:Work', inverted: true };
    if (!(mask & 1)) await p.toggleSupplement('intents:Work', 'focus', later, focus);
    if (mask & 2) await p.toggleSupplement('intents:Work', 'backlog', later, focus);
    if (mask & 4) await p.toggleSupplement('intents:Work', 'intents', later, focus);
    assert.equal(p.categoryShown(focus), true); assert.equal(p.categoryShown(later), !!(mask & 2));
    assert.equal(p.isShown('intents:Work', true), !!(mask & 4)); assert.equal(p.everything(), true);
  }
});

test('project focus/backlog overrides have the same state in note and list, without touching ideas', async () => {
  const { p, file } = await setup(), path = file.path, key = 'project-intents:' + path;
  const later = { key: 'later:' + path, projectPath: path, defaultOpen: true };
  const focus = { key: 'project-focusoff:' + path, onKey: 'project-focuson:' + path, defaultOpen: true };
  await p.toggleSupplement(key, 'intents', later, focus);
  assert.equal(p.categoryShown(later), true);
  await p.toggleSupplement(key, 'backlog', later, focus);
  assert.equal(p.categoryShown({ ...later, defaultOpen: false }), false);
  assert.equal(p.isShown(key, true), true);
  await p.toggleSupplement(key, 'focus', later, focus);
  assert.equal(p.categoryShown(focus), true); assert.equal(p.isShown(key, true), true);
  await p.toggleSupplement(key, 'focus', later, focus);
  assert.equal(p.categoryShown({ ...focus, defaultOpen: false }), true);
  assert.equal(p.categoryShown(later), false);
});

test('category changes persist only device folds, never task/list/project files or counters', async () => {
  const { p, app, file } = await setup(); await entry(p, file);
  const before = [...app.vault.files.entries()];
  const focus = { key: 'focusoff:Work', inverted: true }, later = { key: 'future:Work' };
  for (const kind of ['focus', 'backlog', 'intents', 'focus', 'backlog', 'intents']) await p.toggleSupplement('intents:Work', kind, later, focus);
  assert.deepEqual([...app.vault.files.entries()], before);
  assert.equal(p.read().intentTasks.length, 1); assert.equal(p.tasks().length, 0);
});

test('scope counts include hidden steps, returned Waiting, exclude pending Waiting and closed/private records', async () => {
  const { p, file } = await setup(); const day = new Date().toLocaleDateString('en-CA');
  const tg = { area: 'Work', project: file.basename, projectFile: file };
  for (let i = 0; i < 3; i++) await p.createTask('Focus '+i, tg, day);
  await p.createTask('Later', tg, null);
  const returned = await p.createTask('Returned', tg, '2000-01-01'); await p.setWaiting(returned, true);
  const pending = await p.createTask('Pending', tg, '2099-01-01'); await p.setWaiting(pending, true);
  const done = await p.createTask('Done', tg, day); await p.toggle(done);
  await entry(p, file);
  const scope = (await p.collect(false, true)).find(a => a.name === 'Work');
  assert.deepEqual([p.scopeTasks(scope).focus.length, p.scopeTasks(scope).backlog.length], [4,1]);
  assert.deepEqual([p.scopeTasks(scope,file.path).focus.length,p.scopeTasks(scope,file.path).backlog.length],[4,1]);
  const before = p.scopeTasks(scope); p.data.opened['steps:'+file.path] = true; p.data.opened['focusoff:Work'] = true;
  assert.deepEqual(p.scopeTasks((await p.collect(false,true)).find(a=>a.name==='Work')),before);
});

test('scope counts follow effective project-date membership and avoid duplicate step identities', async () => {
  const { p, file } = await setup(), day = new Date().toLocaleDateString('en-CA');
  await p.createTask('Dated today', { area:'Work', project:file.basename, projectFile:file }, day);
  await p.createTask('Undated', { area:'Work', project:file.basename, projectFile:file }, null);
  await p.frontOwned(file,fm=>fm.scheduled='2099-01-01');
  let scope = (await p.collect(false,true)).find(a=>a.name==='Work');
  assert.deepEqual([p.scopeTasks(scope).focus.length,p.scopeTasks(scope).backlog.length],[1,1]);
  await p.frontOwned(file,fm=>fm.scheduled='2000-01-01');
  scope = (await p.collect(false,true)).find(a=>a.name==='Work');
  assert.deepEqual([p.scopeTasks(scope).focus.length,p.scopeTasks(scope).backlog.length],[1,1]);
  scope.rows.push(scope.rows[0]);scope.ahead.push(scope.ahead[0]);
  assert.deepEqual([p.scopeTasks(scope).focus.length,p.scopeTasks(scope).backlog.length],[1,1]);
});

test('area category switches reset local overrides without expanding projects', async () => {
  const { p,file } = await setup(), key='project-intents:'+file.path;
  const focus={key:'project-focusoff:'+file.path,onKey:'project-focuson:'+file.path,defaultOpen:true};
  const later={key:'later:'+file.path,projectPath:file.path,defaultOpen:false};
  await p.toggleSupplement(key,'focus',later,focus);
  await p.toggleSupplement(key,'backlog',later,focus);
  await p.toggleSupplement('intents:Work','intents');
  const areaFocus={key:'focusoff:Work',inverted:true}, areaLater={key:'future:Work'};
  await p.toggleSupplement('intents:Work','focus',areaLater,areaFocus);
  assert.equal(p.categoryShown(focus),true);assert.equal(p.categoryShown(later),true);
  await p.toggleSupplement('intents:Work','focus',areaLater,areaFocus);
  assert.equal(p.categoryShown(focus),true);
  await p.toggleSupplement('intents:Work','backlog',areaLater,areaFocus);
  assert.equal(p.categoryShown({...later,inherited:true,defaultOpen:true}),true);
  assert.equal(p.isShown('later:'+file.path,true),false);
  await p.toggleSupplement('intents:Work','backlog',areaLater,areaFocus);
  assert.equal(p.categoryShown(later),false);assert.equal(p.categoryShown(focus),true);
  assert.equal(p.isShown('intents:Work',true),true);
});


test('Focus availability follows effective scope membership, not visibility or task count alone', async () => {
  const { p, file } = await setup();
  const target={area:'Work',project:file.basename,projectFile:file};
  await p.frontOwned(file,fm=>fm.scheduled='2099-01-01');
  await p.createTask('Future step',target,'2099-01-01');
  let area=(await p.collect(false,true)).find(a=>a.name==='Work');
  assert.equal(p.scopeTasks(area).hasFocus,false);
  assert.equal(p.scopeTasks(area,file.path).hasFocus,false);
  assert.equal(p.scopeTasks(undefined).hasFocus,false);
  await p.frontOwned(file,fm=>fm.scheduled='2000-01-01');
  area=(await p.collect(false,true)).find(a=>a.name==='Work');
  assert.equal(p.scopeTasks(area).hasFocus,false);
  p.data.opened['focusoff:Work']=true;
  p.data.opened['project-focusoff:'+file.path]=true;
  assert.equal(p.scopeTasks((await p.collect(false,true)).find(a=>a.name==='Work')).hasFocus,false);
});

test('area backlog inherits compact previews without writing project expansion preferences', async () => {
  const { p, app, file } = await setup(), path = file.path;
  const later = { key: 'future:Work' }, focus = { key: 'focusoff:Work', inverted: true };
  p.data.opened['steps:' + path] = true;
  p.data.opened['project-header:' + path] = true;
  p.data.opened['project-local-ahead:' + path] = true;
  p.data.opened['later:' + path] = true;
  const files = new Map(app.vault.files);
  for (const on of [true, false, true, false]) {
    assert.equal(await p.toggleSupplement('intents:Work', 'backlog', later, focus), on);
    assert.equal(p.isShown('steps:' + path, true), true);
    for (const prefix of ['project-header:', 'project-local-ahead:', 'later:', 'pagefold:']) assert.equal(p.isShown(prefix + path, true), false);
    assert.equal(p.categoryShown({key:'later:'+path,projectPath:path,inherited:true,defaultOpen:on}), on);
    assert.equal(p.categoryShown(focus), true);
  }
  assert.deepEqual(new Map(app.vault.files), files);
});

test('local category chooses its preview without importing another area bucket or hiding Focus', async () => {
  const { p, file } = await setup(), path = file.path;
  const focus = {key:'project-focusoff:'+path,onKey:'project-focuson:'+path,defaultOpen:true,inherited:true,hostPile:'focus'};
  const later = {key:'later:'+path,projectPath:path,defaultOpen:false,inherited:true};
  p.data.opened['later:'+path] = true; // stale inherited state from the old area implementation
  assert.equal(p.categoryShown(later), false);
  await p.toggleSupplement('project-intents:'+path, 'backlog', later, focus);
  assert.equal(p.isShown('project-header:'+path,true), true);
  assert.equal(p.isShown('project-local-ahead:'+path,true), false);
  assert.equal(p.categoryShown({...focus,inherited:false}), true);
  assert.equal(p.categoryShown({...later,inherited:false}), true);
  for (let i=0;i<3;i++) {
    await p.toggleSupplement('project-intents:'+path, 'focus', {...later,inherited:false}, {...focus,inherited:false});
    assert.equal(p.categoryShown({...focus,inherited:false}), true);
    assert.equal(p.categoryShown({...later,inherited:false}), true);
  }
});

test('local backlog placement and folding follow a project rename and Undo', async () => {
  const { p, file } = await setup(), path = file.path;
  for(const prefix of ['project-local-ahead:','backlog-steps:']) p.data.opened[prefix+path]=true;
  await p.renameProject(file, 'Renamed project');
  for(const prefix of ['project-local-ahead:','backlog-steps:']) { assert.equal(p.isShown(prefix+file.path,true),true); assert.equal(p.isShown(prefix+path,true),false); }
  await p.undo();
  for(const prefix of ['project-local-ahead:','backlog-steps:']) assert.equal(p.isShown(prefix+path,true),true);
});

test('a legacy project date cannot create an empty Focus area', async () => {
  const { p, file } = await setup();
  await p.frontOwned(file,fm=>fm.scheduled='2000-01-01');
  let area=(await p.collect(false,true)).find(a=>a.name==='Work');
  assert.equal(p.scopeTasks(area,file.path).focus.length,0);
  assert.equal(p.scopeTasks(area,file.path).hasFocus,false);
  assert.equal(p.scopeTasks(area).hasFocus,false);
});
