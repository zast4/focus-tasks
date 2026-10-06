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

test('local supplement toggles are exclusive, collapse on repeat and never touch All', async () => {
  const { p } = await setup(); p.setEverything(true);
  const later = { key: 'future:Work' };
  await p.toggleSupplement('intents:Work', 'backlog', later);
  assert.equal(p.isShown(later.key, true), true);
  await p.toggleSupplement('intents:Work', 'intents', later);
  assert.equal(p.isShown(later.key, true), false); assert.equal(p.isShown('intents:Work', true), true);
  await p.toggleSupplement('intents:Work', 'intents', later);
  assert.equal(p.isShown('intents:Work', true), false); assert.equal(p.isShown(later.key, true), false);
  assert.equal(p.everything(), true);
});

test('inverted All backlog folds correctly when selecting and closing ideas', async () => {
  const { p } = await setup(); const later = { key: 'futureoff:Work', inverted: true };
  await p.toggleSupplement('intents:Work', 'intents', later);
  assert.equal(p.isShown(later.key, true), true);
  await p.toggleSupplement('intents:Work', 'backlog', later);
  assert.equal(p.isShown(later.key, true), false); assert.equal(p.isShown('intents:Work', true), false);
  await p.toggleSupplement('intents:Work', 'backlog', later); assert.equal(p.isShown(later.key, true), true);
});

test('project note and common row share supplement selection; other areas stay independent', async () => {
  const { p, file } = await setup(); const key = 'project-intents:' + file.path;
  await p.toggleSupplement('intents:Life', 'intents');
  await p.toggleSupplement(key, 'intents', { key: 'pagefold:' + file.path, inverted: true });
  assert.equal(p.isShown('later:' + file.path, true), false);
  await p.toggleSupplement(key, 'backlog', { key: 'later:' + file.path });
  assert.equal(p.isShown('pagefold:' + file.path, true), false); assert.equal(p.isShown(key, true), false);
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
