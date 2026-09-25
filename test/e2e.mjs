#!/usr/bin/env node
// End-to-end test of Focus Tasks in a fresh vault, driven over the Chrome DevTools Protocol.
//
// Needs Obsidian running with a DevTools port (any vault open):
//   open -a Obsidian --args --remote-debugging-port=9222
// The test builds test/focus-tasks-e2e/ from scratch, opens it in a new Obsidian window, installs
// the plugin from this folder, goes through every feature with real mouse and keyboard input and
// checks the files on disk. The window is closed and the vault forgotten at the end (--keep keeps them).
//
//   node test/e2e.mjs            (--keep leaves the vault and its window open)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Page, PORT, J, sleep, ymd, until } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const NAME = "focus-tasks-e2e";
const VAULT = path.join(ROOT, "test", NAME);
const SHOTS = path.join(ROOT, "test", "shots");
const TODAY = ymd(new Date());
// the picker's own field format: «2026-09-30» → «30.09.26»
const ddmmyy = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;

const TOMORROW = ymd(new Date(Date.now() + 864e5));
const YESTERDAY = ymd(new Date(Date.now() - 864e5));

// Finders that run in the page; each returns the centre of an element (scrolled into view) or null.
const HELPERS = `
window.__ftLast = Date.now();
new MutationObserver(() => { window.__ftLast = Date.now(); })
  .observe(document.querySelector('.focus-tasks-pane'), { subtree: true, childList: true, characterData: true });
window.__ft = {
  view() { return [...document.querySelectorAll('.focus-tasks-pane .focus-tasks-view')].find((e) => e.getClientRects().length); },
  all(sel, root) { return [...(root || document).querySelectorAll(sel)].filter((e) => e.getClientRects().length); },
  task(n) { return n ? this.all('li.ft-task', this.view()).find((e) => e.querySelector('.ft-text')?.textContent.trim() === n) : undefined; },
  project(n) { return this.all('li.ft-project-row', this.view()).find((e) => e.querySelector('.ft-link')?.textContent.trim() === n); },
  area(n) { return this.all('.ft-area-title', this.view()).find((e) => e.textContent.includes(n)); },
  text(sel, n) { return this.all(sel).find((e) => e.textContent.trim() === n); },
  at(el, dy = 0.5) {
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * dy };
  },
  grip(row) { return row ? (row.scrollIntoView({ block: 'center' }), this.at(row.querySelector(':scope > .ft-grip'))) : null; },
  caretToEnd() {
    const el = document.querySelector('.is-editing');
    const s = getSelection();
    s.selectAllChildren(el);
    s.collapseToEnd();
  },
  selectAll() { getSelection().selectAllChildren(document.querySelector('.is-editing')); },
};`;

// --- the test ---------------------------------------------------------------------------------

let page, main;
const read = (rel) => { try { return fs.readFileSync(path.join(VAULT, rel), "utf8"); } catch { return null; } };
const exists = (rel) => fs.existsSync(path.join(VAULT, rel));
const data = () => JSON.parse(read(".obsidian/plugins/focus-tasks/data.json") || "{}");


// The list re-renders a moment after a file changes; positions are read once it holds still.
const settle = () => until(() => page.eval(`return Date.now() - __ftLast > 700`), "the list to settle");
const pos = async (expr, what) => {
  // bringing the window to front may give the focus back to the last note tab
  if (!(await page.eval(`return !!__ft.view()`))) { await toPane(); await sleep(300); }
  await settle();
  const p = await page.eval(`return ${expr};`);
  if (!p) throw new Error(`not on screen: ${what || expr}`);
  return p;
};
const click = async (expr, what, modifiers = 0) => page.click(await pos(expr, what), modifiers);
const SHIFT = 8, CMD = process.platform === "darwin" ? 4 : 2;
const selected = async () => {
  if (!(await page.eval(`return !!__ft.view()`))) await toPane();  // a key may bring a note tab to the front
  return page.eval(`return __ft.all('li.ft-task.is-selected', __ft.view()).map((e) => e.querySelector('.ft-text').textContent.trim())`);
};
const selectedAre = async (names) => {
  try {
    await until(async () => J(await selected()) === J(names), "selected: " + J(names));
  } catch (e) {
    const state = await page.eval(`
      const p = app.plugins.plugins['focus-tasks'];
      return [...p.views].map((v) => ({ sel: v.selected.size, scope: !!v.scope, active: app.workspace.activeLeaf === v.leaf,
        activeType: app.workspace.activeLeaf?.view?.getViewType?.(), editing: !!v.editing,
        rows: v.rows().length, marked: [...v.containerEl.querySelectorAll('li.ft-task.is-selected')].length }));`);
    throw new Error(`${e.message}; on screen: ${J(await selected())}; views: ${J(state)}`);
  }
};
const menu = async (title) => {
  await until(() => page.eval(`return !!__ft.text('.menu .menu-item-title', ${J(title)})`), `menu item «${title}»`);
  await click(`__ft.at(__ft.text('.menu .menu-item-title', ${J(title)}))`, `menu item «${title}»`);
};
const editing = () => until(() => page.eval(`return !!document.querySelector('.focus-tasks-view .is-editing')`), "an editor");
const idle = () => until(() => page.eval(`return !document.querySelector('.focus-tasks-view .is-editing, .ft-picker, .menu')`), "the editor closed");
const modalInput = async (sel = ".modal input.ft-input") => {
  await until(() => page.eval(`return document.activeElement?.matches(${J(sel)})`), `focused ${sel}`);
};
const fileHas = (rel, re, what) => until(() => (typeof re === "string" ? read(rel)?.includes(re) : re.test(read(rel) || "")), what || `${rel} ~ ${re}`);
const fileLacks = (rel, re, what) => until(() => { const s = read(rel); return s !== null && !(typeof re === "string" ? s.includes(re) : re.test(s)); }, what || `${rel} !~ ${re}`);
const activePath = () => page.eval(`return app.workspace.getActiveFile()?.path || null`);
function toPane() { return page.eval(`const l = app.workspace.getLeavesOfType('focus-tasks-view')[0]; app.workspace.setActiveLeaf(l, { focus: true }); app.workspace.revealLeaf(l); return true;`); }
const plugin = (body) => page.eval(`const p = app.plugins.plugins['focus-tasks']; ${body}`);

// --- task notes ---------------------------------------------------------------------------------

const FOLDER = "Задачи";  // where the plugin keeps a note per task
const taskPath = (name) => `${FOLDER}/${name}.md`;

// The frontmatter of a task note plus its body, or null when there is no such note.
function fm(name) {
  const text = read(taskPath(name));
  if (text === null || !text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  const out = { body: end < 0 ? "" : text.slice(end + 4).trim() };
  let list = null;
  for (const line of text.slice(4, end < 0 ? undefined : end).split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && list) { out[list].push(item[1].replace(/^["']|["']$/g, "").trim()); continue; }
    const m = line.match(/^([a-zA-Zа-яА-Я_-]+):\s*(.*)$/);
    list = null;
    if (!m) continue;
    if (m[2].trim()) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    else { list = m[1]; out[list] = []; }
  }
  return out;
}

// Waits until the note of `name` has these fields (null = the field must be gone).
const taskIs = (name, fields, what) => until(() => {
  const f = fm(name);
  if (!f) return false;
  return Object.entries(fields).every(([k, v]) => (v === null ? f[k] === undefined : String(f[k] ?? "") === String(v)));
}, what || `${name}: ${J(fields)}` , 6000);
const noTask = (name) => until(() => fm(name) === null, `note of «${name}» gone`);
const taskOrder = (key) => (data().order?.tasks?.[key] || []);
// A project's steps as rows of their own under its row (per device: the fold lives in localStorage).
const openSteps = async (name, open = true) => {
  await plugin(`
    const n = p.notes().find((x) => x.project && x.file.basename === ${J(name)});
    if (!n) return false;
    const key = 'steps:' + n.file.path;
    if (!!p.data.opened[key] !== ${open}) await p.toggleShown(key, true);
    p.refresh(); return true;`);
  await settle();
};
// The block of the day's closed work at the bottom (per device too).
const showDone = async (on = true) => { await plugin(`if (p.doneShown() !== ${on}) p.setDoneShown(${on}); return true;`); await settle(); };
const uidOf = (name) => fm(name)?.uid;

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

step("opens with an onboarding and the area buttons", async () => {
  await until(() => page.eval(`return !!document.querySelector('.focus-tasks-pane .ft-onboarding')`), "onboarding");
  const foot = await page.eval(`return __ft.all('.ft-foot-button', __ft.view()).map((b) => b.textContent.trim())`);
  if (J(foot) !== J(["+ Area", "+ Area from a note"])) throw new Error("footer: " + J(foot));
  if (!(await page.eval(`return !!document.querySelector('.side-dock-ribbon-action[aria-label="Open Focus"]')`))) throw new Error("no ribbon icon");
});

step("+ Area creates an area note and shows it under «All»", async () => {
  await click(`__ft.at(__ft.text('.ft-foot-button', '+ Area'))`);
  await modalInput();
  await page.type("💪Sport");
  await page.key("Enter");
  await fileHas("Tasks/Sport.md", '---\nkind: focus-area\narea: "💪Sport"\ntype: area\n---\n');
  await until(() => page.eval(`return !!__ft.text('.ft-rest-title', 'Other areas') && !!__ft.text('.ft-empty-add', 'Empty')`), "Sport under Other areas, empty");
});

step("a click on «Empty» types a task: one note per task", async () => {
  await click(`__ft.at(__ft.text('.ft-empty-add', 'Empty'))`);
  await editing();
  await page.type("Run 5k");
  await page.key("Enter");
  await taskIs("Run 5k", { type: "задача", status: "open", area: "💪Sport", scheduled: null, projects: null });
  await editing();
  await page.type("Stretch");
  await page.key("Enter");
  await taskIs("Stretch", { area: "💪Sport" });
  await editing();
  await page.key("Escape");
  await idle();
  await until(() => page.eval(`return !!__ft.task('Stretch')`), "Stretch on screen");
});

step("the grip opens the area menu; New project makes a project note linked from the area", async () => {
  await click(`__ft.grip(__ft.area('Sport'))`);
  await menu("New project");
  await modalInput();
  await page.type("Marathon");
  await page.key("Enter");
  await fileHas("Tasks/Marathon.md", '---\nparents:\n  - "[[Sport]]"\narea: "💪Sport"\ntype: project\n---\n');
  await fileHas("Tasks/Sport.md", "## Projects\n\n- 📁 [[Marathon]]\n");
  await until(() => page.eval(`return !!__ft.project('Marathon')`), "Marathon on screen");
});

step("+ on a project makes steps that point at it, and ⌘1–4 date them while they are typed", async () => {
  await click(`__ft.at(__ft.project('Marathon').querySelector('.ft-plus'))`);
  await editing();
  await page.type("Buy shoes");
  await page.key("Enter");
  await taskIs("Buy shoes", { area: "💪Sport", projects: "[[Marathon]]", scheduled: null });
  // a date set with the keys while typing: the row has no note yet, so it used to ignore them
  await editing();
  await page.type("Plan route");
  await page.key("Meta+2");
  await until(() => page.eval(`
    const row = document.querySelector('.focus-tasks-view .is-editing')?.closest('li');
    return row?.querySelector('.ft-date')?.textContent.trim();`).then((d) => d === ddmmyy(TOMORROW)),
    "the draft shows the day it will get");
  await page.key("Enter");
  await taskIs("Plan route", { projects: "[[Marathon]]", scheduled: TOMORROW }, "the key set the date of a task that did not exist yet");
  // and the next row starts from the same day
  await editing();
  await page.type("Book the hall");
  await page.key("Enter");
  await taskIs("Book the hall", { scheduled: TOMORROW }, "the next draft keeps the day");
  await editing();
  await page.key("Escape");
  await idle();
});

step("inline edit: ⌘1 dates today, Enter renames the note and opens the next row with the same date", async () => {
  await openSteps("Marathon");   // from here on Marathon's steps are rows of their own on screen
  await until(() => page.eval(`return !!__ft.task('Buy shoes')`), "Buy shoes on screen");
  await click(`__ft.at(__ft.task('Buy shoes').querySelector('.ft-text'))`);
  await editing();
  await page.eval(`__ft.caretToEnd()`);
  await page.type(" fast");
  await page.key("Meta+1");
  await taskIs("Buy shoes", { scheduled: TODAY });
  await page.key("Enter");
  await taskIs("Buy shoes fast", { scheduled: TODAY, projects: "[[Marathon]]" });
  await noTask("Buy shoes");
  await editing();
  await page.type("Lace them");
  await page.key("Enter");
  await taskIs("Lace them", { scheduled: TODAY, projects: "[[Marathon]]" });
  await editing();
  await page.key("Escape");
  // and it stays where it was typed: right under the row that opened it, not at the bottom
  await settle();
  const steps = await page.eval(`
    const body = __ft.project('Marathon')?.nextElementSibling;
    return body?.hasClass('ft-steps') ? [...body.querySelectorAll('li.ft-task')].map((r) => r.querySelector('.ft-text').textContent.trim()) : null;`);
  if (!steps || steps.indexOf("Lace them") !== steps.indexOf("Buy shoes fast") + 1)
    throw new Error("the new row did not stay under the one it was typed from: " + J(steps));
  await idle();
  await until(() => page.eval(`return __ft.task('Lace them')?.querySelector('.ft-date.is-today.is-bare')?.textContent === ''`), "today says nothing on the right");
});

step("⌘2 tomorrow: the row leaves the focus at once and the editor moves on; ⌘4 no date", async () => {
  await openSteps("Marathon");
  await until(() => page.eval(`return !!__ft.task('Plan route')`), "Plan route on screen");
  const movedOn = () => until(() => page.eval(`const e = document.querySelector('.focus-tasks-view .is-editing'); return !!e && e.textContent.trim() !== 'Plan route'`),
    "the editor moved on to the row that came next");
  // Plan route waits in the pile: ⌘1 brings it into today's list — the row goes there at once, and
  // the editor is on the row that came next in the pile
  await click(`__ft.at(__ft.task('Plan route').querySelector('.ft-text'))`);
  await editing();
  await page.key("Meta+1");
  await taskIs("Plan route", { scheduled: TODAY });
  await until(() => page.eval(`const r = __ft.task('Plan route'); return !!r && !r.closest('.ft-future-block')`), "Plan route among today's rows");
  await movedOn();
  await page.key("Escape");
  await idle();
  // …and ⌘2 takes it back out of today's list the same way
  await click(`__ft.at(__ft.task('Plan route').querySelector('.ft-text'))`);
  await editing();
  await page.key("Meta+2");
  await taskIs("Plan route", { scheduled: TOMORROW });
  await until(() => page.eval(`return !!__ft.task('Plan route')?.closest('.ft-future-block')`), "Plan route among what is not today");
  await movedOn();
  await page.key("Escape");
  await idle();
  // no date keeps it in the pile: the editor stays where it is
  await click(`__ft.at(__ft.task('Plan route').querySelector('.ft-text'))`);
  await editing();
  await page.key("Meta+4");
  await taskIs("Plan route", { scheduled: null });
  if (await page.eval(`return document.querySelector('.focus-tasks-view .is-editing')?.textContent.trim() !== 'Plan route'`))
    throw new Error("the editor left a row that did not leave its list");
  await page.key("Escape");
  await idle();
});

step("⌘3 opens the date picker; a typed date saves", async () => {
  await until(() => page.eval(`return !!__ft.task('Run 5k')`), "Run 5k on screen");
  await click(`__ft.at(__ft.task('Run 5k').querySelector('.ft-text'))`);
  await editing();
  await page.key("Meta+3");
  await until(() => page.eval(`return document.activeElement?.matches('.ft-picker-input')`), "picker input focused");
  await page.type("25.12.26");
  await page.key("Enter");
  await taskIs("Run 5k", { scheduled: "2026-12-25" });
  await idle();
});

step("the date on the right: a typed date, a day of the month, Clear date", async () => {
  const pick = async () => {
    await until(() => page.eval(`return !!__ft.task('Stretch')`), "Stretch on screen");
    await click(`__ft.at(__ft.task('Stretch').querySelector('.ft-date'))`);
    await until(() => page.eval(`return !!document.querySelector('.ft-picker')`), "picker");
  };
  await pick();
  await page.type("today");     // the field understands words as well as dates
  await page.key("Enter");
  await taskIs("Stretch", { scheduled: TODAY });
  await idle();
  await pick();
  await click(`__ft.at([...document.querySelectorAll('.ft-picker-day:not(.is-other)')].find((d) => d.textContent === '15'))`);
  await taskIs("Stretch", { scheduled: TODAY.slice(0, 8) + "15" });
  await idle();
  await pick();
  await click(`__ft.at(document.querySelector('.ft-picker-foot button'))`);
  await taskIs("Stretch", { scheduled: null });
  await idle();
});

step("the box completes a step: the row leaves the list; the day's closed block at the bottom takes it", async () => {
  await showDone(false);
  await click(`__ft.at(__ft.task('Lace them').querySelector('input'))`);
  await taskIs("Lace them", { status: "done", completedDate: TODAY });
  await until(() => page.eval(`return !__ft.task('Lace them')`), "the row is gone from the list");
  // the ✓ button at the bottom opens the block of what was closed today, by area, each row naming its project
  await showDone(true);
  const done = `(() => { const r = __ft.task('Lace them'); return !!r && !!r.closest('.ft-done-today') && r.querySelector('input').checked; })()`;
  await until(() => page.eval(`return ${done}`), "Lace them in the closed block");
  const tag = await page.eval(`return __ft.task('Lace them').querySelector('.ft-project-tag')?.textContent.trim() || null`);
  if (tag !== "📁Marathon") throw new Error("the closed row does not name its project: " + J(tag));
  const label = await page.eval(`return document.querySelector('.ft-done-toggle')?.textContent.trim() || null`);
  if (!/^Done · \d+$/.test(label || "")) throw new Error("the ✓ button does not count the closed work: " + J(label));
  if (await page.eval(`return !!__ft.view().querySelector('.ft-area .ft-done-chip, .ft-area .ft-done-block')`))
    throw new Error("an area still carries its own closed block or ✓");
  // the box in the closed block brings it back to its project
  await click(`__ft.at(__ft.task('Lace them').querySelector('input'))`);
  await taskIs("Lace them", { status: "open", completedDate: null });
  await until(() => page.eval(`const r = __ft.task('Lace them'); return !!r && !r.closest('.ft-done-today') && !!r.closest('.ft-steps')`), "Lace them open again, among Marathon's steps");
});

step("a step dated later: in the plain focus its project has a row in the area's ⏳ pile too, showing that step", async () => {
  fs.writeFileSync(path.join(VAULT, taskPath("Book the hotel")),
    `---\nuid: ft-later-1\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${ymd(new Date(Date.now() + 30 * 864e5))}\nprojects:\n  - "[[Marathon]]"\n---\n`);
  await toPane();
  const wasAll = await plugin(`return p.everything()`);
  await plugin(`
    if (p.everything()) p.setEverything(false);
    if (!p.isShown('future:💪Sport', true)) await p.toggleShown('future:💪Sport', true);
    p.refresh(); return true;`);
  // Marathon's steps are open (since the inline-edit step), so its row in the pile is the name alone
  // and the later steps are rows under it
  await until(() => page.eval(`
    const pile = __ft.area('Sport')?.closest('.ft-area')?.querySelector('.ft-future-block');
    const row = pile && __ft.all('li.ft-project-row', pile).find((e) => e.querySelector('.ft-link')?.textContent.trim() === 'Marathon');
    const step = __ft.task('Book the hotel');
    return !!row && row.hasClass('is-open') && !!step && step.hasClass('is-later') && step.closest('li.ft-steps')?.previousElementSibling === row;`),
    "Marathon's row in the area's ⏳ pile, with the later step under it");
  if (!(await page.eval(`return __ft.all('li.ft-task', __ft.view()).filter((r) => r.querySelector('.ft-text')?.textContent.trim() === 'Book the hotel').every((r) => r.closest('.ft-future-block'))`)))
    throw new Error("the later step is among today's rows");
  await plugin(`if (p.everything() !== ${wasAll}) p.setEverything(${wasAll}); return true;`);
  fs.unlinkSync(path.join(VAULT, taskPath("Book the hotel")));
  await settle();
});

step("a second click on the same box before the list catches up does not undo the first", async () => {
  await until(() => page.eval(`return !!__ft.task('Buy shoes fast')`), "Buy shoes fast on screen");
  const box = await pos(`__ft.at(__ft.task('Buy shoes fast').querySelector('input'))`, "box of Buy shoes fast");
  await page.click(box);
  await page.click(box);
  await taskIs("Buy shoes fast", { status: "done" });
  await settle();
  await taskIs("Buy shoes fast", { status: "done" }, "still done after the list caught up");
  await click(`__ft.at(__ft.task('Buy shoes fast').querySelector('input'))`);
  await taskIs("Buy shoes fast", { status: "open", scheduled: TODAY });
});

step("the box of a row is centred on the first line of its text", async () => {
  const off = async (sel) => page.eval(`const li = ${sel}; if (!li) return null;
    const b = li.querySelector('input').getBoundingClientRect(), t = li.querySelector('.ft-text').getBoundingClientRect();
    const line = parseFloat(getComputedStyle(li.querySelector('.ft-text')).lineHeight);
    return Math.round((b.top + b.height / 2) - (t.top + line / 2));`);
  const d = await off("__ft.task('Buy shoes fast')");
  if (d === null || Math.abs(d) > 2) throw new Error(`the box is off by ${d}px`);
});

step("the note renamed by another device: the box still completes the task", async () => {
  await page.eval(`const f = app.vault.getAbstractFileByPath(${J(taskPath("Lace them"))});
    await app.fileManager.renameFile(f, ${J(taskPath("Lace them tight"))}); return true;`);
  await until(() => fm("Lace them tight") !== null, "the note renamed");
  await until(() => page.eval(`return !!__ft.task('Lace them tight')`), "the row shows the new name");
  await click(`__ft.at(__ft.task('Lace them tight').querySelector('input'))`);
  await taskIs("Lace them tight", { status: "done", completedDate: TODAY });
  await until(() => page.eval(`return !!__ft.task('Lace them tight')?.closest('.ft-done-today')`), "the row moved to Completed");
  await click(`__ft.at(__ft.task('Lace them tight').querySelector('input'))`);
  await taskIs("Lace them tight", { status: "open" });
});

step("drag a task onto an area header moves it out of its project", async () => {
  const from = await pos(`__ft.grip(__ft.task('Plan route'))`, "grip of Plan route");
  const to = await pos(`__ft.at(__ft.area('Sport'))`, "Sport header");
  await page.drag(from, to);
  await taskIs("Plan route", { area: "💪Sport", projects: null });
});

step("drag a task below another keeps the order the plugin remembers", async () => {
  await until(() => page.eval(`return __ft.task('Plan route') && !__ft.task('Plan route').closest('.ft-steps')`), "Plan route among the area's tasks");
  const from = await pos(`__ft.grip(__ft.task('Run 5k'))`, "grip of Run 5k");
  const to = await pos(`__ft.at(__ft.task('Plan route'), 0.85)`, "lower half of Plan route");
  await page.drag(from, to);
  await until(() => {
    const list = taskOrder("area:💪Sport");
    const a = list.indexOf(uidOf("Plan route")), b = list.indexOf(uidOf("Run 5k"));
    return a >= 0 && b === a + 1;
  }, "Run 5k right after Plan route in the saved order");
  await until(() => page.eval(`const rows = __ft.all('li.ft-task', __ft.view()).map((e) => e.querySelector('.ft-text')?.textContent.trim() || '');
    return rows.indexOf('Run 5k') === rows.indexOf('Plan route') + 1;`), "and on screen");
});

step("«Move up» / «Move down» reorder a task without dragging", async () => {
  await toPane();
  // the area's own tasks, in both piles, not the steps of its projects
  const order = () => page.eval(`return __ft.all('li.ft-task:not(.ft-project-row)', __ft.all('.ft-area', __ft.view())[0])
    .filter((e) => !e.closest('li.ft-steps')).map((e) => e.querySelector('.ft-text').textContent.trim())`);
  const before = await order();
  const first = before[0];
  await click(`__ft.grip(__ft.task(${J(first)}))`);
  await menu("Move down");
  const at = before.indexOf(first);
  await until(async () => (await order()).indexOf(first) !== at, `${first} moved down`);
  const after = await order();
  if (after.indexOf(first) <= at) throw new Error("it did not land lower: " + J(after));
  await click(`__ft.grip(__ft.task(${J(first)}))`);
  await menu("Move up");
  await until(async () => (await order()).indexOf(first) === at, `${first} moved back up`);
});

step("drag an area above another saves the order", async () => {
  await click(`__ft.at(__ft.text('.ft-foot-button', '+ Area'))`);
  await modalInput();
  await page.type("📚Reading");
  await page.key("Enter");
  await fileHas("Tasks/Reading.md", 'area: "📚Reading"');
  await until(() => page.eval(`return !!__ft.area('Reading')`), "Reading on screen");
  const from = await pos(`__ft.grip(__ft.area('Reading'))`, "grip of Reading");
  const to = await pos(`__ft.at(__ft.area('Sport'), 0.2)`, "top of Sport");
  await page.drag(from, to);
  await until(() => J(data().order?.areas) === J(["📚Reading", "💪Sport"]), "order.areas saved");
});

step("delete a task from its menu, then undo", async () => {
  await click(`__ft.grip(__ft.task('Stretch'))`);
  await menu("Delete");
  await noTask("Stretch");
  await click(`__ft.at(document.querySelector('.notice .ft-undo'))`, "Undo");
  await taskIs("Stretch", { area: "💪Sport" });
});

step("a task whose text is wiped in place and left is deleted, and Undo brings it back", async () => {
  await until(() => page.eval(`return !!__ft.task('Stretch')`), "Stretch on screen");
  await click(`__ft.at(__ft.task('Stretch').querySelector('.ft-text'))`);
  await editing();
  await page.eval(`__ft.selectAll()`);
  await page.key("Backspace");
  // leaving the emptied row: a click on another task's text opens that one and lets this one go
  await click(`__ft.at(__ft.task('Run 5k').querySelector('.ft-text'))`);
  await noTask("Stretch");
  await until(() => !exists(taskPath("Stretch")), "the note is gone");
  await click(`__ft.at(document.querySelector('.notice .ft-undo'))`, "Undo");
  await taskIs("Stretch", { area: "💪Sport" });
  await idle();
  // Esc on an emptied row is not a delete: the text comes back as it was
  await click(`__ft.at(__ft.task('Stretch').querySelector('.ft-text'))`);
  await editing();
  await page.eval(`__ft.selectAll()`);
  await page.key("Backspace");
  await page.key("Escape");
  await idle();
  await until(() => page.eval(`return !!__ft.task('Stretch')`), "Stretch still there after Esc");
  if (!exists(taskPath("Stretch"))) throw new Error("Esc on an emptied row deleted the task");
});

step("«Hide» / «All» at the bottom", async () => {
  await click(`__ft.at(__ft.text('.ft-all-toggle', 'Hide'))`);
  await until(() => page.eval(`return !__ft.text('.ft-rest-title', 'Other areas') && !__ft.area('Reading')`), "only the focus");
  await click(`__ft.at(__ft.text('.ft-all-toggle', 'All'))`);
  await until(() => page.eval(`return !!__ft.text('.ft-rest-title', 'Other areas') && !!__ft.area('Reading')`), "everything again");
  // among the other areas, one with nothing open goes last — behind an area with a task, whatever the order says
  fs.writeFileSync(path.join(VAULT, "Tasks/Craft.md"), '---\narea: "🎨Craft"\n---\n');
  fs.writeFileSync(path.join(VAULT, taskPath("Glue the model")), `---\nuid: ft-craft-1\ntype: задача\nstatus: open\narea: "🎨Craft"\n---\n`);
  await until(() => page.eval(`
    const names = [...__ft.view().querySelectorAll('.ft-rest-title ~ .ft-area > .ft-area-title')].map((e) => e.textContent);
    const at = (n) => names.findIndex((x) => x.includes(n));
    return at('Craft') >= 0 && at('Reading') >= 0 && at('Craft') < at('Reading');`), "Craft (open 1) before Reading (open 0)");
  for (const f of [taskPath("Glue the model"), "Tasks/Craft.md"]) fs.unlinkSync(path.join(VAULT, f));
  await settle();
});

step("Collapse all / Expand all", async () => {
  await click(`__ft.at(__ft.text('.ft-foot-button', 'Collapse all'))`);
  await until(() => page.eval(`return __ft.all('li.ft-task', __ft.view()).length === 0`), "no task rows");
  await click(`__ft.at(__ft.text('.ft-foot-button', 'Expand all'))`);
  await until(() => page.eval(`return __ft.all('li.ft-task', __ft.view()).length >= 3`), "task rows back");
});

step("a note written by another plugin: no uid, no area — the project gives both", async () => {
  fs.writeFileSync(path.join(VAULT, taskPath("Written by TaskNotes")),
    `---\ntype: задача\nstatus: open\nscheduled: ${TODAY}\nprojects:\n  - "[[Marathon]]"\ntimeEntries:\n  - startTime: ${TODAY}T10:00:00Z\n    endTime: ${TODAY}T10:30:00Z\n---\n`);
  await until(() => page.eval(`return !!__ft.task('Written by TaskNotes')`), "the foreign task shows up in its project's area");
  await settle();   // the row is rebuilt once the cache catches up: click the row that stays
  await click(`__ft.at(__ft.task('Written by TaskNotes').querySelector('input'))`);
  await taskIs("Written by TaskNotes", { status: "done", completedDate: TODAY });
  const f = fm("Written by TaskNotes");
  if (!/^ft-/.test(f.uid || "")) throw new Error("no uid was written: " + J(f.uid));
  if (!f.body.includes("startTime") && !JSON.stringify(f).includes("startTime")) throw new Error("the time entries were lost");
  await until(() => page.eval(`return !!__ft.task('Written by TaskNotes')?.closest('.ft-done-today')`), "the row moved to Completed");
  await click(`__ft.at(__ft.task('Written by TaskNotes').querySelector('input'))`);
  await taskIs("Written by TaskNotes", { status: "open" });
  fs.rmSync(path.join(VAULT, taskPath("Written by TaskNotes")));   // the rest of the run counts rows
  await until(() => page.eval(`return !__ft.task('Written by TaskNotes')`), "the foreign task is gone again");
});

step("the row shows what the note says: a priority dot and a deadline on another day", async () => {
  await page.eval(`const f = app.vault.getAbstractFileByPath(${J(taskPath("Buy shoes fast"))});
    await app.fileManager.processFrontMatter(f, (fm) => { fm.priority = 'high'; fm.due = ${J(TOMORROW)}; }); return true;`);
  await until(() => page.eval(`return !!__ft.task('Buy shoes fast')?.querySelector('.ft-priority.is-high')`), "the high-priority dot");
  // only a high priority is marked: a low one leaves the row clean
  await page.eval(`const f = app.vault.getAbstractFileByPath(${J(taskPath("Buy shoes fast"))});
    await app.fileManager.processFrontMatter(f, (fm) => { fm.priority = 'low'; }); return true;`);
  await until(() => page.eval(`return !__ft.task('Buy shoes fast')?.querySelector('.ft-priority')`), "no dot for a low priority");
  await until(() => page.eval(`return !!__ft.task('Buy shoes fast')?.querySelector('.ft-due')`), "the deadline badge");
  await page.eval(`const f = app.vault.getAbstractFileByPath(${J(taskPath("Buy shoes fast"))});
    await app.fileManager.processFrontMatter(f, (fm) => { delete fm.priority; delete fm.due; }); return true;`);
  await until(() => page.eval(`return !__ft.task('Buy shoes fast')?.querySelector('.ft-due')`), "the badges are gone again");
});

step("«In progress…» sends the task off: a day, an hour typed in two segments, and it waits with a ▷", async () => {
  const later = ymd(new Date(Date.now() + 5 * 864e5));
  fs.writeFileSync(path.join(VAULT, taskPath("Ask the lawyer")),
    `---\nuid: ft-run-1\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\n---\n`);
  await toPane();
  await until(() => page.eval(`return !!__ft.task('Ask the lawyer')`), "Ask the lawyer on screen");
  // no ▷ on a row that is not running: sending off lives in the row's menu
  if (await page.eval(`return !!__ft.task('Ask the lawyer').querySelector('.ft-running')`)) throw new Error("a row not sent off carries a ▷");
  await click(`__ft.grip(__ft.task('Ask the lawyer'))`);
  await menu("In progress…");
  await until(() => page.eval(`return !!document.querySelector('.ft-picker .ft-picker-caption')`), "the «look at it again» card");
  const card = JSON.parse(await page.eval(`
    const p = document.querySelector('.ft-picker');
    return JSON.stringify({ date: p.querySelector('.ft-picker-input').value,
      focused: document.activeElement?.className || '', parts: p.querySelectorAll('.ft-picker-part').length });`));
  if (card.date !== ddmmyy(TODAY)) throw new Error(`the day is not today by default: ${J(card.date)}`);
  if (!/is-hh/.test(card.focused)) throw new Error(`the caret does not start in the hour: ${J(card.focused)}`);
  if (card.parts !== 2) throw new Error("the hour is not two segments");
  // two digits and the caret moves on by itself; two more and Tab is the end of it
  await page.type("18");
  await until(() => page.eval(`return /is-mm/.test(document.activeElement?.className || '')`), "the caret moved to the minutes");
  await page.type("45");
  await page.key("Tab");
  await taskIs("Ask the lawyer", { status: "in-progress", scheduled: `${TODAY}T18:45` }, "the moment is written in one change");
  // set a moment and walk away from the card: leaving it is not «cancel»
  await click(`__ft.at(__ft.task('Ask the lawyer').querySelector('.ft-date'))`, "the date of the row");
  await until(() => page.eval(`return !!document.querySelector('.ft-picker-clock')`), "the card again");
  await page.eval(`
    const p = document.querySelector('.ft-picker');
    p.querySelector('.ft-picker-input').value = ${J(ddmmyy(TOMORROW))};
    p.querySelector('.ft-picker-part.is-hh').value = '07';
    p.querySelector('.ft-picker-part.is-mm').value = '30';
    return true;`);
  // the «Other areas» title: plain text, and never under the card
  await click(`__ft.at(__ft.view().querySelector('.ft-rest-title') || __ft.view().querySelector('.ft-done-today .ft-empty'))`, "somewhere outside the card");
  await until(() => page.eval(`return !document.querySelector('.ft-picker')`), "the card closed");
  await taskIs("Ask the lawyer", { scheduled: `${TOMORROW}T07:30` }, "what stood in the fields was kept");
  // out of the focus, behind the counter of its area, and reachable from there
  await until(() => page.eval(`
    const r = __ft.task('Ask the lawyer');
    return !r || !!r.closest('.ft-future-block');`), "the row left today's work");
  // one counter for everything that is not today; the tooltip says how much of it is in other hands
  await until(() => page.eval(`
    const c = __ft.area('Sport')?.querySelector('.ft-later-chip');
    return !!c && /running|запущен/i.test(c.getAttribute('aria-label') || '');`), "the area's ⏳ counts it among the upcoming");
  const key = await plugin(`return 'future:' + (await p.collect(false)).find((a) => a.name.includes('Sport')).name;`);
  await plugin(`if (!p.data.opened[${J(key)}]) await p.toggleShown(${J(key)}, true); p.refresh(); return true;`);
  await until(() => page.eval(`
    const r = __ft.task('Ask the lawyer');
    return !!r && !!r.closest('.ft-future-block') && !!r.querySelector('.ft-running');`),
    "and it is listed with the upcoming work, marked as running");
  // started work stands above what is only planned, with a line between the two
  const grouped = JSON.parse(await page.eval(`
    const block = __ft.task('Ask the lawyer').closest('.ft-future-block');
    const rows = [...block.querySelectorAll('li.ft-task')];
    const split = block.querySelector('.ft-ahead-split');
    return JSON.stringify({ first: !!rows[0]?.querySelector('.ft-running'),
      split: !!split, before: split ? [...block.children].indexOf(rows[0].closest('ul')) < [...block.children].indexOf(split) : null });`));
  if (!grouped.first) throw new Error("a started task is not at the top of what is not today");
  // its date is a moment to come back, not a deadline: never painted as today's work
  const painted = await page.eval(`
    const d = __ft.task('Ask the lawyer').querySelector('.ft-date');
    return d.className + " | " + getComputedStyle(d).color;`);
  if (/is-today|is-past/.test(painted)) throw new Error(`the return moment is painted like a due date: ${J(painted)}`);
  // the group must be told apart from today's work: without a line of its own it read as the focus
  const edge = await page.eval(`
    const b = __ft.task('Ask the lawyer').closest('.ft-future-block');
    const cs = getComputedStyle(b);
    return cs.borderTopWidth + " " + cs.borderTopStyle;`);
  if (!/^[1-9]/.test(edge) || /none/.test(edge)) throw new Error(`the upcoming block has no edge: ${J(edge)}`);
  if (grouped.split && !grouped.before) throw new Error("the line does not separate the started ones from the planned");
  // folded away, the waiting task is still being watched — that is where the clock lost it before
  const watched = JSON.parse(await plugin(`
    const key = 'future:' + (await p.collect(false)).find((a) => a.name.includes('Sport')).name;
    if (p.isShown(key, true)) await p.toggleShown(key, true);   // fold the group
    p.refresh();
    await new Promise((r) => setTimeout(r, 500));
    const view = [...p.views][0];
    return JSON.stringify({ folded: !p.isShown(key, true),
      pending: (view.pending || []).map((t) => t.text), alarm: !!view.alarm });`));
  if (!watched.folded || !watched.pending.includes("Ask the lawyer"))
    throw new Error(`a folded group is not watched any more: ${J(watched)}`);
  // the hour passes: it comes back into the focus by itself
  await plugin(`
    const task = p.tasks().find((x) => x.text === 'Ask the lawyer');
    await p.setRunning(task, true, ${J(TODAY)}, '00:00'); p.refresh(); return true;`);
  await until(() => page.eval(`
    const r = __ft.task('Ask the lawyer');
    return !!r && !r.closest('.ft-future-block') && !!r.querySelector('.ft-running');`),
    "its moment came: back among the rows, still marked as running");
  await click(`__ft.at(__ft.task('Ask the lawyer').querySelector('.ft-running'))`, "the ▷ on the row");
  await taskIs("Ask the lawyer", { status: "open", scheduled: TODAY }, "the row's ▷ hands it back, into today's focus");
  await settle();
  if (await page.eval(`return !!__ft.view().querySelector('.ft-wait-block, .ft-wait-chip')`))
    throw new Error("the old «running» block and counter are back");
  fs.unlinkSync(path.join(VAULT, taskPath("Ask the lawyer")));
  await settle();
});

step("the dot a robot leaves can be taken off from the row itself", async () => {
  fs.writeFileSync(path.join(VAULT, taskPath("Added by a script")),
    `---\nuid: ft-prio-1\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\npriority: high\n---\n`);
  await until(() => page.eval(`return !!__ft.task('Added by a script')?.querySelector('.ft-priority.is-high')`), "the high dot is on the row");
  await click(`__ft.at(__ft.task('Added by a script').querySelector('.ft-priority'))`, "the dot");
  await menu("No priority");
  await taskIs("Added by a script", { priority: null }, "the mark came off");
  await until(() => page.eval(`return !__ft.task('Added by a script')?.querySelector('.ft-priority')`), "and the dot is gone");
  await click(`__ft.grip(__ft.task('Added by a script'))`);
  await menu("High priority");
  await taskIs("Added by a script", { priority: "high" }, "and the menu can set one");
  // the levels must look different — a rule that loses on specificity paints them all the same grey
  await until(() => page.eval(`return !!__ft.task('Added by a script')?.querySelector('.ft-priority.is-high')`), "the high dot");
  const looks = await page.eval(`
    const dot = __ft.task('Added by a script').querySelector('.ft-priority');
    const s = getComputedStyle(dot);
    return { cls: dot.className, bg: s.backgroundColor, size: s.width };`);
  if (!/is-high/.test(looks.cls)) throw new Error("the dot does not carry the level: " + J(looks));
  if (looks.bg === "rgba(0, 0, 0, 0)" || looks.bg === "transparent")
    throw new Error("a high-priority dot is not filled: " + J(looks));
  if (parseFloat(looks.size) <= 7.2) throw new Error("a high-priority dot is not the bigger one: " + J(looks));
  fs.unlinkSync(path.join(VAULT, taskPath("Added by a script")));
  await settle();
});

step("a task with no area is not lost: «Without an area» places it", async () => {
  fs.writeFileSync(path.join(VAULT, taskPath("Nowhere")), `---\ntype: задача\nstatus: open\nscheduled: ${TODAY}\n---\n`);
  await until(() => page.eval(`return !!__ft.text('.ft-orphans-title', 'Without an area · 1')`), "the block of lost tasks");
  await click(`__ft.at(__ft.task('Nowhere').querySelector('.ft-place'))`);
  await modalInput(".prompt-input");
  await page.type("Sport");
  await sleep(300);
  await page.key("Enter");
  await taskIs("Nowhere", { area: "💪Sport" }, "the task landed in the area");
  await until(() => page.eval(`return !document.querySelector('.ft-orphans')`), "the block is gone");
  await page.eval(`const f = app.vault.getAbstractFileByPath(${J(taskPath("Nowhere"))}); await app.vault.delete(f); return true;`);
  await until(() => page.eval(`return !__ft.task('Nowhere')`), "cleaned up");
});

step("«Make it a project»: the task becomes a project and stays in the focus as its first step", async () => {
  fs.writeFileSync(path.join(VAULT, taskPath("Plan the season")),
    `---\nuid: ft-season\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\n---\n\nНужно расписать на 16 недель.\n`);
  await until(() => page.eval(`return !!__ft.task('Plan the season')`), "the task is on screen");
  // a task with a description reads as a link, and the link opens its note
  if (!(await page.eval(`return __ft.task('Plan the season').querySelector('.ft-text').hasClass('ft-text-note')`)))
    throw new Error("a task with a description is not drawn as a link");
  if (await page.eval(`return !!__ft.view().querySelector('.ft-described')`)) throw new Error("the description icon is still drawn");
  // a click beside the words, in the empty stretch of the cell, is a click to edit — not to open
  await click(`(() => { const t = __ft.task('Plan the season').querySelector('.ft-text'); const w = t.querySelector('.ft-text-link').getBoundingClientRect(), c = t.getBoundingClientRect();
    return { x: Math.min(w.right + 60, c.right - 4), y: w.top + w.height / 2 }; })()`, "beside the words");
  await editing();
  if (await page.eval(`return document.querySelector('.focus-tasks-view .is-editing')?.textContent !== 'Plan the season'`)) throw new Error("the click beside the words did not open the editor on this task");
  await page.key("Escape");
  await idle();
  // the words themselves open the note
  await click(`__ft.at(__ft.task('Plan the season').querySelector('.ft-text-link'))`);
  await until(async () => (await activePath()) === taskPath("Plan the season"), "the task's note open");
  await toPane();
  await click(`__ft.grip(__ft.task('Plan the season'))`);
  await menu("Make it a project");
  await until(() => exists("Tasks/Plan the season.md"), "the project note was made", 8000);
  await until(() => page.eval(`const r = __ft.project('Plan the season'); return !!r && r.querySelector('.ft-text')?.textContent.trim() === 'Plan the season'`),
    "the project's row shows the task as its first step");
  const note = read("Tasks/Plan the season.md") || "";
  if (!note.includes("16 недель")) throw new Error("the description did not move into the project note");
  if ((fm("Plan the season")?.body || "").includes("16 недель")) throw new Error("the description is still in the task note");
  // the step is named like its project: its link must say which of the two notes it means
  await taskIs("Plan the season", { projects: "[[Tasks/Plan the season]]" }, "the step's link names the project by path");
  // …and a rename of the project takes the step along, whatever Obsidian did with the link
  await click(`__ft.grip(__ft.project('Plan the season'))`);
  await menu("Rename");
  await editing();
  await page.eval(`__ft.selectAll()`);
  await page.type("Season plan");
  await page.key("Enter");
  await until(() => exists("Tasks/Season plan.md") && !exists("Tasks/Plan the season.md"), "the project note renamed");
  await editing();
  await page.key("Escape");
  await taskIs("Plan the season", { projects: "[[Season plan]]" }, "the step follows the renamed project");
  await until(() => page.eval(`const r = __ft.project('Season plan'); return !!r && r.querySelector('.ft-text')?.textContent.trim() === 'Plan the season'`),
    "the renamed project's row still shows the step");
  await idle();
});

step("the last step of a project checked off: the project stays as an empty row, takes a new step, and closes only by hand", async () => {
  fs.writeFileSync(path.join(VAULT, "Tasks/Cleanup.md"),
    `---\nparents:\n  - "[[Sport]]"\narea: "💪Sport"\ntype: project\n---\n`);
  fs.writeFileSync(path.join(VAULT, taskPath("Throw out the old shoes")),
    `---\nuid: ft-cleanup-1\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\nprojects:\n  - "[[Cleanup]]"\n---\n`);
  await until(() => page.eval(`return !!__ft.task('Throw out the old shoes')`), "the step is on screen");
  await click(`__ft.at(__ft.task('Throw out the old shoes').querySelector('input'))`);
  await taskIs("Throw out the old shoes", { status: "done" });
  await until(() => page.eval(`const r = __ft.project('Cleanup'); return !!r && r.hasClass('is-empty') && !!r.querySelector('.ft-no-step');`),
    "the project kept its row, empty");
  // …and the next step goes straight into it
  await click(`__ft.at(__ft.project('Cleanup').querySelector('.ft-plus'))`);
  await editing();
  await page.type("Order new ones");
  await page.key("Enter");
  await taskIs("Order new ones", { area: "💪Sport", projects: "[[Cleanup]]", scheduled: TODAY });
  await editing();
  await page.key("Escape");
  await until(() => page.eval(`const r = __ft.project('Cleanup'); return !!r && !r.hasClass('is-empty') && r.querySelector('.ft-text')?.textContent.trim() === 'Order new ones';`),
    "the project's row shows the new step");
  await idle();
  // closing the project is a menu item, offered once nothing in it is open; the box in the closed block undoes it
  await click(`__ft.at(__ft.project('Cleanup').querySelector('input'))`);
  await taskIs("Order new ones", { status: "done" });
  await until(() => page.eval(`return !!__ft.project('Cleanup')?.hasClass('is-empty')`), "empty again");
  await click(`__ft.grip(__ft.project('Cleanup'))`);
  await menu("Project done");
  await until(() => (read("Tasks/Cleanup.md") || "").includes("status: done"), "the project note says done");
  await until(() => page.eval(`const r = __ft.project('Cleanup'); return !!r && !!r.closest('.ft-done-today')`), "the project is in the closed block");
  if (await page.eval(`return __ft.all('li.ft-project-row', __ft.view()).filter((e) => e.querySelector('.ft-link')?.textContent.trim() === 'Cleanup').some((e) => !e.closest('.ft-done-today'))`))
    throw new Error("a closed project still has a row in the list");
  await click(`__ft.at(__ft.project('Cleanup').querySelector('input'))`);
  await until(() => !(read("Tasks/Cleanup.md") || "").includes("status: done"), "the box in the closed block reopened it");
  await until(() => page.eval(`const r = __ft.project('Cleanup'); return !!r && !r.closest('.ft-done-today')`), "and it is back in the list");
});

step("rename a project in place; its tasks follow it", async () => {
  await click(`__ft.grip(__ft.project('Marathon'))`);
  await menu("Rename");
  await editing();
  await page.eval(`__ft.selectAll()`);
  await page.type("Marathon 2027");
  await page.key("Enter");
  await until(() => exists("Tasks/Marathon 2027.md") && !exists("Tasks/Marathon.md"), "renamed file");
  await fileHas("Tasks/Sport.md", "- 📁 [[Marathon 2027]]\n");
  await taskIs("Buy shoes fast", { projects: "[[Marathon 2027]]" }, "the task points at the renamed project");
  await editing();
  await page.key("Escape");
  await idle();
});

step("link a note to a project: the name opens the note, the menu opens the project note", async () => {
  const before = read("Notes/Running log.md");
  await click(`__ft.grip(__ft.project('Marathon 2027'))`);
  await menu("Link a note…");
  await modalInput(".prompt-input");
  await page.type("Running log");
  await sleep(200);
  await page.key("Enter");
  await fileHas("Tasks/Marathon 2027.md", 'note: "[[Running log]]"');
  if (read("Notes/Running log.md") !== before) throw new Error("the linked note was changed");
  await click(`__ft.at(__ft.project('Marathon 2027').querySelector('.ft-link'))`);
  await until(async () => (await activePath()) === "Notes/Running log.md", "the linked note open");
  await toPane();
  await click(`__ft.grip(__ft.project('Marathon 2027'))`);
  await menu("Open task file");
  await until(async () => (await activePath()) === "Tasks/Marathon 2027.md", "the project note open");
  await toPane();
});

step("+ Area from a note, Project from a note", async () => {
  await click(`__ft.at(__ft.text('.ft-foot-button', '+ Area from a note'))`);
  await modalInput(".prompt-input");
  await page.type("Notes/Home");
  await sleep(200);
  await page.key("Enter");
  await modalInput();
  await page.key("Enter");
  await fileHas("Tasks/Home.md", 'note: "[[Notes/Home]]"');
  await until(() => page.eval(`return !!__ft.area('Home')`), "Home on screen");
  await click(`__ft.grip(__ft.area('Home'))`);
  await menu("Project from a note");
  await modalInput(".prompt-input");
  await page.type("Garden plan");
  await sleep(200);
  await page.key("Enter");
  await fileHas("Tasks/Garden plan.md", /area: "?Home"?\ntype: project\nnote: "\[\[Notes\/Garden plan\]\]"/);
});

step("New task command: text, then the place", async () => {
  await page.eval(`app.commands.executeCommandById('focus-tasks:add-task'); return true;`);
  await modalInput();
  await page.type("Call coach");
  await page.key("Enter");
  await modalInput(".prompt-input");
  await page.type("Marathon 2027");
  await sleep(200);
  await page.key("Enter");
  await taskIs("Call coach", { projects: "[[Marathon 2027]]", scheduled: TODAY });
});

step("click, then Shift-click selects the rows between; Cmd-click drops one; the menu dates them all", async () => {
  await toPane();
  await until(() => page.eval(`return !!__ft.task('Stretch') && !!__ft.task('Run 5k')`), "Sport's tasks on screen");
  await click(`__ft.at(__ft.task('Stretch').querySelector('.ft-text'))`);
  await editing();
  await click(`__ft.at(__ft.task('Run 5k').querySelector('.ft-text'))`, "Run 5k", SHIFT);
  await idle();
  const three = await selected();
  if (three.length < 2) throw new Error("selected: " + J(three));
  await page.key("Escape");
  await selectedAre([]);
  await click(`__ft.at(__ft.task('Stretch').querySelector('.ft-text'))`, "Stretch", CMD);
  await click(`__ft.at(__ft.task('Run 5k').querySelector('.ft-text'))`, "Run 5k", SHIFT);
  await until(async () => (await selected()).length === three.length, "the same rows selected again");
  await click(`__ft.grip(__ft.task('Run 5k'))`);
  await until(() => page.eval(`return !!__ft.text('.menu .menu-item-title', 'Selected: ' + ${three.length})`), "the selection menu");
  await menu("Tomorrow");
  for (const name of three) await taskIs(name, { scheduled: TOMORROW });
  await selectedAre([]);
});

step("the grip of a selected row drags them all; ⌘1–4 date them all", async () => {
  const pick = async (from, to) => {
    await until(() => page.eval(`return !!__ft.task(${J(from)}) && !!__ft.task(${J(to)})`), `${from} … ${to} on screen`);
    await click(`__ft.at(__ft.task(${J(from)}).querySelector('.ft-text'))`, from, CMD);
    await click(`__ft.at(__ft.task(${J(to)}).querySelector('.ft-text'))`, to, SHIFT);
    await until(async () => (await selected()).length >= 2, `${from} … ${to} selected`);
    return selected();
  };
  const names = await pick("Stretch", "Run 5k");
  // the drag must have something to change: make sure they are not in that project already
  await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    for (const name of ${J(names)}) {
      const task = p.tasks().find((x) => x.text === name);
      if (task) await p.setFields(task, { projects: null });
    }
    p.refresh(); return true;`);
  await settle();
  await pick("Stretch", "Run 5k");
  // Both ends are read in one go and WITHOUT scrolling: __ft.at() centres what it is asked about, so
  // taking the grip and then the header moves the grip out from under the point already measured.
  await settle();
  // The project's row is brought to the middle of the screen first: a drop near the top edge makes the
  // list auto-scroll under the pointer, and the row's middle («into») slides away from it.
  const ends = await page.eval(`
    const row = __ft.task(${J(names[0])}), head = __ft.project('Marathon 2027');
    if (!row || !head) return null;
    head.scrollIntoView({ block: 'center' });
    const g = row.querySelector(':scope > .ft-grip')?.getBoundingClientRect(), h = head.getBoundingClientRect();
    if (g && (g.top < 0 || g.bottom > innerHeight - 70)) return null;
    if (!g || !g.height || !h.height) return null;
    return { from: { x: Math.round(g.left + g.width / 2), y: Math.round(g.top + g.height / 2) },
             to: { x: Math.round(h.left + h.width / 2), y: Math.round(h.top + h.height / 2) } };`);
  if (!ends) throw new Error("the row and the project header are not both on screen");
  // what the drag saw, for the day it does not land
  await page.eval(`window.__drop = []; const p = app.plugins.plugins['focus-tasks'];
    if (!p.__dropSpy) { p.__dropSpy = true; const o = p.drop.bind(p); p.drop = (i, d, s) => { window.__drop.push({ type: i.type, n: (i.tasks || []).length, to: d?.target?.type, into: d?.into }); return o(i, d, s); }; }
    return true;`);
  await page.drag(ends.from, ends.to);
  try {
    for (const name of names) await taskIs(name, { projects: "[[Marathon 2027]]" });
  } catch (e) {
    const seen = await page.eval(`return { drops: window.__drop, at: (() => { const el = document.elementFromPoint(${ends.to.x}, ${ends.to.y}); return el && (el.className || el.tagName); })(), ends: ${J(ends)} }`);
    throw new Error(e.message + " — the drag saw: " + J(seen));
  }
  await toPane();             // keys only reach the list while its own tab is in front
  await page.key("Escape");   // Esc is the way out of a selection; a finished drop usually clears it too
  await selectedAre([]);
  await settle();
  await pick(names[0], names[names.length - 1]);
  await page.key("Meta+4");
  for (const name of names) await taskIs(name, { scheduled: null });
  await selectedAre([]);
  await settle();
  await pick(names[0], names[names.length - 1]);
  await page.key("Meta+3");
  await until(() => page.eval(`return !!document.querySelector('.ft-picker')`), "picker");
  await page.key("Escape");
  await until(() => page.eval(`return !document.querySelector('.ft-picker')`), "the picker closed");
  await page.key("Meta+1");
  for (const name of names) await taskIs(name, { scheduled: TODAY });
  // another tab active: ⌘4 belongs to Obsidian again
  await settle();
  const again = await pick(names[0], names[names.length - 1]);
  await page.eval(`app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('markdown')[0], { focus: true }); return true;`);
  // the list drops its keyboard scope on active-leaf-change; pressing before that lands in a race
  await until(() => page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    return [...p.views].every((v) => !v.scope);`), "the list let go of the keyboard");
  await page.key("Meta+4");
  await sleep(800);
  for (const name of again) if (fm(name)?.scheduled !== TODAY) throw new Error(`⌘4 in another tab changed ${name}`);
  await toPane();
  await page.key("Escape");
  await selectedAre([]);
});

step("⌘Z takes back the last change: a tick, a date, a new row", async () => {
  await toPane();
  const name = await until(() => page.eval(`return __ft.all('li.ft-task:not(.ft-project-row)', __ft.view())[0]?.querySelector('.ft-text')?.textContent.trim() || null`), "a row to work with");
  const was = fm(name);
  // a tick, then ⌘Z
  await toPane();
  await click(`__ft.at(__ft.task(${J(name)}).querySelector('input'))`);
  await taskIs(name, { status: "done" });
  await toPane();
  await page.key("Meta+z");
  await taskIs(name, { status: "open", completedDate: null }, "the tick was taken back");
  // a date, then ⌘Z
  await click(`__ft.grip(__ft.task(${J(name)}))`);
  await menu("Tomorrow");
  await taskIs(name, { scheduled: TOMORROW });
  await toPane();
  await page.key("Meta+z");
  await taskIs(name, { scheduled: was.scheduled ?? null }, "the date is back to what it was");
  await idle();
  await settle();
  // a new task, then ⌘Z (through the command, so the step does not depend on a hover-only button)
  await page.eval(`await app.commands.executeCommandById('focus-tasks:add-task'); return true;`);
  await modalInput();
  await page.type("Лишняя строка");
  await page.key("Enter");
  await until(() => page.eval(`return !!document.querySelector('.prompt input')`), "where to put it");
  await page.type("Sport");
  await sleep(300);
  await page.key("Enter");
  await until(() => exists(taskPath("Лишняя строка")), "the note was made");
  await idle();
  await toPane();
  await page.key("Meta+z");
  await until(() => !exists(taskPath("Лишняя строка")), "⌘Z removed the note it made");
});

step("ticking a box does not move the page under the reader", async () => {
  await toPane();
  await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    for (let i = 0; i < 25; i++) await p.createTask('Длинная задача номер ' + i, { area: '💪Sport', project: null }, ${J(TODAY)});
    p.refresh(); return true;`);
  await settle();
  const scroller = `(document.querySelector('.focus-tasks-pane .view-content') || document.querySelector('.focus-tasks-pane'))`;
  await page.eval(`const s = ${scroller}; s.scrollTop = Math.round(s.scrollHeight / 2); return s.scrollTop;`);
  await sleep(400);
  const before = await page.eval(`
    const s = ${scroller};
    const top = s.getBoundingClientRect().top;
    const rows = [...document.querySelectorAll('.focus-tasks-pane li.ft-task:not(.ft-project-row)')]
      .filter((r) => { const y = r.getBoundingClientRect().top; return y > top + 10 && y < top + s.clientHeight - 60; });
    const name = (r) => r.querySelector('.ft-text').textContent.trim();
    // the mark is the FIRST row on screen and the tick is below it: the list holds its place by
    // pinning the topmost row, so a row that leaves from under the mark must not move the mark
    return { tick: name(rows[rows.length - 1]), mark: name(rows[0]), markY: Math.round(rows[0].getBoundingClientRect().top) };`);
  // clicking must not be preceded by a scroll of our own: __ft.at() centres the row, which would be
  // the jump this step is looking for
  const point = await page.eval(`
    const row = [...document.querySelectorAll('.focus-tasks-pane li.ft-task')].find((r) => r.querySelector('.ft-text')?.textContent.trim() === ${J(before.tick)});
    const r = row.querySelector('input').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };`);
  await page.click(point);
  await taskIs(before.tick, { status: "done" });
  // the row visibly moves into «Completed»: that is the rebuild this step is about
  await until(() => page.eval(`return !!__ft.task(${J(before.tick)})?.closest('.ft-done-today')`), "the row moved to Completed");
  await settle();
  const after = await page.eval(`
    const row = [...document.querySelectorAll('.focus-tasks-pane li.ft-task')]
      .find((r) => r.querySelector('.ft-text')?.textContent.trim() === ${J(before.mark)});
    return row ? Math.round(row.getBoundingClientRect().top) : null;`);
  if (after === null) throw new Error("the row that was on screen is gone: " + J(before));
  const moved = Math.abs(after - before.markY);
  if (moved > 30) throw new Error(`the page jumped by ${moved}px when a box was ticked (${J(before)} → ${after})`);
  await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    for (const task of p.tasks()) if (task.text.startsWith('Длинная задача номер')) await p.trash(task.file);
    p.refresh(); return true;`);
  await settle();
});

step("the tasks folder setting", async () => {
  await plugin(`p.settings.tasksFolder = 'Задачи 2'; await p.saveAll(); p.refresh(); return true;`);
  // the projects keep their rows (empty ones); it is the tasks that must be gone
  await until(() => page.eval(`return !!document.querySelector('.focus-tasks-pane .ft-onboarding') || __ft.all('li.ft-task:not(.ft-project-row)', __ft.view()).length === 0`), "no tasks from the new folder");
  await plugin(`p.settings.tasksFolder = 'Задачи'; await p.saveAll(); p.refresh(); return true;`);
  await until(() => page.eval(`return __ft.all('li.ft-task:not(.ft-project-row)', __ft.view()).length > 0`), "tasks back");
});

step("the settings tab renders", async () => {
  const ok = await page.eval(`app.setting.open(); app.setting.openTabById('focus-tasks'); await new Promise((r) => setTimeout(r, 300));
    const text = app.setting.activeTab?.containerEl.textContent || ''; app.setting.close();
    return ['Folder', 'Tasks folder', 'Language', 'Area note name', 'Date format'].every((s) => text.includes(s));`);
  if (!ok) throw new Error("settings missing");
});

step("the settings offer TaskNotes, and know when it is not there", async () => {
  const seen = await page.eval(`app.setting.open(); app.setting.openTabById('focus-tasks'); await new Promise((r) => setTimeout(r, 300));
    const el = app.setting.activeTab?.containerEl;
    const row = [...el.querySelectorAll('.setting-item')].find((r) => r.textContent.includes('TaskNotes'));
    const out = { row: !!row, button: row?.querySelector('button')?.textContent || null,
      installed: !!app.plugins.manifests?.tasknotes };
    app.setting.close();
    return out;`);
  if (!seen.row) throw new Error("no TaskNotes row in the settings");
  const want = seen.installed ? ["Point it at these tasks", "Its settings", "Turn on"] : ["Install"];
  if (!want.includes(seen.button)) throw new Error(`the button reads ${J(seen.button)}, expected one of ${J(want)}`);
});

step("an ordinary install is told the plugin is unfinished, and where to ask", async () => {
  await toPane();
  const strip = await page.eval(`
    const s = __ft.view()?.querySelector('.ft-wip');
    return JSON.stringify({ text: s?.textContent || '', href: s?.querySelector('a')?.getAttribute('href') || '' });`);
  const seen = JSON.parse(strip);
  if (!seen.text.includes("@zastashkov") || seen.href !== "https://t.me/zastashkov")
    throw new Error(`the notice does not point at Telegram: ${strip}`);
});

step("two builds side by side: the settings say which one runs, and swap them", async () => {
  // the workshop delivers a build by stamping its identity into main.js and leaving the spare ones
  // in the vault — not beside the plugin, which is where a sync would drop them
  const dir = path.join(VAULT, ".obsidian/plugins/focus-tasks");
  const root = path.join(VAULT, "Internals/FocusTasks");
  const live = fs.readFileSync(path.join(dir, "main.js"), "utf8");
  const stamp = (mode, extra = {}) => ({ mode, commit: mode === "test" ? "bbbb222" : "aaaa111",
    subject: mode === "test" ? "Что-то на ревью" : "Влитое", at: new Date().toISOString(), ...extra });
  const bake = (mode, extra) => live.replace(/^const BUILD = \{[^\n]*\};$/m, `const BUILD = ${JSON.stringify(stamp(mode, extra))};`);
  for (const mode of ["stable", "test"]) {
    const extra = mode === "test" ? { queue: 3 } : {};
    fs.mkdirSync(path.join(root, mode), { recursive: true });
    for (const f of ["manifest.json", "styles.css"]) fs.copyFileSync(path.join(dir, f), path.join(root, mode, f));
    fs.writeFileSync(path.join(root, mode, "main.js"), bake(mode, extra));
    fs.writeFileSync(path.join(root, mode, "build.json"), JSON.stringify(stamp(mode, extra)));
  }
  fs.writeFileSync(path.join(dir, "main.js"), bake("test", { queue: 3 }));
  await page.eval(`await app.plugins.disablePlugin('focus-tasks'); await app.plugins.enablePlugin('focus-tasks'); return true;`);
  await toPane();
  await until(() => page.eval(`return __ft.view()?.querySelector('.ft-foot-badge')?.textContent`), "the «test» mark under the list");
  if (await page.eval(`return !!__ft.view()?.querySelector('.ft-wip')`))
    throw new Error("a delivered build still shows the «work in progress» notice");
  const seen = await page.eval(`app.setting.open(); app.setting.openTabById('focus-tasks'); await new Promise((r) => setTimeout(r, 400));
    const el = app.setting.activeTab?.containerEl;
    const row = [...el.querySelectorAll('.setting-item')].find((r) => /Build|Сборка/.test(r.querySelector('.setting-item-name')?.textContent || ''));
    const out = { desc: row?.querySelector('.setting-item-description')?.textContent || '',
      buttons: [...(row?.querySelectorAll('button') || [])].map((b) => b.textContent + (b.disabled ? ' (off)' : '')) };
    app.setting.close();
    return out;`);
  if (!/Test|Тестовая/.test(seen.desc) || !seen.desc.includes("Что-то на ревью"))
    throw new Error(`the row does not say what runs: ${J(seen.desc)}`);
  if (!/3/.test(seen.desc)) throw new Error(`the row does not say how far ahead the test build is: ${J(seen.desc)}`);
  if (J(seen.buttons) !== J(["Stable", "Test (off)"]) && J(seen.buttons) !== J(["Стабильная", "Тестовая (off)"]))
    throw new Error(`both modes belong in the row, the running one greyed out: ${J(seen.buttons)}`);
  // back to the stable one, from the settings, without anyone's help
  await plugin(`return p.switchBuild('stable');`);
  await until(async () => /aaaa111/.test(fs.readFileSync(path.join(dir, "main.js"), "utf8")),
    "the stable build is the one in the plugin folder now");
  await toPane();
  await until(() => page.eval(`return !__ft.view()?.querySelector('.ft-foot-badge')`), "the mark is gone with the test build");
  const alone = JSON.parse(await page.eval(`app.setting.open(); app.setting.openTabById('focus-tasks');
    await new Promise((r) => setTimeout(r, 400));
    const el = app.setting.activeTab?.containerEl;
    const row = [...el.querySelectorAll('.setting-item')].find((r) => /Build|Сборка/.test(r.querySelector('.setting-item-name')?.textContent || ''));
    const out = [...(row?.querySelectorAll('button') || [])].map((b) => b.textContent + (b.disabled ? ' (off)' : ''));
    app.setting.close();
    return JSON.stringify(out);`));
  if (alone.length !== 2 || !alone.some((b) => b.endsWith("(off)")))
    throw new Error(`both modes belong in the row, the running one greyed out: ${J(alone)}`);
  // a test build that is the stable one under another name is not a choice
  fs.writeFileSync(path.join(root, "test", "build.json"), JSON.stringify(stamp("stable")));
  const twins = JSON.parse(await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    const c = await p.buildChoices();
    return JSON.stringify([c.same, c.test.offer]);`));
  if (J(twins) !== J([true, false])) throw new Error(`twin builds are still offered as a choice: ${J(twins)}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, "main.js"), live);
  await page.eval(`await app.plugins.disablePlugin('focus-tasks'); await app.plugins.enablePlugin('focus-tasks'); return true;`);
  await toPane();
});

step("the ⏳ of an area folds its upcoming work — in «All» too, where the flag is inverted", async () => {
  // this step walks through both view modes, so it puts the list back exactly as it found it
  const saved = await plugin(`return JSON.stringify({ all: p.everything(),
    folded: { ...p.data.folded }, opened: { ...p.data.opened } });`);
  // the chip only exists when the area has both: work due today (so it is in the focus) and work ahead
  fs.writeFileSync(path.join(VAULT, taskPath("Chip today")),
    `---\nuid: ft-chip-1\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\n---\n`);
  fs.writeFileSync(path.join(VAULT, taskPath("Chip tomorrow")),
    `---\nuid: ft-chip-2\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TOMORROW}\n---\n`);
  await until(async () => JSON.parse(await plugin(`
    const a = (await p.collect(false)).find((x) => x.name.includes('Sport'));
    const has = (rows, name) => rows.some((r) => r.kind === 'task' && r.task.text === name);
    return JSON.stringify(!!a && has(a.rows, 'Chip today') && has(a.ahead, 'Chip tomorrow'));`)),
    "both fixtures are in the model");
  const shown = () => page.eval(`
    const a = __ft.area('Sport')?.closest('.ft-area');
    return !!a?.querySelector('.ft-future-block');`);
  for (const wide of [false, true]) {
    await plugin(`
      if (p.everything() !== ${wide}) p.setEverything(${wide});
      const a = (await p.collect(${wide})).find((x) => x.name.includes('Sport'));
      if (!p.isShown('area:' + a.name, ${wide})) await p.toggleShown('area:' + a.name, ${wide});
      p.refresh(); return true;`);
    await settle();
    if (!(await page.eval(`return !!__ft.area('Sport')?.querySelector('.ft-later-chip')`)))
      throw new Error(`no ⏳ on the area to click (All = ${wide})`);
    const before = await shown();
    await click(`__ft.at(__ft.area('Sport').querySelector('.ft-later-chip'))`, "the ⏳ of the area");
    await settle();
    if ((await shown()) === before) throw new Error(`the ⏳ does nothing (All = ${wide})`);
    await click(`__ft.at(__ft.area('Sport').querySelector('.ft-later-chip'))`, "the ⏳ again");
    await settle();
    if ((await shown()) !== before) throw new Error(`the ⏳ does not come back (All = ${wide})`);
  }
  await plugin(`
    const was = JSON.parse(${J(saved)});
    p.data.folded = was.folded; p.data.opened = was.opened;
    p.saveFolds();
    if (p.everything() !== was.all) p.setEverything(was.all);
    p.refresh(); return true;`);
  for (const name of ["Chip today", "Chip tomorrow"]) fs.unlinkSync(path.join(VAULT, taskPath(name)));
  await settle();
});

step("a project is one row: its name and its first step; +N opens the rest; the box takes the next one", async () => {
  const saved = await plugin(`return JSON.stringify({ all: p.everything(), folded: { ...p.data.folded }, opened: { ...p.data.opened } });`);
  fs.writeFileSync(path.join(VAULT, "Tasks/Flatland.md"), '---\nparents:\n  - "[[Sport]]"\narea: "💪Sport"\ntype: project\n---\n');
  const step = (name, uid, day) => fs.writeFileSync(path.join(VAULT, taskPath(name)),
    `---\nuid: ${uid}\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${day}\nprojects:\n  - "[[Flatland]]"\n---\n`);
  step("Flat one", "ft-flat-1", TODAY);
  step("Flat two", "ft-flat-2", TODAY);
  step("Flat later", "ft-flat-3", TOMORROW);
  await plugin(`
    if (p.everything()) p.setEverything(false);
    const a = (await p.collect(false)).find((x) => x.name.includes('Sport'));
    if (a && !p.isShown('area:' + a.name, false)) await p.toggleShown('area:' + a.name, false);
    const n = p.notes().find((x) => x.project && x.file.basename === 'Flatland');
    if (n) delete p.data.opened['steps:' + n.file.path];
    p.saveFolds(); p.refresh(); return true;`);
  await until(() => page.eval(`
    const row = __ft.project('Flatland');
    return !!row && row.querySelector('.ft-text')?.textContent.trim() === 'Flat one' && row.querySelector('.ft-steps-more')?.textContent.trim() === '+1';`),
    "one row: the project, its first step, +1");
  if (await page.eval(`return !!__ft.task('Flat two')`)) throw new Error("the second step is on screen while the row is folded");
  if (await page.eval(`return !!__ft.view().querySelector('.ft-project')`)) throw new Error("a project header is still drawn somewhere");
  // +1 opens the steps under the row, and the row is then the name alone
  await click(`__ft.at(__ft.project('Flatland').querySelector('.ft-steps-more'))`, "+1");
  await until(() => page.eval(`
    const row = __ft.project('Flatland');
    return !!row && row.hasClass('is-open') && !!row.nextElementSibling?.hasClass('ft-steps') && !!__ft.task('Flat two') && !row.querySelector('.ft-text');`),
    "both steps as rows of their own, the row without a step");
  await click(`__ft.at(__ft.project('Flatland').querySelector('.ft-steps-more'))`, "−");
  await until(() => page.eval(`return !__ft.task('Flat two') && !__ft.project('Flatland').hasClass('is-open')`), "folded again");
  // the box ticks the shown step and the next one takes its place
  await settle();
  await click(`__ft.at(__ft.project('Flatland').querySelector('input'))`);
  try {
    await taskIs("Flat one", { status: "done" });
  } catch (e) {
    const seen = await page.eval(`
      const row = __ft.project('Flatland'); const box = row?.querySelector('input');
      const p = app.plugins.plugins['focus-tasks'];
      return { text: row?.querySelector('.ft-text')?.textContent.trim(), checked: box?.checked, disabled: box?.disabled, toggling: row?.hasClass('is-toggling'),
        inFlight: [...p.toggling], notices: [...document.querySelectorAll('.notice')].map((n) => n.textContent.trim()),
        editing: [...p.views].some((v) => v.editing) };`);
    throw new Error(e.message + " — the row after the click: " + J(seen));
  }
  await until(() => page.eval(`
    const row = __ft.project('Flatland');
    return !!row && row.querySelector('.ft-text')?.textContent.trim() === 'Flat two' && !row.querySelector('.ft-steps-more');`),
    "the next step took the row");
  // the later step: the project's row in the area's ⏳ pile
  await plugin(`if (!p.isShown('future:💪Sport', true)) await p.toggleShown('future:💪Sport', true); p.refresh(); return true;`);
  await until(() => page.eval(`
    const pile = __ft.area('Sport').closest('.ft-area').querySelector('.ft-future-block');
    const row = pile && __ft.all('li.ft-project-row', pile).find((e) => e.querySelector('.ft-link')?.textContent.trim() === 'Flatland');
    return !!row && row.querySelector('.ft-text')?.textContent.trim() === 'Flat later';`), "the project's row in the ⏳ pile shows the later step");
  // «All»: the same rows, no tree
  await plugin(`p.setEverything(true); return true;`);
  // an area of the focus keeps its two piles in «All», the ⏳ one open: the project has a row in each
  await until(() => page.eval(`
    const rows = __ft.all('li.ft-project-row', __ft.view()).filter((e) => e.querySelector('.ft-link')?.textContent.trim() === 'Flatland' && !e.closest('.ft-done-today'));
    return rows.length === 2 && rows.map((r) => r.querySelector('.ft-text')?.textContent.trim()).join('|') === 'Flat two|Flat later' && !__ft.view().querySelector('.ft-project');`),
    "the same rows in «All», one per pile, and no project headers anywhere");
  await plugin(`
    const was = JSON.parse(${J(saved)});
    p.data.folded = was.folded; p.data.opened = was.opened;
    p.saveFolds();
    if (p.everything() !== was.all) p.setEverything(was.all);
    p.refresh(); return true;`);
  for (const f of [taskPath("Flat one"), taskPath("Flat two"), taskPath("Flat later"), "Tasks/Flatland.md"]) fs.unlinkSync(path.join(VAULT, f));
  await settle();
});

step("Russian interface", async () => {
  await plugin(`p.settings.language = 'ru'; p.applyLanguage(); p.refresh(); return true;`);
  await until(() => page.eval(`return !!__ft.text('.ft-foot-button', '+ Область')`), "Russian labels");
  await plugin(`p.settings.language = 'en'; p.applyLanguage(); await p.saveAll(); p.refresh(); return true;`);
});

step("a ```focus-tasks``` block in a note renders the same list, and its boxes work", async () => {
  fs.writeFileSync(path.join(VAULT, "Dashboard.md"), "---\ncssclasses: [focus-tasks-note]\n---\n\n```focus-tasks\n```\n\n");
  await until(() => page.eval(`return !!app.vault.getAbstractFileByPath('Dashboard.md')`), "Dashboard indexed");
  await page.eval(`const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath('Dashboard.md')); l.view.editor?.setCursor({ line: 6, ch: 0 }); return true;`);
  const block = `[...document.querySelectorAll('.focus-tasks-view')].find((e) => !e.closest('.focus-tasks-pane') && e.getClientRects().length)`;
  const row = (name) => `__ft.all('li.ft-task', ${block}).find((e) => e.querySelector('.ft-text')?.textContent.trim() === ${J(name)})`;
  await until(() => page.eval(`return !!(${row("Call coach")})`), "Call coach in the block");
  await page.click(await page.eval(`return __ft.at((${row("Call coach")}).querySelector('input'))`));
  await taskIs("Call coach", { status: "done", completedDate: TODAY });
  await until(() => page.eval(`return !!(${row("Call coach")})?.closest('.ft-done-today')`), "the row moved to Completed in the block");
  await page.click(await page.eval(`return __ft.at((${row("Call coach")}).querySelector('input'))`));
  await taskIs("Call coach", { status: "open" });

  // the same list inside a note must not throw the page around when a box is ticked
  await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    for (let i = 0; i < 25; i++) await p.createTask('Строка в блоке ' + i, { area: '💪Sport', project: null }, ${J(TODAY)});
    p.refresh(); return true;`);
  await settle();
  const place = await page.eval(`
    const view = ${block};
    const p = app.plugins.plugins['focus-tasks'];
    const s = [...p.views].find((v) => v.containerEl.closest('.focus-tasks-view') === view || v.containerEl === view || view.contains(v.containerEl))?.scroller
      || view.closest('.markdown-preview-view, .view-content');
    if (!s) return { error: 'no scroller' };
    s.scrollTop = Math.round(s.scrollHeight / 2);
    await new Promise((r) => setTimeout(r, 400));
    const top = s.getBoundingClientRect().top;
    const name = (r) => r.querySelector('.ft-text').textContent.trim();
    const rows = [...view.querySelectorAll('li.ft-task:not(.ft-project-row)')].filter((r) => { const y = r.getBoundingClientRect().top; return y > top + 10 && y < top + s.clientHeight - 60; });
    if (rows.length < 3) return { error: 'only ' + rows.length + ' rows on screen in the block' };
    const box = rows[1].querySelector('input');
    const b = box.getBoundingClientRect();
    return { tick: name(rows[1]), mark: name(rows[rows.length - 1]), markY: Math.round(rows[rows.length - 1].getBoundingClientRect().top),
      point: { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } };`);
  if (place.error) throw new Error("the block could not be measured: " + place.error);
  await page.click(place.point);
  await taskIs(place.tick, { status: "done" });
  await until(() => page.eval(`return !!(${block}).querySelector('.ft-done-today')`), "Completed appeared in the block");
  await settle();
  const moved = await page.eval(`
    const view = ${block};
    const row = [...view.querySelectorAll('li.ft-task')].find((r) => r.querySelector('.ft-text')?.textContent.trim() === ${J(place.mark)});
    return row ? Math.round(row.getBoundingClientRect().top) : null;`);
  if (moved === null) throw new Error("the row that was on screen is gone from the block");
  if (Math.abs(moved - place.markY) > 40) throw new Error(`the note jumped by ${Math.abs(moved - place.markY)}px when a box was ticked in the block`);
  await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    for (const task of p.tasks()) if (task.text.startsWith('Строка в блоке')) await p.trash(task.file);
    p.refresh(); return true;`);
  await settle();
});

step("in Live Preview the note holds its place when a box is ticked", async () => {
  // Live Preview scrolls in the editor's own scroller, not the one reading mode uses: the list has to
  // hold on to that one, or the note jumps on every tick.
  await page.eval(`
    const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === 'Dashboard.md');
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await leaf.setViewState({ type: 'markdown', state: { file: 'Dashboard.md', mode: 'source', source: false } });
    const p = app.plugins.plugins['focus-tasks'];
    for (let i = 0; i < 25; i++) await p.createTask('Живая строка ' + i, { area: '💪Sport', project: null }, ${J(TODAY)});
    p.refresh();
    return true;`);
  await settle();
  const place = await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    const view = [...p.views].find((v) => !v.leaf && v.containerEl.getClientRects().length);
    if (!view) return { error: 'no block on screen' };
    const s = view.scroller;
    if (!s) return { error: 'no scroller' };
    s.scrollTop = Math.round(s.scrollHeight / 2);
    await new Promise((r) => setTimeout(r, 400));
    const top = s.getBoundingClientRect().top;
    const name = (r) => r.querySelector('.ft-text').textContent.trim();
    const rows = [...view.containerEl.querySelectorAll('li.ft-task:not(.ft-project-row)')].filter((r) => { const y = r.getBoundingClientRect().top; return y > top + 10 && y < top + s.clientHeight - 60; });
    if (rows.length < 3) return { error: 'only ' + rows.length + ' rows on screen' };
    const b = rows[1].querySelector('input').getBoundingClientRect();
    return { scroller: s.className.slice(0, 30), tick: name(rows[1]), mark: name(rows[rows.length - 1]),
      markY: Math.round(rows[rows.length - 1].getBoundingClientRect().top), point: { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } };`);
  if (place.error) throw new Error("Live Preview could not be measured: " + place.error);
  await page.click(place.point);
  await taskIs(place.tick, { status: "done" });
  await settle();
  const moved = await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    const view = [...p.views].find((v) => !v.leaf && v.containerEl.getClientRects().length);
    const row = [...view.containerEl.querySelectorAll('li.ft-task')].find((r) => r.querySelector('.ft-text')?.textContent.trim() === ${J(place.mark)});
    return row ? Math.round(row.getBoundingClientRect().top) : null;`);
  if (moved === null) throw new Error("the row that was on screen is gone: " + J(place));
  if (Math.abs(moved - place.markY) > 40) throw new Error(`the note jumped by ${Math.abs(moved - place.markY)}px in Live Preview (scroller ${place.scroller})`);
  await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    for (const task of p.tasks()) if (task.text.startsWith('Живая строка')) await p.trash(task.file);
    p.refresh(); return true;`);
  await settle();
});

step("closing the pane takes the editor, the picker and the hotkeys with it", async () => {
  await toPane();
  const row = await until(() => page.eval(`return __ft.all('li.ft-task:not(.ft-project-row)', __ft.view())[0]?.querySelector('.ft-text')?.textContent.trim() || null`), "a row to edit");
  await click(`__ft.at(__ft.task(${J(row)}).querySelector('.ft-text'))`);
  await editing();
  const leaks = await page.eval(`
    const leaf = app.workspace.getLeavesOfType('focus-tasks-view')[0];
    const view = leaf?.view?.children?.[0] || leaf?.view;
    leaf.detach();
    await new Promise((r) => setTimeout(r, 400));
    const el = document.querySelector('.ft-text.is-editing');
    return { editing: !!el, picker: !!document.querySelector('.ft-picker'), dragLine: !!document.querySelector('.ft-drop-line') };`);
  if (leaks.editing || leaks.picker) throw new Error("something stayed behind after the pane closed: " + J(leaks));
  await page.eval(`await app.commands.executeCommandById('focus-tasks:open'); return true;`);
  await until(() => page.eval(`return !!document.querySelector('.focus-tasks-pane li.ft-task')`), "the pane is back");
});

step("delete a project: its note goes to the trash, its tasks stay in the area", async () => {
  await toPane();
  await until(() => page.eval(`return !!__ft.project('Marathon 2027')`), "Marathon 2027 on screen");
  await click(`__ft.grip(__ft.project('Marathon 2027'))`);
  await menu("Delete project");
  await until(() => page.eval(`return !!document.querySelector('.modal .mod-warning')`), "confirm");
  await click(`__ft.at(document.querySelector('.modal .mod-warning'))`);
  await until(() => !exists("Tasks/Marathon 2027.md") && exists(".trash/Marathon 2027.md"), "in .trash");
  await taskIs("Buy shoes fast", { area: "💪Sport", projects: null }, "its tasks stayed in the area");
});

step("delete an area: its projects and tasks go with it", async () => {
  await until(() => page.eval(`return !!__ft.area('Sport')`), "Sport on screen");
  await click(`__ft.grip(__ft.area('Sport'))`);
  await menu("Delete area");
  await until(() => page.eval(`return !!document.querySelector('.modal .mod-warning')`), "confirm");
  await click(`__ft.at(document.querySelector('.modal .mod-warning'))`);
  await until(() => !exists("Tasks/Sport.md"), "Sport gone");
  await noTask("Buy shoes fast");
  await until(() => page.eval(`return !__ft.area('Sport')`), "Sport off screen");
});

step("commands are registered", async () => {
  const ids = await page.eval(`return Object.keys(app.commands.commands).filter((k) => k.startsWith('focus-tasks:')).sort()`);
  const want = ["add-area", "add-task", "area-from-note", "fold-all", "open", "toggle-all", "undo", "unfold-all"].map((k) => "focus-tasks:" + k);
  // ⌘Z must not be claimed for the whole app: with it on the command, a note lost its own undo
  const claimed = await page.eval(`
    const hk = app.hotkeyManager;
    const all = { ...(hk.customKeys || {}), ...(hk.defaultKeys || {}) };
    return JSON.stringify(Object.entries(all)
      .filter(([id]) => id.startsWith('focus-tasks:'))
      .map(([id, keys]) => id + ' = ' + (keys || []).map((k) => (k.modifiers || []).join('+') + '+' + k.key).join(', ')));`);
  if (/\+z\b/i.test(claimed)) throw new Error(`the plugin claims ⌘Z app-wide: ${claimed}`);
  if (J(ids) !== J(want)) throw new Error(J(ids));
});

// --- run ------------------------------------------------------------------------------------

function buildVault() {
  fs.rmSync(VAULT, { recursive: true, force: true });
  const plug = path.join(VAULT, ".obsidian/plugins/focus-tasks");
  fs.mkdirSync(plug, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(path.join(ROOT, f), path.join(plug, f));
  fs.writeFileSync(path.join(VAULT, ".obsidian/app.json"), J({ nativeMenus: false, trashOption: "local", promptDelete: false, alwaysUpdateLinks: true }));
  fs.mkdirSync(path.join(VAULT, "Notes"));
  fs.writeFileSync(path.join(VAULT, "Notes/Running log.md"), "# Running log\n\nWeek 1: 12 km.\n");
  fs.writeFileSync(path.join(VAULT, "Notes/Home.md"), "# Home\n");
  fs.writeFileSync(path.join(VAULT, "Notes/Garden plan.md"), "# Garden plan\n");
}

const isTestWindow = (p) => p.title === `${NAME} - Obsidian` || p.title.includes(` - ${NAME} - Obsidian`) || p.title.startsWith(`${NAME} - Obsidian`);

async function openVault() {
  for (const p of (await Page.list()).filter(isTestWindow)) {
    await (await Page.connect((x) => x.id === p.id)).close();
    // an old window of the same vault that is still closing takes the new one down with it
    await until(async () => !(await Page.list()).some((x) => x.id === p.id), "the old test window to close", 15000);
    await sleep(3000);
  }
  buildVault();
  main = await Page.connect((p) => !isTestWindow(p));
  if (!main) throw new Error(`no Obsidian on 127.0.0.1:${PORT} — start it with --remote-debugging-port=${PORT}`);
  const r = await main.eval(`return require('electron').ipcRenderer.sendSync('vault-open', ${J(VAULT)}, false);`);
  if (r !== true) throw new Error("vault-open: " + J(r));
  page = await until(() => Page.connect(isTestWindow), "the test window", 20000);
  await page.send("Runtime.enable");
  await page.front();
  await until(() => page.eval(`return !!(window.app && app.workspace.layoutReady)`), "layout ready", 20000);
  // Obsidian keeps mobile emulation for the whole app: a phone run left on would silently test the
  // wrong build here (no hover, no focus in the picker), so turn it off and wait for the reload.
  if (await page.eval(`return document.body.classList.contains('is-mobile')`)) {
    await page.eval(`app.emulateMobile(false); return true;`).catch(() => {});
    await sleep(4000);
    page = await until(async () => {
      const p = await Page.connect(isTestWindow);
      const ready = p && await p.eval(`return !!(window.app && app.workspace.layoutReady && !document.body.classList.contains('is-mobile'))`).catch(() => false);
      return ready ? p : null;
    }, "the window back in desktop mode", 40000);
    await page.send("Runtime.enable");
    await page.front();
  }
  await page.eval(`
    document.querySelectorAll('.modal-close-button').forEach((b) => b.click());
    await app.plugins.setEnable(true);
    await app.plugins.loadManifests();
    await app.plugins.enablePluginAndSave('focus-tasks');
    const p = app.plugins.plugins['focus-tasks'];
    p.settings.language = 'en'; p.applyLanguage();
    p.settings.tasksFolder = 'Задачи';
    p.settings.areaFrontmatter = 'kind: focus-area';
    p.settings.projectFrontmatter = 'parents:\\n  - "[[{areaNote}]]"';
    await p.saveAll();
    await app.commands.executeCommandById('focus-tasks:open');
    return true;`);
  await page.eval(HELPERS + " return true;");
  // the first click on a fresh window only activates it (macOS): spend it on an empty spot
  await sleep(1000);
  await page.click(await page.eval(`const r = document.querySelector('.focus-tasks-pane').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom - 40 };`));
  await sleep(500);
}

async function closeVault() {
  if (KEEP || !page) return;
  await page.close();
  await main.eval(`require('electron').ipcRenderer.sendSync('vault-remove', ${J(VAULT)}); return true;`).catch(() => {});
  fs.rmSync(VAULT, { recursive: true, force: true });
}

let failed = 0;
try {
  await openVault();
  console.log(`Focus Tasks e2e in ${NAME}`);
  for (const [i, s] of steps.entries()) {
    try {
      await s.fn();
      console.log(`  ✓ ${s.name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${s.name}\n      ${e.message.split("\n")[0]}`);
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.shot(path.join(SHOTS, `${NAME}-${String(i + 1).padStart(2, "0")}.png`)).catch(() => {});
      await page.key("Escape").catch(() => {});
      await page.key("Escape").catch(() => {});
      break;  // later steps build on this one
    }
  }
  const mine = page.errors.filter((e) => /focus-tasks/.test(e));
  if (mine.length) { failed++; console.log("  ✗ errors in the console:\n      " + mine.join("\n      ")); }
  else console.log("  ✓ no errors from the plugin in the console");
} finally {
  if (!failed) await closeVault();
  else console.log(`\nleft open for a look: ${VAULT}` + (fs.existsSync(SHOTS) ? `; screenshots in ${SHOTS}` : ""));
  page?.ws.close();
  main?.ws.close();
}
console.log(failed ? `\nFAILED` : `\nall ${steps.length} steps passed`);
process.exit(failed ? 1 : 0);
