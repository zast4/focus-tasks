// User-visible transitions against an independently specified file contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeApp, loadPlugin, areaNote, projectNote, taskNote, frontmatter, bodyOf } from './harness.mjs';

const today = () => new Date().toLocaleDateString('sv-SE');
const future = '2035-08-12';
const dropArea = (pile = 'ahead') => ({ target: { type: 'area', area: { name: 'Life' } }, pile, into: true });
async function fixture(fields = {}) {
  const app = new FakeApp();
  areaNote(app, 'Work'); areaNote(app, 'Life');
  taskNote(app, 'A', { area: 'Work', scheduled: today(), ...fields, custom: { writer: 'external', keep: ['a', 'b'] } }, 'Context\n\n- keep this instruction');
  const p = await loadPlugin(app);
  return { app, p, task: p.tasks()[0] };
}
const patch = (app, task, fields) => app.fileManager.processFrontMatter(task.file, fm => Object.assign(fm, fields));

test('an area drop refuses a destination whose note has become an unrelated note', async () => {
  const { app, p, task } = await fixture();
  const note = p.notes().find(x => !x.project && x.area === 'Life').file;
  const before = app.vault.files.get(task.file.path);
  await app.fileManager.processFrontMatter(note, fm => { fm.type = 'note'; delete fm.area; });
  await p.moveTasks([task], { target: { type: 'area', area: { name: 'Life', note } }, pile: 'focus', into: true });
  assert.equal(app.vault.files.get(task.file.path), before);
});

test('moving a project cannot pull back a concurrently moved step', async () => {
  const { app, p, task } = await fixture({ projects: ['[[Old]]'] });
  areaNote(app, 'Study');
  projectNote(app, 'Work', 'Old', { uid: 'move-project' }); projectNote(app, 'Life', 'New'); p.forgetScan();
  const project = p.notes().find(n => n.file.basename === 'Old'), process = app.vault.process.bind(app.vault);
  let moved = false;
  app.vault.process = async (file, fn) => {
    const out = await process(file, fn);
    if (file === project.file && !moved) { moved = true; await patch(app, task, { area: 'Life', projects: ['[[New]]'] }); }
    return out;
  };
  const from = { name: 'Work', note: p.notes().find(n => !n.project && n.area === 'Work').file };
  const to = { name: 'Study', note: p.notes().find(n => !n.project && n.area === 'Study').file };
  await p.moveProject(project, from, to);
  assert.deepEqual(frontmatter(app, task.file.path).projects, ['[[New]]']);
  assert.equal(frontmatter(app, task.file.path).area, 'Life');
});

test('deleting a project refuses a different entity at its former path before touching its steps', async () => {
  const { app, p, task } = await fixture({ projects: ['[[Old]]'] });
  projectNote(app, 'Work', 'Old', { uid: 'original-project' });
  p.forgetScan();
  const project = p.notes().find(x => x.project), before = app.vault.files.get(task.file.path);
  await app.fileManager.processFrontMatter(project.file, fm => { fm.type = 'note'; fm.uid = 'replacement-note'; });
  const foreign = app.vault.files.get(project.file.path);
  await p.removeProject({ name: 'Work' }, project, true).catch(() => {});
  assert.equal(app.vault.files.get(project.file.path), foreign);
  assert.equal(app.vault.files.get(task.file.path), before);
  assert.equal(app.vault.trashed.length, 0);
});

test('renaming a stale step cannot restore its former project', async () => {
  const { app, p, task } = await fixture({ projects: ['[[Areas/Old]]'] });
  projectNote(app, 'Work', 'Old'); projectNote(app, 'Life', 'New');
  task.project = 'Areas/Old';
  await patch(app, task, { area: 'Life', projects: ['[[New]]'] });
  await p.rename(task, 'A new title');
  assert.equal(frontmatter(app, task.file.path).area, 'Life');
  assert.deepEqual(frontmatter(app, task.file.path).projects, ['[[New]]']);
  assert.equal(task.area, 'Life', 'the edited row follows its current area immediately');
  assert.equal(task.project, 'New', 'the edited row follows its current project immediately');
});

test('renaming a project cannot pull back a concurrently moved step', async () => {
  const { app, p, task } = await fixture({ projects: ['[[Old]]'] });
  projectNote(app, 'Work', 'Old'); projectNote(app, 'Life', 'New'); p.forgetScan();
  const project = p.notes().find(n => n.file.basename === 'Old'), rename = app.fileManager.renameFile.bind(app.fileManager);
  app.fileManager.renameFile = async (file, path) => {
    await rename(file, path);
    if (file === project.file) await patch(app, task, { area: 'Life', projects: ['[[New]]'] });
  };
  await p.renameProjectNow(project.file, 'Renamed project', [task], null);
  assert.equal(frontmatter(app, task.file.path).area, 'Life');
  assert.deepEqual(frontmatter(app, task.file.path).projects, ['[[New]]']);
});

for (const replacement of ['identity', 'body']) {
  test(`deleting refuses a concurrent ${replacement} replacement after its identity check`, async () => {
    const { app, p, task } = await fixture();
    const read = app.vault.read.bind(app.vault);
    let reads = 0, foreign;
    app.vault.read = async file => {
      const text = await read(file);
      if (file.path === task.file.path && ++reads === 2) {
        if (replacement === 'identity') await patch(app, task, { uid: 'foreign-new-uid' });
        else await app.vault.modify(file, text + '\nA new external instruction');
        foreign = await read(file);
      }
      return text;
    };
    await p.removeTask(task).catch(() => {});
    assert.equal(app.vault.files.get(task.file.path), foreign, 'the concurrent note survives unchanged');
    assert.equal(app.vault.trashed.length, 0);
    assert.equal(p.history?.length || 0, 0, 'refusing a stale deletion creates no misleading Undo');
  });
}

for (const status of ['open', 'waiting', 'in-progress']) {
  test(`dragging a stale Focus row into Backlog preserves the synced ${status} clock`, async () => {
    const { app, p, task } = await fixture();
    const originalBody = bodyOf(app, task.file.path);
    await patch(app, task, { status, scheduled: future + 'T16:30' });
    await p.moveTasks([task], dropArea());
    const fm = frontmatter(app, task.file.path);
    assert.equal(fm.scheduled, future + 'T16:30');
    assert.equal(fm.status, status);
    assert.equal(fm.area, 'Life');
    assert.deepEqual(fm.custom, { writer: 'external', keep: ['a', 'b'] });
    assert.equal(bodyOf(app, task.file.path), originalBody);
    await p.undo();
    assert.equal(frontmatter(app, task.file.path).area, 'Work');
    assert.equal(frontmatter(app, task.file.path).scheduled, future + 'T16:30', 'Undo restores the synced pre-gesture state');
  });
}

test('a drop into Focus changes the day while preserving an explicit reminder hour', async () => {
  const { app, p, task } = await fixture({ scheduled: future + 'T17:45' });
  await p.moveTasks([task], dropArea('focus'));
  assert.equal(frontmatter(app, task.file.path).scheduled, today() + 'T17:45');
  assert.equal(task.at, '17:45', 'the live row has the same clock as the file');
  await p.undo();
  assert.equal(frontmatter(app, task.file.path).scheduled, future + 'T17:45');
});

test('a stale open selection cannot erase a newly delegated Waiting return time', async () => {
  const { app, p, task } = await fixture({ scheduled: null });
  await patch(app, task, { status: 'waiting', scheduled: future + 'T12:05' });
  await p.moveTasks([task], dropArea('focus'));
  const fm = frontmatter(app, task.file.path);
  assert.equal(fm.status, 'waiting');
  assert.equal(fm.scheduled, future + 'T12:05');
  assert.equal(task.status, 'waiting');
});

test('a stale Waiting row that came home uses its current clock when dropped into Focus', async () => {
  const { app, p, task } = await fixture({ status: 'waiting', scheduled: future + 'T10:10' });
  await patch(app, task, { status: 'open', scheduled: future + 'T19:25' });
  await p.moveTasks([task], dropArea('focus'));
  assert.equal(frontmatter(app, task.file.path).scheduled, today() + 'T19:25');
  assert.equal(task.status, 'open');
});

test('a writer changing the clock immediately before the atomic drag write wins over stale row data', async () => {
  const { app, p, task } = await fixture();
  const original = app.vault.process.bind(app.vault);
  let once = true;
  app.vault.process = async (file, change) => {
    if (once && file.path === task.file.path) {
      once = false;
      await original(file, text => text.replace(/^scheduled:.*$/m, 'scheduled: ' + future + 'T09:40'));
    }
    return original(file, change);
  };
  await p.moveTasks([task], dropArea());
  assert.equal(frontmatter(app, task.file.path).scheduled, future + 'T09:40');
  await p.undo();
  assert.equal(frontmatter(app, task.file.path).scheduled, future + 'T09:40');
});

test('a grouped drop preserves each independently synced Waiting and future clock; one Undo restores both', async () => {
  const { app, p, task } = await fixture();
  taskNote(app, 'B', { area: 'Work', scheduled: today() }); p.forgetScan();
  const second = p.tasks().find(x => x.text === 'B');
  await patch(app, task, { scheduled: future + 'T11:10' });
  await patch(app, second, { status: 'waiting', scheduled: future + 'T22:05' });
  await p.moveTasks([task, second], dropArea());
  assert.equal(frontmatter(app, task.file.path).scheduled, future + 'T11:10');
  assert.equal(frontmatter(app, second.file.path).scheduled, future + 'T22:05');
  assert.equal(frontmatter(app, second.file.path).status, 'waiting');
  await p.undo();
  for (const row of [task, second]) assert.equal(frontmatter(app, row.file.path).area, 'Work');
});

test('dropping into a project deleted since rendering never writes a dangling project link or order', async () => {
  const { app, p, task } = await fixture();
  const file = projectNote(app, 'Life', 'Gone'); p.forgetScan();
  const project = (await p.collect(true)).find(x => x.name === 'Life').projects[0];
  await app.vault.trash(file, true);
  const before = app.vault.files.get(task.file.path), order = JSON.stringify(p.data.order);
  await p.moveTasks([task], { target: { type: 'project', project, area: { name: 'Life' } }, pile: 'ahead', into: true });
  assert.equal(app.vault.files.get(task.file.path), before);
  assert.equal(JSON.stringify(p.data.order), order);
});

test('a project moved by another writer assigns the task to its current owner', async () => {
  const { app, p, task } = await fixture();
  const file = projectNote(app, 'Work', 'Moved'); p.forgetScan();
  const project = (await p.collect(true)).find(x => x.name === 'Work').projects[0];
  await app.fileManager.processFrontMatter(file, fm => { fm.area = 'Life'; });
  await p.moveTasks([task], { target: { type: 'project', project, area: { name: 'Work' } }, pile: 'ahead', into: true });
  assert.equal(frontmatter(app, task.file.path).area, 'Life');
  assert.deepEqual(frontmatter(app, task.file.path).projects, ['[[Moved]]']);
});

test('dropping into a deleted idea list never promotes or strands an idea', async () => {
  const { app, p } = await fixture();
  const source = await p.createIntentList('Source', 'Work'), dest = await p.createIntentList('Gone ideas', 'Life');
  const task = await p.createTask('Idea', { area: 'Work', projectFile: source.file, project: source.file.basename, intentList: true, listUid: source.uid }, null);
  await app.vault.trash(dest.file, true);
  const before = app.vault.files.get(task.file.path), order = JSON.stringify(p.data.order);
  await p.moveTasks([task], { target: { type: 'project', project: { ...dest, intentList: true }, area: { name: 'Life' } }, pile: 'intents', into: true });
  assert.equal(app.vault.files.get(task.file.path), before);
  assert.equal(JSON.stringify(p.data.order), order);
  assert.equal(p.tasks().some(x => x.uid === task.uid), false);
});

test('a replacement project with the same path never receives tasks addressed to the old UID', async () => {
  const { app, p, task } = await fixture();
  const file = projectNote(app, 'Life', 'Same path', { uid: 'project-old' }); p.forgetScan();
  const project = (await p.collect(true)).find(x => x.name === 'Life').projects[0];
  await app.fileManager.processFrontMatter(file, fm => { fm.uid = 'project-replacement'; });
  const before = app.vault.files.get(task.file.path);
  await p.moveTasks([task], { target: { type: 'project', project, area: { name: 'Life' } }, pile: 'ahead', into: true });
  assert.equal(app.vault.files.get(task.file.path), before);
});

test('a deleted task anchor cannot move a selected task or add a ghost ordering key', async () => {
  const { app, p, task } = await fixture();
  taskNote(app, 'Anchor', { area: 'Life' }); p.forgetScan();
  const anchor = p.tasks().find(x => x.text === 'Anchor');
  await app.vault.trash(anchor.file, true);
  const before = app.vault.files.get(task.file.path), order = JSON.stringify(p.data.order);
  await p.moveTasks([task], { target: { type: 'task', task: anchor }, pile: 'ahead', after: true });
  assert.equal(app.vault.files.get(task.file.path), before);
  assert.equal(JSON.stringify(p.data.order), order);
});

test('a replaced idea list keeps the dragged idea in its original list', async () => {
  const { app, p } = await fixture();
  const source = await p.createIntentList('Source', 'Work'), dest = await p.createIntentList('Replacement', 'Life');
  const task = await p.createTask('Idea', { area: 'Work', projectFile: source.file, project: source.file.basename, intentList: true, listUid: source.uid }, null);
  await app.fileManager.processFrontMatter(dest.file, fm => { fm.uid = 'replacement-list'; });
  const before = app.vault.files.get(task.file.path);
  await p.moveTasks([task], { target: { type: 'project', project: { ...dest, intentList: true }, area: { name: 'Life' } }, pile: 'intents', into: true });
  assert.equal(app.vault.files.get(task.file.path), before);
});

for (const status of ['waiting', 'done', 'cancelled']) {
  test(`moving a ${status} idea into Focus explicitly activates it like the promotion command`, async () => {
    const { app, p } = await fixture();
    const list = await p.createIntentList('Plans', 'Work');
    const task = await p.createTask('Activate me', { area: 'Work', projectFile: list.file, project: list.file.basename, intentList: true, listUid: list.uid }, null);
    await patch(app, task, { status, completedDate: '2000-01-01', scheduled: future + 'T16:30' });
    p.forgetScan(); const idea = p.read().intentTasks.find(x => x.uid === task.uid);
    const before = app.vault.files.get(task.file.path);
    await p.moveTasks([idea], dropArea('focus'));
    const fm = frontmatter(app, task.file.path);
    assert.equal(fm.status, 'open');
    assert.equal(fm.completedDate, undefined);
    assert.equal(fm.scheduled, today() + 'T16:30');
    assert.equal(fm.source, '[[' + list.file.path.replace(/\.md$/, '') + ']]');
    assert.equal(p.read().intentTasks.some(x => x.uid === task.uid), false);
    assert.equal(p.tasks().filter(x => x.uid === task.uid).length, 1);
    await p.undo();
    assert.equal(app.vault.files.get(task.file.path), before);
  });
}
for(const mutation of ['delete','retype','complete','move area','replace UID'])test(`project creation refuses a destination changed by another writer: ${mutation}`,async()=>{
 const app=new FakeApp();areaNote(app,'Work');areaNote(app,'Life');const project=projectNote(app,'Work','P',{uid:'project-original'});const p=await loadPlugin(app);
 if(mutation==='delete')await app.vault.delete(project);
 else await app.fileManager.processFrontMatter(project,fm=>{if(mutation==='retype')fm.type='note';if(mutation==='complete')fm.status='done';if(mutation==='move area')fm.area='Life';if(mutation==='replace UID')fm.uid='project-replacement';});
 const before=new Map(app.vault.files);p.history=[];
 await assert.rejects(()=>p.createTask('New step',{area:'Work',project:'P',projectFile:project,projectUid:'project-original'},today()),/intent-conflict/);
 assert.deepEqual(new Map(app.vault.files),before);assert.equal(p.tasks().length,0);assert.equal(p.history.length,0);
});
