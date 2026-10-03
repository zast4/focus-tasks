import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { FakeApp, loadPlugin, areaNote, projectNote, taskNote, frontmatter, bodyOf } from './harness.mjs';

function rng(seed) { let state = seed; return () => ((state = Math.imul(state, 1664525) + 1013904223 >>> 0) / 2 ** 32); }
const count = Number(process.env.FT_STRESS_SEEDS || 100);
const actions = Number(process.env.FT_STRESS_ACTIONS || 100);

test(`${count} reproducible user histories with ${actions} gestures each preserve task identity and content`, async () => {
  for (let seed = 1; seed <= count; seed++) {
    const random = rng(seed);
    const app = new FakeApp();
    for (const area of ['Home', 'Work', 'Study']) areaNote(app, area);
    projectNote(app, 'Work', 'Project');
    for (let i = 0; i < 12; i++) taskNote(app, `Task ${i}`, {
      area: ['Home', 'Work', 'Study'][i % 3], ...(i % 3 === 1 ? { project: 'Project' } : {}),
      scheduled: i % 2 ? '2026-10-02' : undefined, custom: { preserved: true, marker: i },
    }, `Instructions ${i}\n\n- nested context`);
    const plugin = await loadPlugin(app);
    for (let n = 0; n < actions; n++) {
      const tasks = plugin.tasks();
      if (!tasks.length) await plugin.createTask('Again', { area: 'Home' }, null);
      const task = plugin.tasks()[Math.floor(random() * plugin.tasks().length)];
      const before = new Map(app.vault.getMarkdownFiles().filter(f => f.path.startsWith('Tasks/')).map(f => {
        const fm = frontmatter(app, f.path); return [fm.uid, { body: bodyOf(app, f.path), custom: fm.custom }];
      }));
      const gesture = Math.floor(random() * 9);
      try {
        if (gesture === 0) await plugin.setDate(task, random() < .5 ? null : '2026-10-04');
        if (gesture === 1) await plugin.setPriority(task, random() < .5 ? 'low' : null);
        if (gesture === 2) await plugin.toggle(task);
        if (gesture === 3) await plugin.rename(task, `Renamed ${seed}-${n}`);
        if (gesture === 4) await plugin.duplicateTasks([task]);
        if (gesture === 5) await plugin.setWaiting(task, true, '2026-10-05', '16:30');
        if (gesture === 6) await plugin.setWaiting(task, false);
        if (gesture === 7) await plugin.removeTask(task);
        if (gesture === 8) await plugin.undo();
        const disk = app.vault.getMarkdownFiles().filter(f => f.path.startsWith('Tasks/')).map(f => ({ f, fm: frontmatter(app, f.path) }));
        assert.equal(new Set(disk.map(x => x.fm.uid)).size, disk.length, 'distinct identities on disk');
        assert.equal(plugin.tasks().length, disk.length, 'the reader sees every task note');
        for (const { f, fm } of disk) {
          const prior = before.get(fm.uid);
          // Undo may restore an older body; these gestures never edit descriptions or custom fields.
          if (prior) {
            assert.equal(bodyOf(app, f.path), prior.body, 'description survived');
            assert.deepEqual(fm.custom, prior.custom, 'foreign YAML survived');
          }
        }
        const all = await plugin.collect(true);
        const shown = new Set(all.flatMap(a => a.rows.flatMap(r => r.kind === 'task' ? [r.task.uid] : r.steps.map(t => t.uid))));
        const active = disk.filter(({ fm }) => !['done', 'cancelled', 'someday'].includes(fm.status));
        for (const { fm } of active) assert.ok(shown.has(fm.uid), 'every active task is discoverable');
      } catch (e) { e.message = `seed=${seed}, gesture=${n}, operation=${gesture}: ${e.message}`; throw e; }
    }
  }
});

test('10,000 tasks: a cold collect and cached reads keep every active note', async () => {
  const app = new FakeApp();
  for (let i = 0; i < 20; i++) areaNote(app, `Area ${i}`);
  for (let i = 0; i < 10000; i++) taskNote(app, `Task ${i}`, { area: `Area ${i % 20}`, scheduled: '2026-10-02' });
  const plugin = await loadPlugin(app);
  const start = performance.now();
  const areas = await plugin.collect(true);
  const cold = performance.now() - start;
  assert.equal(areas.reduce((n, a) => n + a.rows.length, 0), 10000);
  const warm = performance.now();
  for (let i = 0; i < 20; i++) assert.equal(plugin.tasks().length, 10000);
  const cached = performance.now() - warm;
  console.log(`10,000 tasks: cold collect ${cold.toFixed(0)}ms; 20 cached reads ${cached.toFixed(1)}ms`);
  assert.ok(cold < 5000, `cold collect took ${cold}ms`);
  assert.ok(cached < 1000, `cached reads took ${cached}ms`);
});
