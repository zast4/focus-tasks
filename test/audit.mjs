// Regression cases from the reliability audit. Gates make concurrency reproducible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeApp, loadPlugin, areaNote, projectNote, taskNote, frontmatter, bodyOf } from './harness.mjs';

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function stand() {
  const app = new FakeApp();
  areaNote(app, 'Home');
  taskNote(app, 'First', { area: 'Home', scheduled: '2026-10-02' });
  taskNote(app, 'Second', { area: 'Home', scheduled: '2026-10-02' });
  const plugin = await loadPlugin(app);
  return { app, plugin, first: plugin.tasks().find(t => t.text === 'First'), second: plugin.tasks().find(t => t.text === 'Second') };
}

test('Undo never deletes a note created by another writer during a plugin change', async () => {
  const { app, plugin, first } = await stand();
  const entered = gate(), resume = gate();
  const original = app.vault.process.bind(app.vault);
  app.vault.process = async (...args) => { entered.resolve(); await resume.promise; return original(...args); };
  const change = plugin.setDate(first, '2026-10-04');
  await entered.promise;
  await app.vault.create('Notes/External.md', 'Written by another device');
  resume.resolve();
  await change;
  await plugin.undo();
  assert.equal(app.vault.files.get('Notes/External.md'), 'Written by another device');
  assert.equal(frontmatter(app, first.file.path).scheduled, '2026-10-02');
});

test('a change failing after its first write remains undoable', async () => {
  const { app, plugin, first } = await stand();
  await assert.rejects(plugin.track('fault injection', [first.file], async () => {
    await plugin.setFields(first, { scheduled: '2026-10-04' });
    throw new Error('disk failed before next write');
  }), /disk failed/);
  await plugin.undo();
  assert.equal(frontmatter(app, first.file.path).scheduled, '2026-10-02');
});

test('an unrelated change stays queued even when another write takes over 1.5 seconds', async () => {
  const { app, plugin, first, second } = await stand();
  const entered = gate(), resume = gate();
  const original = app.vault.process.bind(app.vault);
  app.vault.process = async (file, fn) => {
    if (file.path === first.file.path) { entered.resolve(); await resume.promise; }
    return original(file, fn);
  };
  const one = plugin.setDate(first, '2026-10-04');
  await entered.promise;
  let finished = false;
  const two = plugin.setDate(second, '2026-10-05').then(() => { finished = true; });
  await sleep(1650);
  const ranEarly = finished;
  resume.resolve();
  await Promise.all([one, two]);
  assert.equal(ranEarly, false, 'a slow disk must not merge two user gestures into one Undo');
  await plugin.undo();
  assert.equal(frontmatter(app, first.file.path).scheduled, '2026-10-04');
  assert.equal(frontmatter(app, second.file.path).scheduled, '2026-10-02');
});

test('explicitly removing the time clears the live row time too', async () => {
  const { plugin, first } = await stand();
  await plugin.setWaiting(first, true, '2026-10-04', '18:30');
  await plugin.setScheduled(first, '2026-10-05', null);
  assert.equal(first.date, '2026-10-05');
  assert.equal(first.at, null);
});

test('changing the day preserves the reminder hour from the current file', async () => {
  const { app, plugin, first } = await stand();
  await plugin.setScheduled(first, '2026-10-04', '18:30');
  await app.fileManager.processFrontMatter(first.file, fm => { fm.scheduled='2026-10-04T19:45'; });
  await plugin.setDate(first, '2026-10-05');
  assert.equal(first.at, '19:45');
  assert.equal(frontmatter(app, first.file.path).scheduled, '2026-10-05T19:45');
  await plugin.setDate(first, null);
  assert.equal(first.at, null);
  assert.equal(frontmatter(app, first.file.path).scheduled, undefined);
});

test('Duplicate refuses a different task which has replaced the selected path', async () => {
  const { app, plugin, first } = await stand();
  taskNote(app, 'First', { uid: 'ft-replacement', area: 'Home', title: 'Another task' });
  plugin.forgetScan();
  const before = new Map(app.vault.files);
  const copies = await plugin.duplicateTasks([first]);
  assert.deepEqual(copies, []);
  assert.deepEqual(app.vault.files, before);
});

test('Duplicate reads the current title from disk rather than the old row', async () => {
  const { app, plugin, first } = await stand();
  await app.fileManager.processFrontMatter(first.file, fm => { fm.title = 'Edited on the phone'; });
  plugin.forgetScan();
  const [copy] = await plugin.duplicateTasks([first]);
  assert.equal(frontmatter(app, copy.file.path).title, 'Edited on the phone');
  assert.notEqual(copy.uid, first.uid);
});

test('deleting a stale selection never deletes a replacement note', async () => {
  const { app, plugin, first } = await stand();
  taskNote(app, 'First', { uid: 'ft-replacement', area: 'Home', title: 'Another task' });
  plugin.forgetScan();
  const before = app.vault.files.get(first.file.path);
  await plugin.removeTask(first);
  assert.equal(app.vault.files.get(first.file.path), before);
});

test('task creation gets distinct identities even with a frozen clock and random source', async () => {
  const { plugin } = await stand();
  const random = Math.random, now = Date.now;
  let one, two;
  try {
    Math.random = () => 0.5;
    Date.now = () => 1790946000000;
    one = await plugin.createTask('One', { area: 'Home' }, null);
    two = await plugin.createTask('Two', { area: 'Home' }, null);
  } finally { Math.random = random; Date.now = now; }
  assert.notEqual(one.uid, two.uid);
});

test('Undo preserves an order changed by another writer after the gesture', async () => {
  const { plugin, first } = await stand();
  await plugin.setDate(first, '2026-10-04');
  plugin.data.order.tasks['area:Home'] = ['external-order'];
  await plugin.undo();
  assert.deepEqual(plugin.data.order.tasks['area:Home'], ['external-order']);
});

test('Undo does not resurrect a task deleted by another writer after a date change', async () => {
  const { app, plugin, first } = await stand();
  await plugin.setDate(first, '2026-10-04');
  await app.vault.trash(first.file);
  await plugin.undo();
  assert.equal(app.vault.files.has(first.file.path), false);
});

test('Undoing a project move restores the area of every step too', async () => {
  const { app, plugin } = await stand();
  const from = app.vault.file('Areas/Home.md');
  const to = areaNote(app, 'Work');
  const file = projectNote(app, 'Home', 'Project');
  taskNote(app, 'Step', { area: 'Home', project: 'Project' });
  plugin.forgetScan();
  await plugin.drop({ type: 'project', project: { file }, area: { name: 'Home', note: from } },
    { into: true, target: { type: 'area-title', area: { name: 'Work', note: to } } }, { tasks: {} });
  assert.equal(frontmatter(app, 'Tasks/Step.md').area, 'Work');
  await plugin.undo();
  assert.equal(frontmatter(app, 'Tasks/Step.md').area, 'Home');
  assert.equal(frontmatter(app, file.path).area, 'Home');
});

test('every task edit preserves nested foreign YAML, quoted scalars and the description', async () => {
  const { app, plugin, first } = await stand();
  const nested = { timeEntries: [{ start: '2026-10-02T10:00:00Z', duration: 31, metadata: { device: 'phone' } }],
    reminders: [{ id: 'other', type: 'absolute', absoluteTime: '2026-10-05T12:00:00Z' }],
    custom: { text: 'yes', empty: null, comma: ['a,b', 'c'], enabled: false } };
  await app.fileManager.processFrontMatter(first.file, fm => Object.assign(fm, nested));
  await app.vault.process(first.file, text => text + '\nDescription\n\n- a list\n');
  const body = bodyOf(app, first.file.path);
  await plugin.setDate(first, '2026-10-04');
  await plugin.setPriority(first, 'low');
  await plugin.setWaiting(first, true, '2026-10-05', '12:00');
  const fm = frontmatter(app, first.file.path);
  for (const [key, value] of Object.entries(nested)) assert.deepEqual(fm[key], value);
  assert.equal(bodyOf(app, first.file.path), body);
});

test('Duplicate and task-to-project conversion handle CRLF frontmatter without leaking it into the body', async () => {
  const { app, plugin, first } = await stand();
  const original = app.vault.files.get(first.file.path) + '\nSome instructions\n';
  app.vault.files.set(first.file.path, original.replaceAll('\n', '\r\n'));
  plugin.forgetScan();
  const [copy] = await plugin.duplicateTasks([first]);
  assert.ok(copy);
  const file = await plugin.toProject(first);
  const body = bodyOf(app, file.path);
  assert.ok(body.includes('Some instructions'));
  assert.equal(body.includes('uid:'), false);
});

test('a YAML key beginning with --- is not a frontmatter closing fence', async () => {
  const { app, plugin, first } = await stand();
  const text = app.vault.files.get(first.file.path).replace('status: open', '---custom: kept\nstatus: open');
  app.vault.files.set(first.file.path, text);
  plugin.forgetScan();
  const [copy] = await plugin.duplicateTasks([first]);
  assert.ok(copy);
  assert.equal(frontmatter(app, copy.file.path)['---custom'], 'kept');
});

test('a bare block in an area note identifies only that area, including an area outside the settings folder', async () => {
  const { app, plugin } = await stand();
  areaNote(app, 'Other');
  const area = await plugin.createArea('Personal');
  assert.equal(plugin.blockPage('', area.path).area.path, area.path);
  assert.equal(plugin.blockPage('area: [[Other]]', 'Notes/Dashboard.md').area.path, 'Areas/Other.md');
  assert.equal(plugin.blockPage('area: [[missing]]', '').kind, 'area');
  assert.equal(plugin.blockPage('area: [[missing]]', '').area, null);
});

test('adding an area view is idempotent and leaves its frontmatter and prose intact', async () => {
  const { app, plugin } = await stand();
  const area = app.vault.file('Areas/Home.md');
  await app.vault.process(area, text => text + '\nSome context\n');
  const before = frontmatter(app, area.path);
  assert.equal(await plugin.ensureAreaBlock(area), true);
  assert.equal(await plugin.ensureAreaBlock(area), false);
  assert.deepEqual(frontmatter(app, area.path), before);
  const body = bodyOf(app, area.path);
  assert.ok(body.includes('Some context'));
  assert.equal((body.match(/```focus-tasks/g) || []).length, 1);
});

test('a linked area view explicitly names its owner rather than showing every area', async () => {
  const { app, plugin } = await stand();
  const area = app.vault.file('Areas/Home.md');
  const linked = await app.vault.create('Notes/Personal.md', 'My note\n');
  assert.equal(await plugin.ensureAreaBlock(linked, area), true);
  assert.ok(app.vault.files.get(linked.path).includes('area: [[Home]]'));
  assert.equal(await plugin.ensureAreaBlock(linked, area), false);
});

test('Undo of a task rename also brings incoming wiki links back to its restored name', async () => {
  const { app, plugin, first } = await stand();
  await app.vault.create('Notes/Reference.md', 'Context [[First]]');
  await plugin.rename(first, 'Renamed');
  assert.equal(app.vault.files.get('Notes/Reference.md'), 'Context [[Renamed]]');
  await plugin.undo();
  assert.equal(app.vault.files.get('Notes/Reference.md'), 'Context [[First]]');
  assert.ok(app.vault.files.has('Tasks/First.md'));
  assert.equal(app.vault.files.has('Tasks/Renamed.md'), false);
});

test('Undo refuses a conflicted rename as a whole instead of resurrecting a duplicate uid', async () => {
  const { app, plugin, first } = await stand();
  await plugin.rename(first, 'Renamed');
  await app.vault.process(first.file, text => text + '\nAdded by another device\n');
  await plugin.undo();
  assert.equal(app.vault.files.has('Tasks/First.md'), false);
  assert.ok(app.vault.files.get('Tasks/Renamed.md').includes('Added by another device'));
  assert.equal(plugin.tasks().filter(t => t.uid === first.uid).length, 1);
});

test('a failed file rename still preserves the text the user saved', async () => {
  const { app, plugin, first } = await stand();
  app.fileManager.renameFile = async () => { throw new Error('rename denied'); };
  await assert.rejects(plugin.rename(first, 'New words'), /rename denied/);
  assert.equal(frontmatter(app, first.file.path).title, 'New words');
});

test('Undo refuses an external edit between saving the title and renaming its file', async () => {
  const { app, plugin, first } = await stand();
  const rename = app.fileManager.renameFile.bind(app.fileManager);
  app.fileManager.renameFile = async (file, path) => {
    await app.vault.process(file, text => text + '\nPhone wrote during rename\n');
    return rename(file, path);
  };
  await plugin.rename(first, 'Renamed');
  await plugin.undo();
  assert.equal(app.vault.files.has('Tasks/First.md'), false);
  assert.match(app.vault.files.get('Tasks/Renamed.md'), /Phone wrote during rename/);
  assert.equal(plugin.tasks().filter(t => t.uid === first.uid).length, 1);
});

test('creating an area and project preserves quotes in the exact area identity', async () => {
  const { app, plugin } = await stand();
  const name = 'Work "New"';
  const file = await plugin.createArea(name);
  assert.equal(frontmatter(app, file.path).area, name);
  const project = await plugin.createProject({ name, note: file }, 'Quoted project');
  assert.equal(frontmatter(app, project.path).area, name);
});

test('a stale unchecked box never reopens a task completed on another device', async () => {
  const { app, plugin, first } = await stand();
  await app.fileManager.processFrontMatter(first.file, fm => { fm.status='done'; fm.completedDate='2026-10-01'; });
  await plugin.toggle(first);
  assert.equal(frontmatter(app, first.file.path).status, 'done');
  assert.equal(frontmatter(app, first.file.path).completedDate, '2026-10-01');
});

test('a failed create cannot claim an external note at its intended path for Undo', async () => {
  const { app, plugin } = await stand();
  const create = app.vault.create.bind(app.vault);
  app.vault.create = async (path, text) => {
    if(path.endsWith('/Race.md')) {
      await create(path, 'External note claimed the filename');
      throw new Error('file exists');
    }
    return create(path,text);
  };
  await assert.rejects(plugin.createTask('Race', {area:'Home'}, null));
  await plugin.undo();
  assert.equal(app.vault.files.get('Tasks/Race.md'), 'External note claimed the filename');
});

test('Undo refuses an external body edit arriving before the gesture finishes', async () => {
  const { app, plugin, first } = await stand();
  await plugin.track('date plus external writer', [first.file], async tx => {
    await plugin.setDate(first, '2026-10-07', tx);
    await app.vault.modify(first.file, app.vault.files.get(first.file.path)+'Phone wrote this\n');
  });
  await plugin.undo();
  assert.match(app.vault.files.get(first.file.path), /Phone wrote this/);
});

test('removing a project never deletes a replacement UID at a child path', async () => {
  const { app, plugin, first } = await stand();
  const project=projectNote(app,'Home','Project');
  await plugin.setFields(first,{projects:['[[Project]]']});
  plugin.forgetScan();
  const area=(await plugin.collect(true)).find(a=>a.name==='Home');
  const container=area.projects.find(p=>p.file.path===project.path);
  const serialize=plugin.serialize.bind(plugin);
  plugin.serialize=async run=>{
    taskNote(app,'First',{uid:'ft-new-owner',area:'Other',projects:['[[Elsewhere]]']});
    return serialize(run);
  };
  await plugin.removeProject(area,container,true);
  assert.equal(frontmatter(app,first.file.path).uid,'ft-new-owner');
});

test('project rename and every step link are one undoable change', async () => {
  const { app, plugin, first } = await stand();
  const project=projectNote(app,'Home','Project');
  await plugin.setFields(first,{projects:['[[Project]]']});
  plugin.forgetScan();
  await plugin.renameProject(project,'New project');
  await plugin.undo();
  assert.ok(app.vault.getAbstractFileByPath('Areas/Project.md'));
  assert.deepEqual(frontmatter(app,first.file.path).projects,['[[Project]]']);
});

test('a scheduled timestamp with an offset is displayed as one local date and time', async () => {
  const {app,plugin,first}=await stand();
  await app.fileManager.processFrontMatter(first.file,fm=>{fm.scheduled='2030-01-04T23:30:00Z';});
  plugin.forgetScan();
  const task=plugin.tasks().find(t=>t.uid===first.uid);
  const instant=new Date('2030-01-04T23:30:00Z');
  const date=[instant.getFullYear(),String(instant.getMonth()+1).padStart(2,'0'),String(instant.getDate()).padStart(2,'0')].join('-');
  const clock=[instant.getHours(),instant.getMinutes()].map(n=>String(n).padStart(2,'0')).join(':');
  assert.equal(task.date,date);assert.equal(task.at,clock);
});

test('losing a known uid never creates a new identity under a stale row', async()=>{
  const{app,plugin,first}=await stand();
  await app.fileManager.processFrontMatter(first.file,fm=>{delete fm.uid;});
  const before=app.vault.files.get(first.file.path);
  assert.equal(await plugin.setDate(first,'2030-01-05'),false);
  assert.equal(app.vault.files.get(first.file.path),before);
});

test('Duplicate creates open work without copying recorded time or completed instances',async()=>{
  const{app,plugin,first}=await stand();
  await plugin.setWaiting(first,true,'2030-01-05','16:30');
  await app.fileManager.processFrontMatter(first.file,fm=>{fm.timeEntries=[{duration:300}];fm.completeInstances=['2030-01-01'];fm.skipped_instances=['2030-01-02'];fm.custom={keep:true};});
  const[copy]=await plugin.duplicateTasks([first]);
  const fm=frontmatter(app,copy.file.path);
  assert.equal(fm.status,'open');assert.equal(copy.status,'open');assert.equal(fm.timeEntries,undefined);assert.equal(fm.completeInstances,undefined);
  assert.deepEqual(fm.custom,{keep:true});assert.equal(fm.scheduled,'2030-01-05T16:30');
  assert.equal(fm.skipped_instances,undefined);
  assert.equal(frontmatter(app,first.file.path).timeEntries[0].duration,300);
});

test('making an existing note into an area includes its local view in the same Undo',async()=>{
  const{app,plugin}=await stand();
  const source='---\ncustom: keep\n---\nExisting prose\n';
  const note=await app.vault.create('Notes/Hub.md',source);
  await plugin.createArea('Hub',note);
  assert.match(app.vault.files.get(note.path),/```focus-tasks/);
  await plugin.undo();
  assert.equal(app.vault.files.get(note.path),source);
});

test('Undo of a partial group gesture never resurrects an untouched task deleted by another writer',async()=>{
  const{app,plugin,first,second}=await stand();
  await plugin.track('partial group',[first.file,second.file],async tx=>{
    await plugin.setDate(first,'2030-01-05',tx);
    await app.vault.trash(second.file);
  });
  await plugin.undo();
  assert.equal(app.vault.files.has(second.file.path),false);
  assert.equal(frontmatter(app,first.file.path).scheduled,'2026-10-02');
});

test('Undo never deletes a newly created task edited externally before its create promise returns',async()=>{
  const{app,plugin}=await stand();
  const create=app.vault.create.bind(app.vault);
  app.vault.create=async(path,text)=>{const file=await create(path,text);if(path.endsWith('/New capture.md'))await app.vault.process(file,s=>s+'\nAdded by phone\n');return file;};
  const created=await plugin.createTask('New capture',{area:'Home'},null);
  await plugin.undo();
  assert.match(app.vault.files.get(created.file.path),/Added by phone/);
});

test('a delegated recurring occurrence cannot make Undo overwrite companion edits or undo earlier work',async()=>{
  const{app,plugin,first,second}=await stand();
  await plugin.setDate(second,'2030-01-05');
  await app.fileManager.processFrontMatter(first.file,fm=>{fm.recurrence='FREQ=DAILY';});
  app.plugins.plugins.tasknotes={api:{recurring:{toggleCompleteInstance:async()=>{
    await app.fileManager.processFrontMatter(first.file,fm=>{fm.complete_instances=['2026-10-02'];});
    await app.vault.process(first.file,s=>s+'\nCompanion description\n');
  }}}};
  await plugin.toggle(first);await plugin.undo();
  assert.equal(frontmatter(app,second.file.path).scheduled,'2030-01-05');
  assert.deepEqual(frontmatter(app,first.file.path).complete_instances,['2026-10-02']);
  assert.match(app.vault.files.get(first.file.path),/Companion description/);
});
