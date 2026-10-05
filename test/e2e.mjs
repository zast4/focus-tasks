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
import { execFileSync } from "node:child_process";
import { Page, PORT, J, sleep, ymd, until } from "./cdp.mjs";
import { checkRowAlignment } from "./row-alignment.mjs";
import { checkIntentsUI } from "./intents-ui.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const baselineIndex = args.indexOf('--baseline');
const BASELINE = baselineIndex >= 0 ? args[baselineIndex + 1] : null;
const themeIndex = args.indexOf('--theme');
const THEME = themeIndex >= 0 ? path.resolve(args[themeIndex + 1]) : null;
const companionPath = (flag, id) => {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  return args[i + 1] && !args[i + 1].startsWith('--') ? path.resolve(args[i + 1])
    : path.join(process.env.HOME, 'vaults/Vault/.obsidian/plugins', id);
};
const companions = [
  { id: 'obsidian-tasks-plugin', source: companionPath('--with-tasks', 'obsidian-tasks-plugin') },
  { id: 'tasknotes', source: companionPath('--with-tasknotes', 'tasknotes'), settings: {
    taskIdentificationMethod: 'property', taskPropertyName: 'type', taskPropertyValue: 'задача', tasksFolder: 'Задачи',
    starterNoteCreated: true, // existing installation, not its asynchronous first-install tour
  } },
].filter(c => c.source);
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
// Build switching replaces the pane. Observe its stable parent and filter live
// pane mutations, rather than watching the detached container from the first build.
new MutationObserver(records => {
  if(records.some(r=>r.target.closest?.('.focus-tasks-pane') || [...r.addedNodes,...r.removedNodes].some(n=>n.matches?.('.focus-tasks-pane')||n.querySelector?.('.focus-tasks-pane'))))window.__ftLast=Date.now();
}).observe(document.body, { subtree: true, childList: true, characterData: true });
window.__ft = {
  view() { return [...document.querySelectorAll('.focus-tasks-pane .focus-tasks-view')].find((e) => e.getClientRects().length); },
  all(sel, root) { return [...(root || document).querySelectorAll(sel)].filter((e) => e.getClientRects().length); },
  task(n) { return n ? this.all('li.ft-task', this.view()).find((e) => e.querySelector('.ft-text')?.textContent.trim() === n) : undefined; },
  project(n) { return this.all('li.ft-project-row', this.view()).find((e) => e.querySelector('.ft-link')?.textContent.trim() === n); },
  name(n) { return this.project(n)?.querySelector('.ft-project-name'); },
  area(n) { return this.all('.ft-area-title', this.view()).find((e) => e.textContent.includes(n)); },
  text(sel, n) { return this.all(sel).find((e) => e.textContent.trim() === n); },
  at(el, dy = 0.5) {
    if (!el) return null;
    window.__ftTarget = el;
    // a hover-only control is out of the layout until the pointer is over its row; the mouse is about
    // to be there, so it is shown where the hover would show it
    // — and with it every other hover-only control of that row, so the layout is the hovered one
    if (!el.getClientRects().length && el.closest('.focus-tasks-view')) {
      const row = el.closest('li.ft-task, .ft-area-title, .ft-page-head') || el.parentElement;
      for (const c of row.querySelectorAll(':scope > .ft-plus, :scope > .ft-chip.is-quiet, :scope > .ft-date.is-empty, :scope > .ft-more'))
        if (!c.getClientRects().length) c.style.display = 'inline-flex';
      el.style.display = 'inline-flex';
    }
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
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
const pos = async (expr, what, requireHit = false) => {
  await page.front();
  // bringing the window to front may give the focus back to the last note tab
  if (expr.includes('__ft.task(') || !(await page.eval(`return !!__ft.view()`))) { await toPane(); await sleep(300); }
  await settle();
  let p = await page.eval(`window.__ftTarget=null; return ${expr};`);
  if (!p) throw new Error(`not on screen: ${what || expr}`);
  // scrollIntoView queues a scroll event; it must finish before a newly opened
  // card starts listening for scroll. Hover can also change a row's geometry.
  await page.mouse('mouseMoved', p.x, p.y, 0);
  p = await page.eval(`await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); window.__ftTarget=null; return ${expr};`);
  if (!p) throw new Error(`lost before click: ${what || expr}`);
  // A notice (especially Undo) can cover a date in the upper-right corner.
  // Wait for the actual target to be hittable; clicking its old coordinates lies.
  if (requireHit) p = await until(()=>page.eval(`window.__ftTarget=null;const point=${expr};const el=window.__ftTarget;if(!point)return null;const hit=document.elementFromPoint(point.x,point.y);return hit&&(el?(hit===el||el.contains(hit)):!hit.closest('.notice-container,.modal-container'))?point:null;`),'the click target is uncovered: '+(what||expr),15000);
  if(expr.includes("'.ft-date'")) await page.eval(`const e=document.elementFromPoint(${p.x},${p.y});window.__auditPoint={point:${J(p)},target:e?.outerHTML.slice(0,300),active:app.workspace.activeLeaf?.view?.getState(),width:innerWidth,height:innerHeight};return true;`);
  return p;
};
const click = async (expr, what, modifiers = 0) => page.click(await pos(expr, what, true), modifiers, false);
// a row's menu is a right click (a plain click on the grip selects the row)
const menuOn = async (expr, what) => page.rightClick(await pos(expr, what, true), false);
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
function toPane() { return page.eval(`const l = app.workspace.getLeavesOfType('focus-tasks-view')[0]; app.workspace.setActiveLeaf(l, { focus: true }); await app.workspace.revealLeaf(l); return true;`); }
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
  await toPane(); // an optional companion can open its own startup tab
  await until(() => page.eval(`return !!document.querySelector('.focus-tasks-pane .ft-onboarding')`), "onboarding");
  const foot = await page.eval(`return __ft.all('.ft-foot-button', __ft.view()).map((b) => b.textContent.trim())`);
  if (J(foot) !== J(["Ideas", "+ Area"])) throw new Error("footer: " + J(foot));
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

step("the grip opens the area menu; New project uses the area's view without a Projects heading", async () => {
  await click(`__ft.grip(__ft.area('Sport'))`);
  await menu("New project");
  await modalInput();
  await page.type("Marathon");
  await page.key("Enter");
  await fileHas("Tasks/Marathon.md", '---\nparents:\n  - "[[Sport]]"\narea: "💪Sport"\ntype: project\n---\n');
  await fileHas("Tasks/Sport.md", "```focus-tasks\n```\n");
  await fileLacks("Tasks/Sport.md", "## Projects");
  await fileLacks("Tasks/Sport.md", "- 📁 [[Marathon]]");
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
  await until(() => page.eval(`return __ft.task('Lace them')?.querySelector('.ft-date.is-today')?.textContent === 'today'`), "today says «today», in green, on the right");
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
  await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
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

step("the ⏳ on a project's row opens its own pile under the row; ⌘1 there brings a step into today", async () => {
  fs.writeFileSync(path.join(VAULT, taskPath("Book the hotel")),
    `---\nuid: ft-later-2\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${ymd(new Date(Date.now() + 30 * 864e5))}\nprojects:\n  - "[[Marathon]]"\n---\n`);
  await toPane();
  const wasAll = await plugin(`return p.everything()`);
  await plugin(`
    if (p.everything()) p.setEverything(false);
    if (p.isShown('future:💪Sport', true)) await p.toggleShown('future:💪Sport', true);
    p.refresh(); return true;`);
  // Marathon's row among today's work carries a ⏳ (the area's pile is closed: the step is nowhere yet)
  const row = `__ft.all('li.ft-project-row', __ft.view()).find((e) => !e.closest('.ft-future-block') && e.querySelector('.ft-link')?.textContent.trim() === 'Marathon')`;
  await until(() => page.eval(`return !!${row}?.querySelector('.ft-later-chip')`), "the ⏳ on Marathon's row");
  if (await page.eval(`return !!__ft.task('Book the hotel')`)) throw new Error("the later step is on screen before the ⏳ was opened");
  // the count is read once the new note is in the cache and on the chip (Marathon had later steps before)
  await until(() => page.eval(`const p = app.plugins.plugins['focus-tasks']; p.forgetScan(); return p.tasks().some((x) => x.uid === 'ft-later-2')`), "the new step in the cache");
  await plugin(`p.refresh(); return true;`);
  await settle();
  const behind = Number(await page.eval(`return ${row}.querySelector('.ft-later-chip').getAttr('aria-label').match(/· (\\d+)/)[1]`));
  await click(`__ft.at(${row}.querySelector('.ft-later-chip'))`, "the ⏳ of Marathon");
  await until(() => page.eval(`
    const s = __ft.task('Book the hotel');
    const pile = s?.closest('li.ft-later-steps');
    let r = pile?.previousElementSibling;
    while (r && !r.hasClass('ft-project-row')) r = r.previousElementSibling;
    return !!s && s.hasClass('is-later') && !!r && !r.closest('.ft-future-block') && r.querySelector('.ft-link')?.textContent.trim() === 'Marathon';`),
    "the later step under Marathon's row, dimmed, in the project's own pile");
  // ⌘1 on the step: it is today's now — it leaves the pile for the project's steps, and the ⏳ goes
  await click(`__ft.at(__ft.task('Book the hotel').querySelector('.ft-text'))`);
  await editing();
  await page.key("Meta+1");
  await taskIs("Book the hotel", { scheduled: TODAY });
  await until(() => page.eval(`const s = __ft.task('Book the hotel'); return !!s && !s.closest('li.ft-later-steps') && !s.hasClass('is-later')`), "the step among today's steps of Marathon");
  // the ⏳ counts one less (Plan route, left with no date earlier, is still behind it) — or goes
  await until(() => page.eval(`const n = ${row}?.querySelector('.ft-later-chip')?.getAttr('aria-label').match(/· (\\d+)/)?.[1]; return n === undefined || Number(n) === ${behind} - 1`),
    `the ⏳ says ${behind - 1} behind the row`);
  await page.key("Escape");
  await idle();
  await plugin(`
    if (p.everything() !== ${wasAll}) p.setEverything(${wasAll});
    const n = p.notes().find((x) => x.project && x.file.basename === 'Marathon');
    if (n && p.data.opened['later:' + n.file.path]) await p.toggleShown('later:' + n.file.path, true);
    p.refresh(); return true;`);
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

step("drag a row from today's list into the ⏳ pile clears its day; back among today's rows, it is today's", async () => {
  fs.writeFileSync(path.join(VAULT, taskPath("Drag me off")), `---\nuid: ft-dm-1\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\n---\n`);
  fs.writeFileSync(path.join(VAULT, taskPath("Pile anchor")), `---\nuid: ft-dm-2\ntype: задача\nstatus: open\narea: "💪Sport"\n---\n`);
  await toPane();
  const key = await plugin(`return 'future:' + (await p.collect(false)).find((a) => a.name.includes('Sport')).name;`);
  const wasOpen = await plugin(`return !!p.data.opened[${J(key)}]`);
  await plugin(`if (!p.data.opened[${J(key)}]) await p.toggleShown(${J(key)}, true); p.refresh(); return true;`);
  await until(() => page.eval(`return !!__ft.task('Pile anchor')?.closest('.ft-future-block') && !!__ft.task('Drag me off')`), "both rows on screen");
  const drag = async (from, to, what) => {
    await settle();
    const a = await pos(`__ft.grip(__ft.task(${J(from)}))`, "grip of " + from);
    const b = await pos(`(() => { const r = __ft.task(${J(to)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.8 }; })()`, what);
    await page.drag(a, b);
  };
  await drag("Drag me off", "Pile anchor", "under Pile anchor");
  await taskIs("Drag me off", { scheduled: null }, "dropped into the pile: no day");
  await until(() => page.eval(`return !!__ft.task('Drag me off')?.closest('.ft-future-block')`), "and the row is in the pile");
  const today = await until(() => page.eval(`return __ft.all('li.ft-task', __ft.view()).find((e) => !e.closest('.ft-future-block, .ft-waiting, .ft-done-today, li.ft-later-steps') && e.querySelector(':scope > .ft-text:not(.ft-no-step)'))?.querySelector(':scope > .ft-text').textContent.trim() || null`), "a row of today's list");
  await drag("Pile anchor", today, "under a row of today's list");
  await taskIs("Pile anchor", { scheduled: TODAY }, "dropped among today's rows: today");
  if (!wasOpen) await plugin(`if (p.data.opened[${J(key)}]) await p.toggleShown(${J(key)}, true); p.refresh(); return true;`);
  for (const n of ["Drag me off", "Pile anchor"]) fs.unlinkSync(path.join(VAULT, taskPath(n)));
  await settle();
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
  await menuOn(`__ft.at(__ft.task(${J(first)}))`);
  await menu("Move down");
  const at = before.indexOf(first);
  await until(async () => (await order()).indexOf(first) !== at, `${first} moved down`);
  const after = await order();
  if (after.indexOf(first) <= at) throw new Error("it did not land lower: " + J(after));
  await menuOn(`__ft.at(__ft.task(${J(first)}))`);
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
  await menuOn(`__ft.at(__ft.task('Stretch'))`);
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
    const names = [...__ft.view().querySelectorAll('.ft-rest-title:not(.ft-focus-title) ~ .ft-area > .ft-area-title')].map((e) => e.textContent);
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

step("the row shows what the note says: a robot's mark and a deadline on another day", async () => {
  await page.eval(`const f = app.vault.getAbstractFileByPath(${J(taskPath("Buy shoes fast"))});
    await app.fileManager.processFrontMatter(f, (fm) => { fm.priority = 'low'; fm.due = ${J(TOMORROW)}; }); return true;`);
  await until(() => page.eval(`return !!__ft.task('Buy shoes fast')?.querySelector('.ft-priority.is-low.ft-bot')`), "the robot's dot");
  // priority as such is not shown: a high one leaves the row clean
  await page.eval(`const f = app.vault.getAbstractFileByPath(${J(taskPath("Buy shoes fast"))});
    await app.fileManager.processFrontMatter(f, (fm) => { fm.priority = 'high'; }); return true;`);
  await until(() => page.eval(`return !__ft.task('Buy shoes fast')?.querySelector('.ft-priority')`), "no dot for a high priority");
  await until(() => page.eval(`return !!__ft.task('Buy shoes fast')?.querySelector('.ft-due')`), "the deadline badge");
  await page.eval(`const f = app.vault.getAbstractFileByPath(${J(taskPath("Buy shoes fast"))});
    await app.fileManager.processFrontMatter(f, (fm) => { delete fm.priority; delete fm.due; }); return true;`);
  await until(() => page.eval(`return !__ft.task('Buy shoes fast')?.querySelector('.ft-due')`), "the badges are gone again");
});

step("«Waiting…» sends the task off: a day, an hour typed in two segments, and it waits on the shelf with a ▷", async () => {
  const later = ymd(new Date(Date.now() + 5 * 864e5));
  fs.writeFileSync(path.join(VAULT, taskPath("Ask the lawyer")),
    `---\nuid: ft-run-1\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\n---\n`);
  await toPane();
  await until(() => page.eval(`return !!__ft.task('Ask the lawyer')`), "Ask the lawyer on screen");
  // no ▷ on a row that is not running: sending off lives in the row's menu
  if (await page.eval(`return !!__ft.task('Ask the lawyer').querySelector('.ft-running')`)) throw new Error("a row not sent off carries a ▷");
  await menuOn(`__ft.at(__ft.task('Ask the lawyer'))`);
  await menu("Waiting…");
  await until(() => page.eval(`return !!document.querySelector('.ft-picker .ft-picker-caption')`), "the «look at it again» card");
  const card = JSON.parse(await page.eval(`
    const p = document.querySelector('.ft-picker');
    return JSON.stringify({ date: p.querySelector('.ft-picker-input').value,
      focused: document.activeElement?.className || '', parts: p.querySelectorAll('.ft-picker-part').length });`));
  if (card.date !== ddmmyy(TODAY)) throw new Error(`the day is not today by default: ${J(card.date)}`);
  if (!/is-hh/.test(card.focused)) throw new Error(`the caret does not start in the hour: ${J(card.focused)}`);
  if (card.parts !== 2) throw new Error("the hour is not two segments");
  // Always use a future day: a late-night run must not send Waiting into the past.
  await page.eval(`document.querySelector('.ft-picker-input').value=${J(ddmmyy(TOMORROW))};return true;`);
  // two digits and the caret moves on by itself; two more and Tab is the end of it
  await page.type("23");
  await until(() => page.eval(`return /is-mm/.test(document.activeElement?.className || '')`), "the caret moved to the minutes");
  await page.type("56");
  await page.key("Tab");
  await taskIs("Ask the lawyer", { status: "waiting", scheduled: `${TOMORROW}T23:56` }, "the moment is written in one change");
  // sent off, the row is on the shelf at the bottom — opened, so its date can be clicked
  await plugin(`if (!p.waitingShown()) p.setWaitingShown(true); return true;`);
  await until(() => page.eval(`return !!__ft.task('Ask the lawyer')?.closest('.ft-waiting')`), "the row on the shelf");
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
  await click(`__ft.at(__ft.view().querySelector('.ft-rest-title:not(.ft-focus-title)') || __ft.view().querySelector('.ft-done-today .ft-empty'))`, "somewhere outside the card");
  await until(() => page.eval(`return !document.querySelector('.ft-picker')`), "the card closed");
  await taskIs("Ask the lawyer", { scheduled: `${TOMORROW}T07:30` }, "what stood in the fields was kept");
  // out of today's work, and not in the pile of what is not today either: on the shelf at the bottom
  await until(() => page.eval(`
    const r = __ft.task('Ask the lawyer');
    return !r || !!r.closest('.ft-waiting');`), "the row left today's work");
  const key = await plugin(`return 'future:' + (await p.collect(false)).find((a) => a.name.includes('Sport')).name;`);
  await plugin(`if (!p.data.opened[${J(key)}]) await p.toggleShown(${J(key)}, true); p.refresh(); return true;`);
  await settle();
  if (await page.eval(`return !!__ft.task('Ask the lawyer')?.closest('.ft-future-block')`)) throw new Error("a waiting task is listed with the upcoming work");
  if (await page.eval(`return /running|запущен|waiting|жду/i.test(__ft.area('Sport')?.querySelector('.ft-later-chip')?.getAttribute('aria-label') || '')`))
    throw new Error("the area's ⏳ still counts what is in other hands");
  // «▷ Waiting · 1» at the bottom: the row is on the shelf, marked, with the day to look again
  await until(() => page.eval(`return /· 1/.test(__ft.view()?.querySelector('.ft-waiting-toggle')?.textContent || '')`), "the foot button counts it");
  await until(() => page.eval(`
    const r = __ft.task('Ask the lawyer');
    return !!r && !!r.closest('.ft-waiting') && !!r.querySelector('.ft-running') && !r.hasClass('is-waiting');`),
    "on the shelf, marked ▷, not greyed out");
  const label = await page.eval(`return __ft.task('Ask the lawyer').querySelector('.ft-date')?.textContent || ''`);
  if (!/^(by|до) /.test(label)) throw new Error(`the date on the shelf does not say by when: ${J(label)}`);
  // its date is a moment to come back, not a deadline: never painted as today's work
  const painted = await page.eval(`
    const d = __ft.task('Ask the lawyer').querySelector('.ft-date');
    return d.className + " | " + getComputedStyle(d).color;`);
  if (/is-today|is-past/.test(painted)) throw new Error(`the return moment is painted like a due date: ${J(painted)}`);
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
    await p.setWaiting(task, true, ${J(TODAY)}, '00:00'); p.refresh(); return true;`);
  await until(() => page.eval(`
    const r = __ft.task('Ask the lawyer');
    return !!r && !r.closest('.ft-future-block') && !!r.querySelector('.ft-running');`),
    "its moment came: back among the rows, still marked as running");
  await click(`__ft.at(__ft.task('Ask the lawyer').querySelector('.ft-running'))`, "the ▷ on the row");
  await taskIs("Ask the lawyer", { status: "open", scheduled: TODAY }, "the row's ▷ hands it back, into today's focus");
  await settle();
  await until(() => page.eval(`return !/· \\d/.test(__ft.view().querySelector('.ft-waiting-toggle')?.textContent || '')`), "nothing on the shelf: the button has no count");
  await plugin(`if (p.waitingShown()) p.setWaitingShown(false); return true;`);
  fs.unlinkSync(path.join(VAULT, taskPath("Ask the lawyer")));
  await settle();
});

step("the dot a robot leaves can be taken off from the row itself", async () => {
  fs.writeFileSync(path.join(VAULT, taskPath("Added by a script")),
    `---\nuid: ft-prio-1\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\npriority: low\n---\n`);
  await until(() => page.eval(`return !!__ft.task('Added by a script')?.querySelector('.ft-priority.is-low.ft-bot')`), "the robot's dot is on the row");
  await click(`__ft.at(__ft.task('Added by a script').querySelector('.ft-priority'))`, "the dot");
  await taskIs("Added by a script", { priority: null }, "one click takes the mark off");
  await until(() => page.eval(`return !__ft.task('Added by a script')?.querySelector('.ft-priority')`), "and the dot is gone");
  // no other priority is shown or offered: a high one is just a task
  fs.writeFileSync(path.join(VAULT, taskPath("Added by a script")),
    `---\nuid: ft-prio-1\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\npriority: high\n---\n`);
  await settle();
  await until(() => page.eval(`return !!__ft.task('Added by a script') && !__ft.task('Added by a script').querySelector('.ft-priority')`), "no dot for a high priority");
  await menuOn(`__ft.at(__ft.task('Added by a script'))`);
  const offered = await page.eval(`return [...document.querySelectorAll('.menu .menu-item-title')].map((e) => e.textContent.trim())`);
  await page.key("Escape");
  if (offered.some((x) => /priority|приоритет/i.test(x))) throw new Error("the menu still offers priorities: " + J(offered));
  // the mark comes off from the menu too
  fs.writeFileSync(path.join(VAULT, taskPath("Added by a script")),
    `---\nuid: ft-prio-1\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\npriority: low\n---\n`);
  await until(() => page.eval(`return !!__ft.task('Added by a script')?.querySelector('.ft-priority.ft-bot')`), "the robot's dot again");
  await menuOn(`__ft.at(__ft.task('Added by a script'))`);
  await menu("Take the robot's mark off");
  await taskIs("Added by a script", { priority: null }, "the menu took it off");
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
  await menuOn(`__ft.at(__ft.task('Plan the season'))`);
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
  await menuOn(`__ft.at(__ft.name('Plan the season'))`);
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
  await menuOn(`__ft.at(__ft.name('Cleanup'))`);
  await menu("Project done");
  await until(() => (read("Tasks/Cleanup.md") || "").includes("status: done"), "the project note says done");
  await until(() => page.eval(`const r = __ft.project('Cleanup'); return !!r && !!r.closest('.ft-done-today')`), "the project is in the closed block");
  if (await page.eval(`return __ft.all('li.ft-project-row', __ft.view()).filter((e) => e.querySelector('.ft-link')?.textContent.trim() === 'Cleanup').some((e) => !e.closest('.ft-done-today'))`))
    throw new Error("a closed project still has a row in the list");
  await click(`__ft.at(__ft.project('Cleanup').querySelector('input'))`);
  await until(() => !(read("Tasks/Cleanup.md") || "").includes("status: done"), "the box in the closed block reopened it");
  await until(() => page.eval(`const r = __ft.project('Cleanup'); return !!r && !r.closest('.ft-done-today')`), "and it is back in the list");
});

step("rename a project in place; its tasks and legacy area links follow it", async () => {
  await page.eval(`const file=app.vault.getAbstractFileByPath('Tasks/Sport.md');await app.vault.process(file,body=>body.replace('\\x60\\x60\\x60focus-tasks','- 📁 [[Marathon]]\\n\\n\\x60\\x60\\x60focus-tasks'));return true;`);
  await menuOn(`__ft.at(__ft.name('Marathon'))`);
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
  await menuOn(`__ft.at(__ft.name('Marathon 2027'))`);
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
  await menuOn(`__ft.at(__ft.name('Marathon 2027'))`);
  await menu("Open task file");
  await until(async () => (await activePath()) === "Tasks/Marathon 2027.md", "the project note open");
  // the notes this step opened are closed again: a project's note carries its own steps block, and
  // left open behind the pane it takes the front back whenever the window is raised
  await page.eval(`for (const l of app.workspace.getLeavesOfType('markdown')) if (['Tasks/Marathon 2027.md', 'Notes/Running log.md'].includes(l.view.file?.path)) l.detach(); return true;`);
  await toPane();
});

step("Area from a note makes the note itself the area (outside the folder too); Project from a note", async () => {
  await toPane();   // the last step left a project's note in front — with its own steps block
  const before = read("Notes/Home.md");
  await page.eval(`app.plugins.plugins['focus-tasks'].areaFromNote(); return true;`);
  await modalInput(".prompt-input");
  await page.type("Notes/Home");
  await sleep(200);
  await page.key("Enter");
  await modalInput();
  await page.key("Enter");
  await fileHas("Notes/Home.md", /area: "?Home"?\ntype: area/, "the note itself says it is the area");
  if (!read("Notes/Home.md").includes(before.replace(/^---[\s\S]*?---\n/, "").trim())) throw new Error("the note's text changed");
  if (exists("Tasks/Home.md")) throw new Error("a second note was made for the area");
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
  await menuOn(`__ft.at(__ft.task('Run 5k'))`);
  await until(() => page.eval(`return !!__ft.text('.menu .menu-item-title', 'Selected: ' + ${three.length})`), "the selection menu");
  await menu("Tomorrow");
  for (const name of three) await taskIs(name, { scheduled: TOMORROW });
  await selectedAre([]);
});

step("the grip of a selected row drags them all; ⌘1–4 date them all", async () => {
  const pick = async (from, to) => {
    // a note tab left open by an earlier step takes the front back whenever the window is raised,
    // and the clicks land in it: the pane is the only tab here
    await page.eval(`for (const l of app.workspace.getLeavesOfType('markdown')) l.detach(); return true;`);
    await toPane();
    await until(() => page.eval(`return !!__ft.task(${J(from)}) && !!__ft.task(${J(to)})`), `${from} … ${to} on screen`);
    await page.key("Escape");   // nothing selected from before: the grip below starts afresh
    await settle();
    await click(`__ft.grip(__ft.task(${J(from)}))`, "grip of " + from);
    await selectedAre([from]);
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
  await page.eval(`let l = app.workspace.getLeavesOfType('markdown')[0];
    if (!l) {
      // a plain note: one with a steps block (the linked «Running log» got one) would be a list too
      const f = app.vault.getAbstractFileByPath('Notes/Plain.md') || await app.vault.create('Notes/Plain.md', 'Just a note.');
      l = app.workspace.getLeaf('tab'); await l.openFile(f);
    }
    app.workspace.setActiveLeaf(l, { focus: true }); return true;`);
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
  await menuOn(`__ft.at(__ft.task(${J(name)}))`);
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
  // the command does the same as the key
  await toPane();
  await menuOn(`__ft.at(__ft.task(${J(name)}))`);
  await menu("Tomorrow");
  await taskIs(name, { scheduled: TOMORROW });
  await idle();
  await toPane();
  await page.eval(`await app.commands.executeCommandById('focus-tasks:undo'); return true;`);
  await taskIs(name, { scheduled: was.scheduled ?? null }, "the Undo command took the date back");
  await idle();
  await selectedAre([name]);   // the row it brought back is selected — a beat later, once the cache has it
  await page.key("Escape");
  await selectedAre([]);
});

step("the grip selects the row; ↑/↓ walk, Shift extends, Enter edits, Esc saves and reselects", async () => {
  await toPane();
  await idle();
  await page.key("Escape");
  await selectedAre([]);
  await settle();
  // three rows in a row on screen (a project's row counts: its step is what gets selected)
  const names = await page.eval(`return __ft.all('li.ft-task', __ft.view()).map((e) => e.querySelector(':scope > .ft-text:not(.ft-no-step)')?.textContent.trim()).filter(Boolean).slice(0, 3)`);
  if (names.length < 3) throw new Error("need three rows on screen: " + J(names));
  const [a, b, c] = names;
  await click(`__ft.grip(__ft.task(${J(a)}))`);
  await selectedAre([a]);
  if (await page.eval(`return !!document.querySelector('.menu')`)) throw new Error("a plain click on the grip opened the menu");
  await click(`__ft.grip(__ft.task(${J(a)}))`);
  await selectedAre([]);   // the same grip again drops it
  await click(`__ft.grip(__ft.task(${J(a)}))`);
  await selectedAre([a]);
  await page.key("ArrowDown");
  await selectedAre([b]);
  await page.key("Shift+ArrowDown");
  await selectedAre([b, c]);
  await page.key("ArrowUp");
  await selectedAre([b]);
  await page.key("Enter");
  await editing();
  const who = await page.eval(`return document.querySelector('.focus-tasks-view .is-editing')?.textContent.trim()`);
  if (who !== b) throw new Error(`Enter edits the row under the cursor: expected «${b}», editing «${who}»`);
  await page.eval(`__ft.caretToEnd()`);
  await page.type(" x");
  await page.key("Escape");
  await idle();
  await until(() => exists(taskPath(b + " x")), "Esc saved the text");
  await selectedAre([b + " x"]);
  await page.key("Escape");
  await selectedAre([]);
  // Esc on a wiped row is not a delete: the text comes back, the row is selected
  await click(`__ft.at(__ft.task(${J(b + " x")}).querySelector('.ft-text'))`);
  await editing();
  await page.eval(`__ft.selectAll()`);
  await page.key("Backspace");
  await page.key("Escape");
  await idle();
  await selectedAre([b + " x"]);
  if (!exists(taskPath(b + " x"))) throw new Error("Esc on a wiped row deleted the task");
  await page.key("Escape");
  await selectedAre([]);
  // with nothing selected ⌘1–5 and Esc are the app's: the pane hands them on (⌘2 = go to tab 2)
  const handed = await page.eval(`
    const r = app.workspace.getLeavesOfType('focus-tasks-view').find((l) => l.containerEl.contains(__ft.view()))?.view.renderer;
    if (!r?.scope) return "no scope";
    const seen = [];
    const own = app.scope.handleKey;
    app.scope.handleKey = function (ev, ctx) { seen.push(ctx.key); return false; };
    try {
      for (const key of ["1", "2", "5", "Escape"]) r.scope.handleKey(new KeyboardEvent("keydown", { key, metaKey: key !== "Escape" }), { modifiers: key === "Escape" ? "" : "Meta", key, vkey: key });
    } finally { app.scope.handleKey = own; }
    return seen.join(",")`);
  if (handed !== "1,2,5,Escape") throw new Error("keys with nothing selected must reach the app, got " + handed);
});

step("⌘2 in the editor sends the row away; ⌘Z brings it back, selected", async () => {
  await toPane();
  await settle();
  const name = await until(() => page.eval(`return __ft.all('li.ft-task:not(.ft-project-row)', __ft.view()).filter((e) => !e.closest('.ft-future-block, .is-rest'))[0]?.querySelector('.ft-text')?.textContent.trim() || null`), "a row of today's list");
  const was = fm(name);
  await click(`__ft.at(__ft.task(${J(name)}).querySelector('.ft-text'))`);
  await editing();
  await page.key("Meta+2");
  await taskIs(name, { scheduled: TOMORROW });
  await until(() => page.eval(`const r = __ft.task(${J(name)}); return !r || !!r.closest('.ft-future-block')`), "the row left today's list");
  // the editor is on the next row now: ⌘Z there, with nothing typed, is the list's undo
  await page.key("Meta+z");
  await taskIs(name, { scheduled: was.scheduled ?? null }, "⌘Z from the next row's editor took the date back");
  await idle();
  await selectedAre([name]);
  await page.key("Escape");
  await selectedAre([]);
  // typed and erased again is still typed: ⌘Z stays with the editor, the list's history is not touched
  await click(`__ft.at(__ft.task(${J(name)}).querySelector('.ft-text'))`);
  await editing();
  await page.eval(`__ft.caretToEnd()`);
  await page.type("x");
  await page.key("Backspace");
  const steps = await plugin(`return (p.history || []).length`);
  await page.key("Meta+z");
  await sleep(300);
  if (!(await page.eval(`return !!document.querySelector('.focus-tasks-view .is-editing')`))) throw new Error("⌘Z after typing closed the editor");
  if ((await plugin(`return (p.history || []).length`)) !== steps) throw new Error("⌘Z after typing ran the list's undo");
  await page.key("Escape");
  await idle();
  await page.key("Escape");
  await selectedAre([]);
});

step("a [[link]] in a task's text opens its note from the pane, in a tab of its own", async () => {
  await page.eval(`if (!app.vault.getAbstractFileByPath('Notes/Linked.md')) { if (!app.vault.getAbstractFileByPath('Notes')) await app.vault.createFolder('Notes'); await app.vault.create('Notes/Linked.md', 'Linked note.'); } return true;`);
  await plugin(`await p.createTask('Read [[Linked]] today', { area: '💪Sport', project: null }, ${J(TODAY)}); return true;`);
  await toPane();
  await until(() => page.eval(`return !!__ft.all('li.ft-task a.internal-link', __ft.view()).find((a) => a.textContent === 'Linked')`), "the link on screen");
  await settle();
  await click(`__ft.at(__ft.all('li.ft-task a.internal-link', __ft.view()).find((a) => a.textContent === 'Linked'))`, "the link");
  await until(async () => (await activePath()) === "Notes/Linked.md", "the linked note opened");
  if (await page.eval(`return !!document.querySelector('.focus-tasks-view .is-editing')`)) throw new Error("a click on the link started an edit");
  if (!(await page.eval(`return app.workspace.getLeavesOfType('focus-tasks-view').length`))) throw new Error("the note opened over the pane");
  await page.eval(`for (const l of app.workspace.getLeavesOfType('markdown')) if (l.view.file?.path === 'Notes/Linked.md') l.detach(); return true;`);
});

step("⌘D inserts above the selected or edited task and immediately edits the copy; ⌘Z removes the copy", async () => {
  await plugin(`await p.createTask('Twin me', { area: '💪Sport', project: null }, ${J(TODAY)}); return true;`);
  await toPane();
  await until(() => page.eval(`return !!__ft.task('Twin me')`), "the row on screen");
  await settle();
  await click(`__ft.grip(__ft.task('Twin me'))`);
  await selectedAre(["Twin me"]);
  await page.key("Meta+d");
  await until(() => exists(taskPath("Twin me (2)")), "the copy's note");
  const one = fm("Twin me"), two = fm("Twin me (2)");
  if (!two.uid || two.uid === one.uid) throw new Error("the copy needs a uid of its own: " + J([one.uid, two.uid]));
  if (two.title !== "Twin me" || two.scheduled !== one.scheduled || two.area !== one.area) throw new Error("the copy is not the same task: " + J(two));
  await until(() => page.eval(`const e = document.querySelector('.focus-tasks-view .is-editing'), v = [...app.plugins.plugins['focus-tasks'].views].find(x => e && x.containerEl.contains(e)), li = e?.closest('li'); return v?.items.get(li)?.task?.uid === ${J(two.uid)} && v.items.get(li.nextElementSibling)?.task?.uid === ${J(one.uid)} && document.activeElement === e`), "the copy above the source has the editor and keyboard focus");
  await page.key("Meta+z");
  await until(() => !exists(taskPath("Twin me (2)")), "⌘Z took the copy back");
  await idle();
  await page.key("Escape");
  await selectedAre([]);
  // in the editor: the text is saved, the copy comes, the editor is in the copy
  await click(`__ft.at(__ft.task('Twin me').querySelector('.ft-text'))`);
  await editing();
  await page.key("Meta+d");
  await until(() => exists(taskPath("Twin me (2)")), "the copy from the editor");
  const editorCopy = fm("Twin me (2)").uid;
  await until(() => page.eval(`const e = document.querySelector('.focus-tasks-view .is-editing'), v = [...app.plugins.plugins['focus-tasks'].views].find(x => e && x.containerEl.contains(e)), li = e?.closest('li'); return v?.items.get(li)?.task?.uid === ${J(editorCopy)} && v.items.get(li.nextElementSibling)?.task?.uid === ${J(one.uid)} && document.activeElement === e`), "the editor moved into the copy above the original");
  await page.eval(`__ft.selectAll(); return true;`);
  await page.type("Renamed twin copy");
  await page.key("Tab");
  await until(() => exists(taskPath("Renamed twin copy")), "typing changes the copied note");
  if (fm("Renamed twin copy").uid !== editorCopy || fm("Twin me").uid !== one.uid) throw new Error("copy edit changed the source identity");
  if (fm("Twin me").title) throw new Error("copy edit renamed the source");
  await idle();
  await page.key("Escape");
  await selectedAre([]);
});

step("⌘D copies a selection above each source, edits the first copy and undoes the whole group", async () => {
  await plugin(`for (const name of ['Dup group A', 'Dup group B']) await p.createTask(name, { area: '💪Sport', project: null }, ${J(TODAY)}); return true;`);
  await toPane();
  await until(() => page.eval(`return !!__ft.task('Dup group A') && !!__ft.task('Dup group B')`), "group sources on screen");
  await click(`__ft.at(__ft.task('Dup group A').querySelector('.ft-text'))`, "first source", CMD);
  await click(`__ft.at(__ft.task('Dup group B').querySelector('.ft-text'))`, "second source", CMD);
  await selectedAre(['Dup group A', 'Dup group B']);
  await page.key('Meta+d');
  await until(() => exists(taskPath('Dup group A (2)')) && exists(taskPath('Dup group B (2)')), "both copied notes");
  const sourceA = fm('Dup group A').uid, sourceB = fm('Dup group B').uid;
  const copyA = fm('Dup group A (2)').uid, copyB = fm('Dup group B (2)').uid;
  await until(() => page.eval(`
    const rows = __ft.all('li.ft-task', __ft.view()), v = [...app.plugins.plugins['focus-tasks'].views].find(x => x.containerEl === __ft.view()), uid = x => v?.items.get(x)?.task?.uid;
    const a = rows.find(x => uid(x) === ${J(copyA)}), b = rows.find(x => uid(x) === ${J(copyB)});
    const editor = a?.querySelector('.is-editing');
    return !!editor && document.activeElement === editor && uid(a.nextElementSibling) === ${J(sourceA)} && uid(b?.nextElementSibling) === ${J(sourceB)};
  `), "copies sit above both sources and the first copy is editing");
  await page.key('Meta+z');
  await until(() => !exists(taskPath('Dup group A (2)')) && !exists(taskPath('Dup group B (2)')), "one Undo removes all copies");
  if (!exists(taskPath('Dup group A')) || !exists(taskPath('Dup group B'))) throw new Error('Undo removed an original');
  await idle();
  await page.key('Escape');
  await selectedAre([]);
});

step("⌘D on a compact project step inserts the new first step and edits that copy", async () => {
  await plugin(`const area = (await p.collect(true)).find(a => a.name === '💪Sport'); await p.createProject(area, 'Dup compact project'); await p.createTask('Dup compact step', { area: '💪Sport', project: 'Dup compact project' }, ${J(TODAY)}); return true;`);
  await toPane();
  await until(() => page.eval(`return !!__ft.project('Dup compact project')?.querySelector('.ft-text')`), "compact project step");
  await click(`__ft.at(__ft.project('Dup compact project').querySelector('.ft-text'))`);
  await editing();
  await page.key('Meta+d');
  await until(() => exists(taskPath('Dup compact step (2)')), "copied step note");
  const source = fm('Dup compact step').uid, copy = fm('Dup compact step (2)').uid;
  await until(() => page.eval(`const row = __ft.project('Dup compact project'), e = row?.querySelector('.is-editing'), p = app.plugins.plugins['focus-tasks'], v = [...p.views].find(x => e && x.containerEl.contains(e)); const order = p.data.order.tasks['project:Dup compact project']; return v?.items.get(row)?.task?.uid === ${J(copy)} && document.activeElement === e && order?.[0] === ${J(copy)} && order?.[1] === ${J(source)};`), "copy becomes the visible first step with editing focus");
  await page.key('Meta+z');
  await until(() => !exists(taskPath('Dup compact step (2)')), "Undo removes only the copied step");
  if (fm('Dup compact step').uid !== source) throw new Error('source step identity changed');
  await idle();
  await page.key('Escape');
  await selectedAre([]);
});

step("⌘D from Waiting reveals the open copy when its new future shelf is hidden", async () => {
  await plugin(`const task = await p.createTask('Dup waiting task', { area: '💪Sport', project: null }, ${J(TOMORROW)}); await p.setFields(task, { status: 'waiting' }); app.saveLocalStorage('focus-tasks-all', null); app.saveLocalStorage('focus-tasks-waiting', '1'); delete p.data.opened['future:💪Sport']; delete p.data.opened['futureoff:💪Sport']; p.saveFolds(); p.refresh(); return true;`);
  await toPane();
  await until(() => page.eval(`return !!__ft.task('Dup waiting task')?.closest('.ft-waiting')`), "source task on Waiting shelf");
  await click(`__ft.at(__ft.task('Dup waiting task').querySelector('.ft-text'))`);
  await editing();
  await page.key('Meta+d');
  await until(() => exists(taskPath('Dup waiting task (2)')), "Waiting copy note");
  const copy = fm('Dup waiting task (2)'), source = fm('Dup waiting task');
  if (copy.status !== 'open' || source.status !== 'waiting' || copy.uid === source.uid) throw new Error('copy altered the Waiting source');
  await until(() => page.eval(`const e = document.querySelector('.focus-tasks-view .is-editing'), v = [...app.plugins.plugins['focus-tasks'].views].find(x => e && x.containerEl.contains(e)), row = e?.closest('li'); return v?.items.get(row)?.task?.uid === ${J(copy.uid)} && !!row.closest('.ft-future-block') && document.activeElement === e;`), "future copy is visible and editing");
  await page.key('Meta+z');
  await until(() => !exists(taskPath('Dup waiting task (2)')), "Undo removes only the open copy");
  if (fm('Dup waiting task').status !== 'waiting') throw new Error('Undo changed Waiting source');
  await idle();
  await page.key('Escape');
  await plugin(`app.saveLocalStorage('focus-tasks-all','1'); p.refresh(); return true;`);
});

step("⌫ on a selected project's row deletes the project and all its tasks; Undo brings them back", async () => {
  await plugin(`
    const sport = (await p.collect(true)).find((a) => a.name === '💪Sport');
    await p.createProject(sport, 'Doomed');
    await p.createTask('Doomed one', { area: '💪Sport', project: 'Doomed' }, ${J(TODAY)});
    await p.createTask('Doomed two', { area: '💪Sport', project: 'Doomed' }, null);
    return true;`);
  await toPane();
  await until(() => page.eval(`return !!__ft.project('Doomed')`), "Doomed on screen");
  await settle();
  await click(`__ft.grip(__ft.project('Doomed'))`);
  await until(() => page.eval(`return !!__ft.project('Doomed')?.classList.contains('is-selected')`), "the project's row selected");
  await page.key("Backspace");
  await until(() => !exists("Tasks/Doomed.md") && !exists(taskPath("Doomed one")) && !exists(taskPath("Doomed two")), "the project and both tasks are gone");
  await click(`__ft.at(document.querySelector('.notice .ft-undo'))`, "Undo");
  await until(() => exists("Tasks/Doomed.md") && exists(taskPath("Doomed one")) && exists(taskPath("Doomed two")), "all three are back");
  await plugin(`for (const n of ['Doomed one', 'Doomed two']) { const t = p.tasks().find((x) => x.text === n); if (t) await p.trash(t.file); } const f = app.vault.getAbstractFileByPath('Tasks/Doomed.md'); if (f) await p.trash(f); return true;`);
  await settle();
});

step("⌫ on a selection deletes the rows; Undo brings them back", async () => {
  await toPane();
  await settle();
  const names = await page.eval(`return __ft.all('li.ft-task:not(.ft-project-row)', __ft.view()).slice(0, 2).map((e) => e.querySelector('.ft-text').textContent.trim())`);
  if (names.length < 2) throw new Error("need two plain rows: " + J(names));
  await click(`__ft.grip(__ft.task(${J(names[0])}))`);
  await selectedAre([names[0]]);
  await click(`__ft.at(__ft.task(${J(names[1])}))`, "the second row", SHIFT);
  await selectedAre(names);
  await page.key("Backspace");
  for (const name of names) await noTask(name);
  await selectedAre([]);
  await click(`__ft.at(document.querySelector('.notice .ft-undo'))`, "Undo");
  for (const name of names) await until(() => exists(taskPath(name)), `${name} is back`);
  await idle();
});

step("a step on the «Waiting» shelf names its project", async () => {
  await plugin(`
    const made = await p.createTask('Shelf step', { area: '💪Sport', project: 'Marathon 2027' }, null);
    let t = null;
    for (let i = 0; i < 50 && !t; i++) { p.forgetScan(); t = p.tasks().find((x) => x.uid === made.uid); if (!t) await new Promise((r) => setTimeout(r, 50)); }
    await p.setWaiting(t, true, ${J(TOMORROW)});
    if (!p.waitingShown()) p.setWaitingShown(true);
    p.refresh(); return true;`);
  await toPane();
  await until(() => page.eval(`const r = __ft.task('Shelf step'); return !!r?.closest('.ft-waiting') && /Marathon 2027/.test(r.textContent)`), "the shelf row says «Marathon 2027»");
  // Enter while editing a shelf row saves it and opens no new row there
  await click(`__ft.at(__ft.task('Shelf step').querySelector('.ft-text'))`);
  await editing();
  await page.key("Enter");
  await idle();
  if (await page.eval(`return !!document.querySelector('.ft-waiting .ft-draft-row, .ft-waiting .ft-draft')`)) throw new Error("Enter on the shelf opened a new row");
  await plugin(`const t = p.tasks().find((x) => x.text === 'Shelf step'); if (t) await p.trash(t.file); p.setWaitingShown(false); return true;`);
  await settle();
});

step("«Waiting…» on a selection sends every selected row off with one moment", async () => {
  for (const [name, uid] of [["Call the bank", "ft-run-a"], ["Call the school", "ft-run-b"]])
    fs.writeFileSync(path.join(VAULT, taskPath(name)), `---\nuid: ${uid}\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\n---\n`);
  await toPane();
  for (const name of ["Call the bank", "Call the school"]) await until(() => page.eval(`return !!__ft.task(${J(name)})`), `${name} on screen`);
  await settle();
  await click(`__ft.grip(__ft.task('Call the bank'))`);
  await selectedAre(["Call the bank"]);
  await click(`__ft.at(__ft.task('Call the school'))`, "the second row", CMD);
  await selectedAre(["Call the bank", "Call the school"]);
  await menuOn(`__ft.at(__ft.task('Call the bank'))`);
  await menu("Waiting…");
  await until(() => page.eval(`return !!document.querySelector('.ft-picker .ft-picker-caption') && /is-hh/.test(document.activeElement?.className || '')`), "the «look at it again» card, caret in the hour");
  await page.type("23");
  await until(() => page.eval(`return /is-mm/.test(document.activeElement?.className || '')`), "the caret moved to the minutes");
  await page.type("56");
  await page.key("Tab");
  for (const name of ["Call the bank", "Call the school"]) await taskIs(name, { status: "waiting", scheduled: `${TODAY}T23:56` }, "both sent off with the one moment");
  await idle();
  await selectedAre([]);
  for (const name of ["Call the bank", "Call the school"]) fs.unlinkSync(path.join(VAULT, taskPath(name)));
  await settle();
});

step("⌘5 hands a task off: from the editor, and for a selection", async () => {
  for (const [name, uid] of [["Call the vet", "ft-vet"], ["Call the bank", "ft-run-a"], ["Call the school", "ft-run-b"]])
    fs.writeFileSync(path.join(VAULT, taskPath(name)), `---\nuid: ${uid}\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\n---\n`);
  await toPane();
  for (const name of ["Call the vet", "Call the bank", "Call the school"]) await until(() => page.eval(`return !!__ft.task(${J(name)})`), `${name} on screen`);
  await settle();
  // in the editor: ⌘5 saves the text, closes it and opens the card
  await click(`__ft.at(__ft.task('Call the vet').querySelector('.ft-text'))`);
  await editing();
  await page.key("Meta+5");
  await until(() => page.eval(`return !!document.querySelector('.ft-picker .ft-picker-caption') && /is-hh/.test(document.activeElement?.className || '')`), "the «look at it again» card from ⌘5");
  await page.type("23");
  await until(() => page.eval(`return /is-mm/.test(document.activeElement?.className || '')`), "the caret moved to the minutes");
  await page.type("59");
  await page.key("Tab");
  await taskIs("Call the vet", { status: "waiting", scheduled: `${TODAY}T23:59` }, "sent off from the editor");
  await idle();
  // for a selection: every selected row
  await click(`__ft.grip(__ft.task('Call the bank'))`);
  await selectedAre(["Call the bank"]);
  await click(`__ft.at(__ft.task('Call the school'))`, "the second row", CMD);
  await selectedAre(["Call the bank", "Call the school"]);
  await page.key("Meta+5");
  await until(() => page.eval(`return !!document.querySelector('.ft-picker .ft-picker-caption') && /is-hh/.test(document.activeElement?.className || '')`), "the card for the selection");
  await page.type("23");
  await until(() => page.eval(`return /is-mm/.test(document.activeElement?.className || '')`), "the caret moved to the minutes");
  await page.type("58");
  await page.key("Tab");
  for (const name of ["Call the bank", "Call the school"]) await taskIs(name, { status: "waiting", scheduled: `${TODAY}T23:58` }, "both sent off by ⌘5");
  await idle();
  await selectedAre([]);
  for (const name of ["Call the vet", "Call the bank", "Call the school"]) fs.unlinkSync(path.join(VAULT, taskPath(name)));
  await settle();
});

step("a row selected in the ⏳ pile takes ⌘1: today's date, and it moves into the focus", async () => {
  fs.writeFileSync(path.join(VAULT, taskPath("Pile task")), `---\nuid: ft-pile-1\ntype: задача\nstatus: open\narea: "💪Sport"\n---\n`);
  await toPane();
  const key = await plugin(`return 'future:' + (await p.collect(false)).find((a) => a.name.includes('Sport')).name;`);
  const wasOpen = await plugin(`return !!p.data.opened[${J(key)}]`);
  await plugin(`if (!p.data.opened[${J(key)}]) await p.toggleShown(${J(key)}, true); p.refresh(); return true;`);
  await until(() => page.eval(`return !!__ft.task('Pile task')?.closest('.ft-future-block')`), "Pile task in the pile");
  await settle();
  await click(`__ft.grip(__ft.task('Pile task'))`);
  await selectedAre(["Pile task"]);
  await page.key("Meta+1");
  await taskIs("Pile task", { scheduled: TODAY }, "⌘1 on a selected pile row dates it today");
  await until(() => page.eval(`const r = __ft.task('Pile task'); return !!r && !r.closest('.ft-future-block')`), "and the row is among today's rows");
  await selectedAre([]);
  if (!wasOpen) await plugin(`if (p.data.opened[${J(key)}]) await p.toggleShown(${J(key)}, true); p.refresh(); return true;`);
  fs.unlinkSync(path.join(VAULT, taskPath("Pile task")));
  await settle();
});

step("a project's row selected by its grip is the project: ⌘2 dates the project, not its step; open, it is selected too", async () => {
  await plugin(`
    const sport = (await p.collect(true)).find((a) => a.name === '💪Sport');
    await p.createProject(sport, 'Dated project');
    await p.createTask('Dated step', { area: '💪Sport', project: 'Dated project' }, ${J(TODAY)});
    await p.createTask('Dated step 2', { area: '💪Sport', project: 'Dated project' }, ${J(TODAY)});
    await p.createTask('Dated later', { area: '💪Sport', project: 'Dated project' }, null);
    return true;`);
  await toPane();
  await until(() => page.eval(`const r = __ft.project('Dated project'); return !!r && !r.closest('.ft-future-block')`), "Dated project in the focus");
  await settle();
  await click(`__ft.grip(__ft.project('Dated project'))`);
  await until(() => page.eval(`return !!__ft.project('Dated project')?.classList.contains('is-selected')`), "the project's row is selected");
  await page.key("Meta+2");
  await fileHas("Tasks/Dated project.md", `scheduled: ${TOMORROW}`, "the project's note got tomorrow");
  await taskIs("Dated step", { scheduled: TODAY }, "the step's own day is untouched");
  await until(() => page.eval(`return !!__ft.project('Dated project')?.closest('.ft-future-block')`), "dated ahead, the project waits in the pile — whatever its step says");
  await until(() => page.eval(`return !!__ft.project('Dated project')?.querySelector('.ft-date.is-project')`), "the row shows the project's own day");
  // the menu takes the day off: back by the steps' rule
  await menuOn(`__ft.at(__ft.name('Dated project'))`);
  await menu("No project date");
  await fileLacks("Tasks/Dated project.md", "scheduled:", "the day is gone from the note");
  await until(() => page.eval(`const r = __ft.project('Dated project'); return !!r && !r.closest('.ft-future-block')`), "back in the focus by its step");
  // open (steps unfolded), the row has no step: the grip still selects the project, not a menu
  await openSteps("Dated project");
  await until(() => page.eval(`return !!__ft.project('Dated project')?.classList.contains('is-open')`), "the steps are open");
  await click(`__ft.grip(__ft.project('Dated project'))`);
  await until(() => page.eval(`return !!__ft.project('Dated project')?.classList.contains('is-selected')`), "the open row is selected");
  if (await page.eval(`return !!document.querySelector('.menu')`)) throw new Error("the grip of an open project row opened the menu");
  await page.key("Escape");
  await openSteps("Dated project", false);
  await plugin(`
    for (const n of ['Dated step', 'Dated step 2', 'Dated later']) { const t = p.tasks().find((x) => x.text === n); if (t) await p.trash(t.file); }
    const f = app.vault.getAbstractFileByPath('Tasks/Dated project.md'); if (f) await p.trash(f);
    return true;`);
  await settle();
});

step("project brightness uses the same date as focus membership and its displayed date", async () => {
  const name = 'Brightness project', task = 'Brightness first step', key = 'future:💪Sport';
  const wasOpen = await plugin(`return p.data.opened[${J(key)}] ?? null;`);
  try {
    await plugin(`
      const area = (await p.collect(true)).find(a => a.name === '💪Sport');
      await p.createProject(area, ${J(name)});
      await p.createTask(${J(task)}, {area: '💪Sport', project: ${J(name)}}, ${J(TOMORROW)});
      p.data.opened[${J(key)}] = true; p.refresh(); return true;`);
    await toPane();
    await page.mouse('mouseMoved', 0, 0, 0); // Hover otherwise hides the dimming regression.
    for (const [projectDay, stepDay, future] of [
      [TODAY, TOMORROW, false], [YESTERDAY, TOMORROW, false], [TODAY, null, false],
      [TOMORROW, TODAY, true], [null, TODAY, false], [null, TOMORROW, true],
    ]) {
      await until(() => plugin(`return p.tasks().some(t => t.text === ${J(task)});`), 'first step indexed');
      await plugin(`
        await p.setDate(p.tasks().find(t => t.text === ${J(task)}), ${J(stepDay)});
        await p.setProjectDate(app.vault.getAbstractFileByPath(${J('Tasks/' + name + '.md')}), ${J(projectDay)});
        return true;`);
      await taskIs(task, {scheduled: stepDay});
      await settle();
      await until(() => page.eval(`return !!__ft.project(${J(name)});`), 'project row rendered');
      const before = read(taskPath(task));
      const state = await page.eval(`
        const r = __ft.project(${J(name)});
        return {future: !!r.closest('.ft-future-block'), dim: r.classList.contains('is-later'),
          opacity: Number(getComputedStyle(r).opacity), ownDate: !!r.querySelector('.ft-date.is-project')};`);
      if (state.future !== future || state.dim !== future || state.opacity !== (future ? 0.7 : 1)
          || state.ownDate !== !!projectDay) {
        throw new Error('project=' + projectDay + ', step=' + stepDay + ': ' + J(state));
      }
      if (read(taskPath(task)) !== before) throw new Error('rendering changed the first step note');
    }
  } finally {
    await plugin(`
      const task = p.tasks().find(t => t.text === ${J(task)}); if (task) await p.trash(task.file);
      const file = app.vault.getAbstractFileByPath(${J('Tasks/' + name + '.md')}); if (file) await p.trash(file);
      if (${J(wasOpen)} === null) delete p.data.opened[${J(key)}]; else p.data.opened[${J(key)}] = ${J(wasOpen)};
      p.refresh(); return true;`);
    await settle();
  }
});

step("«Waiting…» from the row's menu while its text is being edited: the editor closes, the card opens", async () => {
  fs.writeFileSync(path.join(VAULT, taskPath("Edit and wait")), `---\nuid: ft-ew-1\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\n---\n`);
  await toPane();
  await until(() => page.eval(`return !!__ft.task('Edit and wait')`), "Edit and wait on screen");
  await settle();
  await click(`__ft.at(__ft.task('Edit and wait').querySelector('.ft-text'))`);
  await editing();
  await page.eval(`__ft.caretToEnd()`);
  await page.type(" now");
  await menuOn(`__ft.at(__ft.task('Edit and wait now') || __ft.task('Edit and wait'))`);
  await menu("Waiting…");
  await until(() => page.eval(`return !!document.querySelector('.ft-picker .ft-picker-caption') && !document.querySelector('.focus-tasks-view .is-editing')`), "the editor closed and the card opened");
  await page.type("23");
  await until(() => page.eval(`return /is-mm/.test(document.activeElement?.className || '')`), "the caret moved to the minutes");
  await page.type("57");
  await page.key("Tab");
  await taskIs("Edit and wait now", { status: "waiting", scheduled: `${TODAY}T23:57` }, "the typed text was saved and the task sent off");
  await idle();
  fs.unlinkSync(path.join(VAULT, taskPath("Edit and wait now")));
  await settle();
});

step("a note that becomes a project after its block was drawn turns into the project's page", async () => {
  fs.writeFileSync(path.join(VAULT, "Tasks/Becomes.md"), `---\narea: "💪Sport"\n---\n\n\`\`\`focus-tasks\n\`\`\`\n`);
  await until(() => page.eval(`return !!app.vault.getAbstractFileByPath('Tasks/Becomes.md')`), "Becomes indexed");
  await page.eval(`const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath('Tasks/Becomes.md')); return true;`);
  const block = `[...document.querySelectorAll('.focus-tasks-view')].find((e) => !e.closest('.focus-tasks-pane') && e.getClientRects().length && e.closest('.workspace-leaf.mod-active'))`;
  await until(() => page.eval(`const b = ${block}; return !!b && !b.querySelector('.ft-page') && !!b.querySelector('.ft-area-title')`), "not a project: the whole list in the block");
  await page.eval(`await app.fileManager.processFrontMatter(app.vault.getAbstractFileByPath('Tasks/Becomes.md'), (fm) => { fm.type = 'project'; }); return true;`);
  await until(() => page.eval(`const b = ${block}; return !!b && b.querySelector('.ft-page-name')?.textContent === 'Becomes'`), "now a project: the block is its page", 10000);
  await page.eval(`app.workspace.activeLeaf.detach(); return true;`);
  fs.unlinkSync(path.join(VAULT, "Tasks/Becomes.md"));
  await toPane();
  await settle();
});

step("⌘⌫ in the editor deletes the whole task and moves the editor to the row above", async () => {
  for (const [n, u] of [["Above me", "ft-bk-1"], ["Delete me", "ft-bk-2"]])
    fs.writeFileSync(path.join(VAULT, taskPath(n)), `---\nuid: ${u}\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\n---\n`);
  await toPane();
  await plugin(`const l = 'area:💪Sport'; const k = p.data.order.tasks[l] || []; p.data.order.tasks[l] = ['ft-bk-1', 'ft-bk-2', ...k.filter((x) => !['ft-bk-1', 'ft-bk-2'].includes(x))]; await p.saveAll(); p.refresh(); return true;`);
  await until(() => page.eval(`const a = __ft.task('Above me'), b = __ft.task('Delete me'); return !!a && !!b && a.compareDocumentPosition(b) & 4`), "Above me, then Delete me");
  await settle();
  await click(`__ft.at(__ft.task('Delete me').querySelector('.ft-text'))`);
  await editing();
  await page.key("Meta+Backspace");
  await noTask("Delete me");
  await until(() => page.eval(`return document.querySelector('.focus-tasks-view .is-editing')?.textContent === 'Above me'`), "the editor is on the row above");
  await page.key("Escape");
  await idle();
  await page.key("Escape");
  fs.unlinkSync(path.join(VAULT, taskPath("Above me")));
  await settle();
});

step("⌘Enter opens the task as a note: from the editor (text saved), and from a selected row", async () => {
  fs.writeFileSync(path.join(VAULT, taskPath("Open me")), `---\nuid: ft-om-1\ntype: задача\nstatus: open\narea: "💪Sport"\nscheduled: ${TODAY}\n---\n`);
  await toPane();
  await until(() => page.eval(`return !!__ft.task('Open me')`), "Open me on screen");
  await settle();
  await click(`__ft.at(__ft.task('Open me').querySelector('.ft-text'))`);
  await editing();
  await page.eval(`__ft.caretToEnd()`);
  await page.type(" now");
  await page.key("Meta+Enter");
  await until(async () => (await activePath()) === taskPath("Open me now"), "the note of the renamed task is open");
  await page.eval(`app.workspace.activeLeaf.detach(); return true;`);
  await toPane();
  await until(() => page.eval(`return !!__ft.task('Open me now')`), "the row again");
  await settle();
  await click(`__ft.grip(__ft.task('Open me now'))`);
  await selectedAre(["Open me now"]);
  await page.key("Meta+Enter");
  await until(async () => (await activePath()) === taskPath("Open me now"), "a selected row's ⌘Enter opens its note");
  await page.eval(`app.workspace.activeLeaf.detach(); return true;`);
  await toPane();
  fs.unlinkSync(path.join(VAULT, taskPath("Open me now")));
  await settle();
});

step("an empty project's box closes the project", async () => {
  await plugin(`const sport = (await p.collect(true)).find((a) => a.name === '💪Sport'); await p.createProject(sport, 'Hollow'); return true;`);
  await toPane();
  await until(() => page.eval(`return !!__ft.project('Hollow')?.querySelector('.ft-box input')`), "Hollow on screen, with a box");
  await settle();
  await click(`__ft.at(__ft.project('Hollow').querySelector('.ft-box input'))`);
  await fileHas("Tasks/Hollow.md", "status: done", "the project is closed");
  await plugin(`const f = app.vault.getAbstractFileByPath('Tasks/Hollow.md'); if (f) await p.trash(f); return true;`);
  await settle();
});

step("⌘F finds a task hidden in a folded pile, opens what hides it, scrolls to it and selects it", async () => {
  fs.writeFileSync(path.join(VAULT, taskPath("Needle in the pile")), `---\nuid: ft-find-1\ntype: задача\nstatus: open\narea: "💪Sport"\n---\n`);
  await until(() => plugin(`p.forgetScan(); return p.tasks().some(t=>t.uid==='ft-find-1')`), "external search fixture indexed");
  await toPane();
  const key = await plugin(`return 'future:' + (await p.collect(false)).find((a) => a.name.includes('Sport')).name;`);
  const wasAll = await plugin(`return p.everything()`);
  await plugin(`if (p.everything()) p.setEverything(false); if (p.data.opened[${J(key)}]) await p.toggleShown(${J(key)}, true); p.refresh(); return true;`);
  await settle();
  if (await page.eval(`return !!__ft.task('Needle in the pile')`)) throw new Error("the task is on screen before it was looked for");
  await page.key("Meta+f");
  await until(() => page.eval(`return !!document.querySelector('.prompt .ft-find-item')`), "the finder");
  await page.type("needle pile");
  await until(() => page.eval(`return document.querySelector('.prompt .suggestion-item.is-selected .ft-find-title')?.textContent === 'Needle in the pile'`), "the task is the first hit");
  await page.key("Enter");
  await until(() => page.eval(`return !!__ft.task('Needle in the pile')?.classList.contains('is-selected')`), "the row is shown and selected");
  await page.key("Escape");
  await plugin(`if (p.data.opened[${J(key)}]) await p.toggleShown(${J(key)}, true); if (p.everything() !== ${wasAll}) p.setEverything(${wasAll}); p.refresh(); return true;`);
  fs.unlinkSync(path.join(VAULT, taskPath("Needle in the pile")));
  await settle();
});

step("a click on «Focus» opens every focus area and hides the rest: «All» and the ⏳ piles off", async () => {
  await toPane();
  const state = await plugin(`
    window.__ftDoneWas = p.doneShown();
    window.__ftFoldsWas = JSON.stringify({ folded: p.data.folded, opened: p.data.opened });
    const areas = await p.collect(false);
    for (const a of areas) p.data.folded['area:' + a.name] = true;
    p.saveFolds(); p.setDoneShown(true); p.setEverything(true);
    const rest = (await p.collect(true)).filter((a) => !areas.some((x) => x.name === a.name));
    for (const a of rest) p.data.opened['area:' + a.name] = true;
    p.saveFolds(); p.refresh();
    return { focus: areas.map((a) => a.name), rest: rest.map((a) => a.name) };`);
  await settle();
  await click(`__ft.at(__ft.view().querySelector('.ft-focus-title'))`, "the «Focus» title");
  await until(() => plugin(`return ${J(state.focus)}.every((n) => !p.data.folded['area:' + n]) && ${J(state.rest)}.every((n) => !p.data.opened['area:' + n]) && !p.doneShown() && !p.everything()`),
    "focus areas open, the rest folded, «All» off, the closed block shut");
  if (await page.eval(`return !!__ft.view().querySelector('.ft-rest-title:not(.ft-focus-title)') || __ft.all('.ft-future-block', __ft.view()).length > 0`)) throw new Error("other areas or a ⏳ pile still on screen");
  await plugin(`const was = JSON.parse(window.__ftFoldsWas); p.data.folded = was.folded; p.data.opened = was.opened; p.saveFolds();
    p.setEverything(false); p.setDoneShown(window.__ftDoneWas); return true;`);
  await settle();
});

step("a plain click anywhere else drops the selection: a header's «+», another pane", async () => {
  await toPane();
  await settle();
  const names = await page.eval(`return __ft.all('li.ft-task:not(.ft-project-row)', __ft.view()).slice(0, 2).map((e) => e.querySelector('.ft-text').textContent.trim())`);
  if (names.length < 2) throw new Error("need two plain rows: " + J(names));
  const two = async () => {
    await click(`__ft.grip(__ft.task(${J(names[0])}))`);
    await click(`__ft.at(__ft.task(${J(names[1])}))`, "the second row", CMD);
    await selectedAre(names);
  };
  // the «+» of an area keeps its click to itself (it opens a row to type in) — the selection goes all the same
  await two();
  await click(`__ft.at(__ft.area('Sport').querySelector('.ft-plus'))`, "the area's +");
  await selectedAre([]);
  await page.key("Escape");
  await idle();
  // another pane: the file explorer on the left
  await two();
  await click(`__ft.at(document.querySelector('.nav-files-container'), 0.9)`, "the file explorer");
  await selectedAre([]);
  await toPane();
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
    const rows = [...document.querySelectorAll('.focus-tasks-pane li.ft-task:not(.ft-project-row):not(.ft-done)')]
      .filter((r) => !r.closest('.ft-waiting, .ft-done-today'))
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
  if (moved > 3) throw new Error(`the page jumped by ${moved}px when a box was ticked (${J(before)} → ${after})`);
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
  const plusAt = await pos(`__ft.at(__ft.project('Flatland').querySelector('.ft-steps-more'))`, "+1");
  await click(`__ft.at(__ft.project('Flatland').querySelector('.ft-steps-more'))`, "+1");
  await until(() => page.eval(`
    const row = __ft.project('Flatland');
    return !!row && row.hasClass('is-open') && !!row.nextElementSibling?.hasClass('ft-steps') && !!__ft.task('Flat two') && !row.querySelector('.ft-text');`),
    "both steps as rows of their own, the row without a step");
  // the «−» is under the pointer where the «+1» was: a second click folds the steps without a hunt
  const minus = await page.eval(`const r = __ft.project('Flatland').querySelector('.ft-steps-more').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };`);
  if (plusAt.x < minus.left || plusAt.x > minus.right || plusAt.y < minus.top || plusAt.y > minus.bottom)
    throw new Error(`the «−» moved away from under the pointer: +1 was at ${J(plusAt)}, − is at ${J(minus)}`);
  await page.click(plusAt);
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

step("a project's note is its page: the block at the bottom shows its steps, takes a new one, folds the closed", async () => {
  await plugin(`
    const sport = (await p.collect(true)).find((a) => a.name === '💪Sport');
    await p.createProject(sport, 'Page project');
    await p.createTask('Page today', { area: '💪Sport', project: 'Page project' }, ${J(TODAY)});
    await p.createTask('Page later', { area: '💪Sport', project: 'Page project' }, null);
    return true;`);
  fs.writeFileSync(path.join(VAULT, taskPath("Page done")),
    `---\nuid: ft-page-done\ntype: задача\nstatus: done\narea: "💪Sport"\nprojects:\n  - "[[Page project]]"\ncompletedDate: ${TODAY}\n---\n`);
  await until(() => exists("Tasks/Page project.md") && exists(taskPath("Page later")), "the project and its steps");
  // a new project note carries the block at its end
  const body = read("Tasks/Page project.md");
  if (!/```focus-tasks\n```\s*$/.test(body)) throw new Error("a new project note has no steps block at the end: " + J(body));
  await page.eval(`const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath('Tasks/Page project.md')); return true;`);
  const block = `[...document.querySelectorAll('.focus-tasks-view')].find((e) => e.querySelector('.ft-page') && e.getClientRects().length)`;
  const row = (name) => `__ft.all('li.ft-task', ${block}).find((e) => e.querySelector('.ft-text')?.textContent.trim() === ${J(name)})`;
  await until(() => page.eval(`return !!(${row("Page today")}) && !!(${row("Page later")})?.closest('.ft-future-block') && (${row("Page later")}).hasClass('is-later')`),
    "today's step, and the undated one dimmed in the pile under it");
  if (await page.eval(`return __ft.all('li.ft-task', ${block}).some((e) => /Run 5k|Flat one|Call coach/.test(e.querySelector('.ft-text')?.textContent || ''))`))
    throw new Error("another project's rows are on the page");
  // the block has a heading of its own — the project's row: 📁 name, and a ⏳ that folds its pile
  const head = await page.eval(`const h = (${block}).querySelector('.ft-page-head'); return h && { name: h.querySelector('.ft-page-name')?.textContent, chip: !!h.querySelector('.ft-later-chip'), plus: !!h.querySelector('.ft-plus') };`);
  if (!head || head.name !== "Page project" || !head.chip || !head.plus) throw new Error("no heading with the name, the ⏳ and the + over the steps: " + J(head));
  await page.click(await page.eval(`return __ft.at((${block}).querySelector('.ft-page-head .ft-later-chip'))`));
  await until(() => page.eval(`return !(${row("Page later")}) && !!(${row("Page today")})`), "the ⏳ folded the pile, today's step stays");
  await page.click(await page.eval(`return __ft.at((${block}).querySelector('.ft-page-head .ft-later-chip'))`));
  await until(() => page.eval(`return !!(${row("Page later")})?.closest('.ft-future-block')`), "and opened it again");
  // the closed steps fold under «Done · 1»
  await until(() => page.eval(`return (${block}).querySelector('.ft-page-done')?.textContent.includes('1')`), "«Done · 1» on the page");
  if (await page.eval(`return !!(${row("Page done")})`)) throw new Error("the closed step is shown before its block is opened");
  await page.click(await page.eval(`return __ft.at((${block}).querySelector('.ft-page-done'))`));
  await until(() => page.eval(`return !!(${row("Page done")})?.closest('.ft-done-today')`), "the closed step under it");
  // the box on the page completes a step: its row joins the closed
  await page.click(await page.eval(`return __ft.at((${row("Page today")}).querySelector('input'))`));
  await taskIs("Page today", { status: "done", completedDate: TODAY });
  await until(() => page.eval(`return !!(${row("Page today")})?.closest('.ft-done-today')`), "Page today among the closed");
  // «+ Step in this project» types a new step; it starts with no date, in the pile — and with the
  // closed block open, the row opens under the live rows, not among the closed
  await page.click(await page.eval(`return __ft.at((${block}).querySelector('.ft-page-add'))`));
  await editing();
  if (await page.eval(`return !!document.querySelector('.focus-tasks-view .is-editing')?.closest('.ft-done-today')`)) throw new Error("the new step's row opened among the closed steps");
  await page.type("Page typed");
  await page.key("Enter");
  await until(() => exists(taskPath("Page typed")), "the typed step's note");
  await page.key("Escape");
  await idle();
  await taskIs("Page typed", { projects: "[[Page project]]", scheduled: null });
  await until(() => page.eval(`return !!(${row("Page typed")})?.closest('.ft-future-block')`), "the typed step in the page's pile");
  // ⌘Z in the note's own text is the note's undo: the list's history is left alone
  const steps = await plugin(`return (p.history || []).length`);
  await page.eval(`const v = app.workspace.activeLeaf.view; v.editor.setCursor({ line: 0, ch: 0 }); v.editor.focus(); return true;`);
  await page.key("Meta+z");
  await sleep(400);
  if ((await plugin(`return (p.history || []).length`)) !== steps) throw new Error("⌘Z in the note ran the list's undo");
  // an old project note without the block gets one when opened from the list, once
  fs.writeFileSync(path.join(VAULT, "Tasks/Old project.md"), `---\narea: "💪Sport"\ntype: проект\n---\nСтарая заметка\n`);
  await until(() => page.eval(`return !!app.plugins.plugins['focus-tasks'].notes().find((n) => n.project && n.file.basename === 'Old project')`), "Old project known to the list");
  await plugin(`const old = app.vault.getAbstractFileByPath('Tasks/Old project.md'); const v = [...p.views].find((x) => x.leaf); await v.open(old); return true;`);
  await until(() => /Старая заметка\n\n```focus-tasks\n```\n$/.test(read("Tasks/Old project.md") || ""), "the block appended after the text");
  await plugin(`const old = app.vault.getAbstractFileByPath('Tasks/Old project.md'); const v = [...p.views].find((x) => x.leaf); await v.open(old); return true;`);
  await sleep(300);
  if ((read("Tasks/Old project.md").match(/```focus-tasks/g) || []).length !== 1) throw new Error("the block was added twice");
  await toPane();
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

step("delete a project: its note and its tasks go to the trash", async () => {
  await toPane();
  await until(() => page.eval(`return !!__ft.project('Marathon 2027')`), "Marathon 2027 on screen");
  await menuOn(`__ft.at(__ft.name('Marathon 2027'))`);
  await menu("Delete project");
  await until(() => page.eval(`return !!document.querySelector('.modal .mod-warning')`), "confirm");
  await click(`__ft.at(document.querySelector('.modal .mod-warning'))`);
  await until(() => !exists("Tasks/Marathon 2027.md") && exists(".trash/Marathon 2027.md"), "in .trash");
  await noTask("Buy shoes fast");   // its tasks went with it
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

step("an area's own note shows only its projects and all its tasks, and adds an undated task locally", async () => {
  const file = await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    const note = await p.createArea('Audit Area');
    const project = await p.createProject({ name: 'Audit Area', note }, 'Audit Project');
    await p.createTask('Audit loose task', { area: 'Audit Area' }, null);
    await p.createTask('Audit project step', { area: 'Audit Area', project: project.basename, projectFile: project }, ${J(TOMORROW)});
    await p.createTask('Audit second project step', { area: 'Audit Area', project: project.basename, projectFile: project }, ${J(TODAY)});
    await p.createTask('Audit third project step', { area: 'Audit Area', project: project.basename, projectFile: project }, ${J(TODAY)});
    const completed = await p.createTask('Audit completed area task', { area: 'Audit Area' }, ${J(TODAY)});
    await p.setFields(completed, { status:'done', completedDate:${J(TODAY)} });
    await p.setOpen('steps:' + project.path, true);
    await p.setOpen('area-page-done:' + note.path, true);
    await p.ensureAreaBlock(note);
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: 'markdown', state: { file: note.path, mode: 'preview' } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    return note.path;`);
  await until(() => page.eval(`const e=[...document.querySelectorAll('.ft-area-page')].find(e=>e.getClientRects().length);return e?.textContent.includes('Audit loose task')&&e?.textContent.includes('Audit project step');`), 'the local area page and parsed steps');
  const state = await page.eval(`const e = [...document.querySelectorAll('.ft-area-page')].find(e=>e.getClientRects().length); return { text: e.textContent, areas: e.querySelectorAll('.ft-area-title').length };`);
  if (!state.text.includes('Audit loose task') || !state.text.includes('Audit project step') || state.areas !== 1)
    throw new Error('wrong area page: ' + J(state));
  const header = await page.eval(`const e = [...document.querySelectorAll('.ft-area-page .ft-area-title')].find(e=>e.getClientRects().length); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};`);
  await page.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:header.x,y:header.y});
  await page.click(await until(() => page.eval(`const e = [...document.querySelectorAll('.ft-area-page .ft-area-title .ft-plus')].find(e=>e.getClientRects().length); if(!e)return null; const r = e.getBoundingClientRect(); return { x: r.left+r.width/2, y:r.top+r.height/2 };`), 'the real hover reveals area add'));
  await editing();
  const draftInset=await page.eval(`const root=[...document.querySelectorAll('.ft-area-page')].find(e=>e.getClientRects().length);const draft=root.querySelector('.is-editing').closest('li.ft-task');const row=[...root.querySelectorAll('li.ft-task')].find(e=>e!==draft);return draft.getBoundingClientRect().left-row.getBoundingClientRect().left;`);
  if(Math.abs(draftInset)>1)throw new Error('the local area draft acquired an extra indent: '+draftInset);
  await page.type('Added inside area');
  await page.key('Enter');
  await page.key('Escape');
  await taskIs('Added inside area', { area: 'Audit Area', scheduled: null });
  if ((read(file).match(/```focus-tasks/g) || []).length !== 1) throw new Error('the area block duplicated itself');
  await toPane();
});

step("local area rows are flat like the project page while the global focus keeps its hierarchy", async () => {
  const previousAll = await plugin('return p.everything();');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];const file=p.notes().find(n=>!n.project&&n.area==='Audit Area').file;
    const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});app.workspace.setActiveLeaf(leaf,{focus:true});return true;`);
  await until(()=>page.eval(`const e=[...document.querySelectorAll('.ft-area-page')].find(e=>e.getClientRects().length);return e?.querySelectorAll('.ft-steps li.ft-task').length===3;`),'expanded project steps on the area page');
  const measure = (selector) => page.eval(`const root=[...document.querySelectorAll(${J(selector)})].find(e=>e.getClientRects().length);
    const left=root.getBoundingClientRect().left;return [...root.querySelectorAll('li.ft-task')].map(e=>({text:e.textContent,offset:e.getBoundingClientRect().left-left}));`);
  const areaRows = await measure('.ft-area-page');
  if(!areaRows.some(r=>r.text.includes('Audit completed area task')))throw new Error('the completed area row was not checked');
  if(areaRows.length<4 || areaRows.some(r=>Math.abs(r.offset-areaRows[0].offset)>1))throw new Error('indented area rows: '+J(areaRows));
  const guides=await page.eval(`const root=[...document.querySelectorAll('.ft-area-page')].find(e=>e.getClientRects().length);return [...root.querySelectorAll('.ft-steps,.ft-steps > ul')].filter(e=>{const s=getComputedStyle(e,'::before');return s.display!=='none'&&!['none','normal'].includes(s.content);}).length;`);
  if(guides)throw new Error('the area page still draws '+guides+' indentation guides');
  await page.shot(path.join(SHOTS,'area-page-flat.png'));
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];const file=p.notes().find(n=>n.project&&n.file.basename==='Audit Project').file;
    const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});app.workspace.setActiveLeaf(leaf,{focus:true});return true;`);
  await until(()=>page.eval(`return [...document.querySelectorAll('.ft-page')].some(e=>e.getClientRects().length&&e.querySelector('li.ft-task'));`),'local project page');
  const projectRows=await measure('.ft-page');
  if(projectRows.some(r=>Math.abs(r.offset-areaRows[0].offset)>1))throw new Error('area and project pages have different insets: '+J({areaRows,projectRows}));
  await toPane();
  await plugin(`p.setEverything(true);await p.setOpen('area:Audit Area',true);return true;`);
  await until(()=>page.eval(`const root=__ft.area('Audit Area')?.closest('.ft-area');const steps=[...root.querySelectorAll('.ft-steps li.ft-task')].map(el=>app.workspace.getLeavesOfType('focus-tasks-view')[0].view.renderer.items.get(el)?.task?.text);return ['Audit second project step','Audit third project step','Audit project step'].every(name=>steps.includes(name));`),'global project hierarchy including the single future step');
  const global=await page.eval(`const root=__ft.area('Audit Area').closest('.ft-area');const project=root.querySelector('li.ft-project-row');const step=root.querySelector('.ft-steps li.ft-task');return {project:project.getBoundingClientRect().left,step:step.getBoundingClientRect().left};`);
  if(global.step-global.project<15)throw new Error('the global focus lost its step indentation: '+J(global));
  await plugin(`p.setEverything(${J(previousAll)});return true;`);
});

step("local area headers separate emoji from the name without adding a gap to plain names", async () => {
  for (const [emoji, name] of [['🖥️', 'Desktop Emoji Area'], ['👩🏽‍💻', 'Compound Emoji Area'], ['', 'Plain Header Area']]) {
    const area = emoji + name;
    await page.eval(`const p=app.plugins.plugins['focus-tasks'];const note=await p.createArea(${J(area)});
      const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'markdown',state:{file:note.path,mode:'preview'}});
      app.workspace.setActiveLeaf(leaf,{focus:true});return true;`);
    await until(()=>page.eval(`return [...document.querySelectorAll('.ft-area-page-head')].some(e=>e.getClientRects().length&&e.textContent.includes(${J(name)}));`),'local area header '+name);
    const actual = await page.eval(`const head=[...document.querySelectorAll('.ft-area-page-head')].find(e=>e.getClientRects().length);
      const icon=head.querySelector('.ft-emoji'),name=head.querySelector('.ft-page-name');let gap=null;
      if(icon){const glyph=document.createRange();glyph.selectNodeContents(icon);const letter=document.createRange();letter.setStart(name.firstChild,0);letter.setEnd(name.firstChild,1);gap=letter.getBoundingClientRect().left-glyph.getBoundingClientRect().right;}
      return {emoji:icon?.textContent||'',name:name?.textContent,gap};`);
    if(actual.emoji!==emoji||actual.name!==name)throw new Error('area header lost or duplicated its emoji/name: '+J(actual));
    if(emoji&&(actual.gap<3||actual.gap>18))throw new Error('area emoji is stuck to or too far from its name: '+J(actual));
  }
  await toPane();
});

step("a failed date write keeps the task in its editor with the original day", async () => {
  await page.eval(`const p=app.plugins.plugins['focus-tasks']; await p.createTask('Audit write failure', {area:'Audit Area'}, ${J(TODAY)}); await p.setOpen('area:Audit Area', true); return true;`);
  await until(() => page.eval(`return !!__ft.task('Audit write failure')`), 'the task');
  await click(`__ft.at(__ft.task('Audit write failure').querySelector('.ft-text'))`);
  await editing();
  await page.eval(`window.__auditWriteAttempts=0; window.__auditProcess = app.vault.process; app.vault.process = async function(file, fn) {
    if(file.basename === 'Audit write failure') {__auditWriteAttempts++;throw new Error('injected disk failure');}
    return __auditProcess.call(app.vault, file, fn);
  }; return true;`);
  try {
    await page.key('Meta+2');
    await sleep(600);
    await taskIs('Audit write failure', { scheduled: TODAY });
    if(!await page.eval(`return __auditWriteAttempts>0;`))throw new Error('the shortcut never attempted the injected disk write');
    if (!await page.eval(`return document.querySelector('.is-editing')?.textContent === 'Audit write failure'`)) throw new Error('a failed write closed the editor');
  } finally { await page.eval(`app.vault.process=__auditProcess; delete window.__auditProcess; return true;`); }
  await page.key('Escape');
});

step("a failed rename preserves the typed text and lets the editor retry", async () => {
  await click(`__ft.at(__ft.task('Audit write failure').querySelector('.ft-text'))`);
  await editing();
  await page.eval(`__ft.caretToEnd(); window.__auditRename=app.fileManager.renameFile; app.fileManager.renameFile=async function(file,path) {
    if(file.basename==='Audit write failure') throw new Error('injected rename failure');
    return __auditRename.call(this,file,path);
  }; return true;`);
  await page.type(' retry');
  try {
    await page.key('Enter');
    await until(() => page.eval(`return document.querySelector('.is-editing')?.textContent === 'Audit write failure retry'`), 'the text is kept for retry');
    await taskIs('Audit write failure', { title: 'Audit write failure retry' });
  } finally { await page.eval(`app.fileManager.renameFile=__auditRename; delete window.__auditRename; return true;`); }
  await page.key('Enter');
  await taskIs('Audit write failure retry', { scheduled: TODAY });
  await page.key('Escape');
});

step("Undo of an edited title restores the note and its incoming links", async () => {
  await page.eval(`await app.vault.create('Notes/Audit link.md','Context [[Audit write failure retry]]'); return true;`);
  await click(`__ft.at(__ft.task('Audit write failure retry').querySelector('.ft-text'))`);
  await editing();
  await page.eval(`__ft.caretToEnd(); return true;`);
  await page.type(' renamed');
  await page.key('Enter');
  await taskIs('Audit write failure retry renamed', { scheduled: TODAY });
  await page.key('Escape');
  await page.key('Meta+z');
  await taskIs('Audit write failure retry', { scheduled: TODAY });
  await until(() => read('Notes/Audit link.md')?.includes('[[Audit write failure retry]]'), 'incoming link restored');
});

step("a backlog task can get an Apple Calendar reminder with one precise time", async () => {
  await page.eval(`window.__auditClickTrace=[];for(const name of ['pointerdown','click','scroll'])document.addEventListener(name,e=>{__auditClickTrace.push({name,target:e.target.className,at:Date.now(),picker:!!document.querySelector('.ft-picker'),views:[...app.plugins.plugins['focus-tasks'].views].map(v=>({edit:!!v.editing,active:v.leaf===app.workspace.activeLeaf,visible:!!v.containerEl.getClientRects().length}))});__auditClickTrace=__auditClickTrace.slice(-20);},true);new MutationObserver(records=>{for(const r of records)for(const n of [...r.addedNodes,...r.removedNodes])if(n.classList?.contains('ft-picker'))__auditClickTrace.push({name:[...r.addedNodes].includes(n)?'picker-add':'picker-remove',at:Date.now()});}).observe(document.body,{childList:true});return true;`);
  await page.eval(`const p=app.plugins.plugins['focus-tasks']; p.settings.language='en';p.applyLanguage();await p.saveAll();await p.createTask('Audit reminder',{area:'Audit Area'},null); await p.setEverything(true); await p.setOpen('area:Audit Area',true); return true;`);
  await until(()=>page.eval(`return !!__ft.task('Audit reminder')`),'reminder task');
  await menuOn(`__ft.at(__ft.task('Audit reminder'))`);
  if(await page.eval(`return [...document.querySelectorAll('.menu-item-title')].some(e=>e.textContent.includes('Apple Calendar'))`))throw new Error('separate reminder menu remains');
  await page.key('Escape');
  await click(`__ft.at(__ft.task('Audit reminder').querySelector('.ft-date'))`);
  await until(()=>page.eval(`return !!document.querySelector('.ft-picker .is-hh')`),'reminder time');
  const initial=await page.eval(`const p=app.plugins.plugins['focus-tasks'],t=p.tasks().find(x=>x.text==='Audit reminder');return {day:[...p.views].find(v=>v.picker)?.picker.value,saved:t.date};`);
  if(initial.day!==TODAY||initial.saved)throw new Error('undated card must suggest today without writing before Save: '+J(initial));
  await click(`__ft.at(document.querySelector('.ft-picker-input'))`);
  await page.eval(`document.querySelector('.ft-picker-input').select();return true;`); await page.type(ddmmyy(TOMORROW));
  await click(`__ft.at(document.querySelector('.ft-picker .is-hh'))`);
  await page.type('16'); await page.type('30'); await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await taskIs('Audit reminder',{scheduled:TOMORROW+'T16:30',status:'open'});
  await until(()=>page.eval(`return !document.querySelector('.ft-picker')`),'saved reminder');
});

step("changing the reminder day preserves its hour; clearing the hour is explicit", async () => {
  await page.eval(`const p=app.plugins.plugins['focus-tasks']; await p.setDate(p.tasks().find(x=>x.text==='Audit reminder'),${J(TODAY)}); return true;`);
  await taskIs('Audit reminder',{scheduled:TODAY+'T16:30'});
  await until(()=>page.eval(`const d=__ft.task('Audit reminder')?.querySelector('.ft-date');return d?.classList.contains('is-today')&&d.textContent.includes('16:30');`),'the updated day and preserved hour are visible');
  await click(`__ft.at(__ft.task('Audit reminder').querySelector('.ft-date'))`);
  try {await until(()=>page.eval(`return !!document.querySelector('.ft-picker .is-hh')`),'existing reminder time');}
  catch(e){throw new Error(e.message+'; trace='+JSON.stringify(await page.eval(`return {point:__auditPoint,events:__auditClickTrace,picker:document.querySelector('.ft-picker')?.outerHTML.slice(0,500),active:app.workspace.activeLeaf?.view?.getState()};`)));}
  await page.eval(`const anchor=__ft.task('Audit reminder');const other=[...document.querySelectorAll('.markdown-preview-view')].find(e=>!e.contains(anchor));if(other)other.dispatchEvent(new Event('scroll'));return true;`);
  await sleep(200);
  if(!await page.eval(`return !!document.querySelector('.ft-picker .is-hh')`))throw new Error('another pane committed this date card');
  await page.eval(`document.querySelector('.ft-picker .is-hh').value='';document.querySelector('.ft-picker .is-mm').value=''; return true;`);
  await click(`__ft.at(document.querySelector('.ft-picker-input'))`);
  await page.key('Enter');
  await taskIs('Audit reminder',{scheduled:TODAY});
  await until(()=>page.eval(`return !document.querySelector('.ft-picker') && !__ft.task('Audit reminder')?.querySelector('.ft-date')?.textContent.includes('16:30')`),'the cleared clock is reflected by the finished card and row');
});

step("the shared calendar adds optional time and saves day-only without midnight", async () => {
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.createTask('Audit common calendar',{area:'Audit Area'},${J(TODAY)});return true;`);
  const open=async()=>{await until(()=>page.eval(`return !!__ft.task('Audit common calendar')`),'calendar task');await click(`__ft.at(__ft.task('Audit common calendar').querySelector('.ft-date'))`);await until(()=>page.eval(`return !!document.querySelector('.ft-picker-save')`),'calendar with Save');};
  await open();
  if(!await page.eval(`const p=document.querySelector('.ft-picker');return p.querySelectorAll('.ft-picker-part').length===2 && [...p.querySelectorAll('.ft-picker-part')].every(e=>e.value==='');`))throw new Error('a plain day uses a different card or a hidden default time');
  await page.eval(`const picker=[...app.plugins.plugins['focus-tasks'].views].find(v=>v.picker)?.picker;picker.month.year(${Number(TOMORROW.slice(0,4))}).month(${Number(TOMORROW.slice(5,7))-1}).startOf('month');picker.draw();return true;`);
  await click(`__ft.at([...document.querySelectorAll('.ft-picker-day:not(.is-other)')].find(d=>d.textContent===${J(String(Number(TOMORROW.slice(8))))}))`);
  await taskIs('Audit common calendar',{scheduled:TODAY}); // day selection leaves time editable
  await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await taskIs('Audit common calendar',{scheduled:TOMORROW});await idle();
  await open();await click(`__ft.at(document.querySelector('.ft-picker .is-hh'))`);await page.type('16');await page.type('30');
  await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await taskIs('Audit common calendar',{scheduled:TOMORROW+'T16:30'});await idle();
  await open();await click(`__ft.at(document.querySelector('.ft-picker-clear-time'))`);await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await taskIs('Audit common calendar',{scheduled:TOMORROW});await idle();
  await open();await click(`__ft.at(document.querySelector('.ft-picker .is-hh'))`);await page.type('00');await page.type('00');await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await taskIs('Audit common calendar',{scheduled:TOMORROW+'T00:00'});await idle();
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.setScheduled(p.tasks().find(t=>t.text==='Audit common calendar'),${J(TOMORROW)},null);return true;`);
  await settle();await open();
  // A second client adds an hour while this card still displays the original day-only value.
  await page.eval(`const p=app.plugins.plugins['focus-tasks'],task=p.tasks().find(t=>t.text==='Audit common calendar');await app.vault.process(task.file,text=>text.replace(/^scheduled:.*$/m,'scheduled: '+${J(TOMORROW+'T17:25')}));return true;`);
  await taskIs('Audit common calendar',{scheduled:TOMORROW+'T17:25'});
  await click(`__ft.at(document.querySelector('.ft-picker-clear-time'))`);await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await taskIs('Audit common calendar',{scheduled:TOMORROW},'explicit clear removes an hour received after the card opened');await idle();
});

step("the shared calendar preserves mixed hours and applies a group clock as one undo", async () => {
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];for(const [name,at] of [['Audit clock A','08:10'],['Audit clock B','17:25']]){const task=await p.createTask(name,{area:'Audit Area'},${J(TODAY)});await p.setScheduled(task,${J(TODAY)},at);}return true;`);
  const open=async()=>{
    await until(()=>page.eval(`return !!__ft.task('Audit clock A') && !!__ft.task('Audit clock B')`),'clock tasks');
    await settle();
    await page.eval(`const p=app.plugins.plugins['focus-tasks'],v=[...p.views].find(v=>v.rows().some(([el])=>el===__ft.task('Audit clock A'))),tasks=v.rows().map(([,t])=>t).filter(t=>/^Audit clock [AB]$/.test(t.text));if(tasks.length!==2)throw new Error('group fixture is not rendered');v.selected=new Set(tasks);await v.editDate(tasks[0],__ft.task('Audit clock A').querySelector('.ft-date'));return true;`);
    await until(()=>page.eval(`return !!document.querySelector('.ft-picker-save')`),'group calendar');
  };
  await open();
  if(!await page.eval(`return document.querySelector('.ft-picker .is-hh').placeholder==='-'`))throw new Error('different hours are presented as one clock');
  await page.eval(`document.querySelector('.ft-picker-input').value=${J(ddmmyy(TOMORROW))};return true;`);await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await taskIs('Audit clock A',{scheduled:TOMORROW+'T08:10'});await taskIs('Audit clock B',{scheduled:TOMORROW+'T17:25'});await idle();
  await open();await click(`__ft.at(document.querySelector('.ft-picker-clear-time'))`);await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await taskIs('Audit clock A',{scheduled:TOMORROW});await taskIs('Audit clock B',{scheduled:TOMORROW});await idle();
  await open();await click(`__ft.at(document.querySelector('.ft-picker .is-hh'))`);await page.type('16');await page.type('30');await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await taskIs('Audit clock A',{scheduled:TOMORROW+'T16:30'});await taskIs('Audit clock B',{scheduled:TOMORROW+'T16:30'});await idle();
  await page.key('Meta+z');
  await taskIs('Audit clock A',{scheduled:TOMORROW});await taskIs('Audit clock B',{scheduled:TOMORROW});
});


step("editing Waiting dates preserves mixed and synced hours; removing time is explicit", async () => {
  const later=ymd(new Date(Date.now()+2*864e5));
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];for(const [name,at] of [['Audit clock A','08:10'],['Audit clock B','17:25']])await p.setWaiting(p.tasks().find(t=>t.text===name),true,${J(TOMORROW)},at);await p.setEverything(true);await p.setWaitingShown(true);return true;`);
  const open=async()=>{
    await until(()=>page.eval(`return !!__ft.task('Audit clock A') && !!__ft.task('Audit clock B')`),'Waiting clocks');await settle();
    await page.eval(`const p=app.plugins.plugins['focus-tasks'],v=[...p.views].find(v=>v.rows().some(([el])=>el===__ft.task('Audit clock A'))),tasks=[...new Map(v.rows().map(([,t])=>t).filter(t=>/^Audit clock [AB]$/.test(t.text)).map(t=>[t.uid,t])).values()];if(tasks.length!==2)throw new Error('Waiting fixtures missing');v.selected=new Set(tasks);await v.editDate(tasks[0],__ft.task('Audit clock A').querySelector('.ft-date'));return true;`);
    await until(()=>page.eval(`return !!document.querySelector('.ft-picker-save')`),'Waiting group card');
  };
  await open();
  if(!await page.eval(`return document.querySelector('.ft-picker-input').value===${J(ddmmyy(TOMORROW))} && document.querySelector('.is-hh').placeholder==='-'`))throw new Error('Opening Waiting rescheduling guesses today or discards mixed hours');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'],task=p.tasks().find(t=>t.text==='Audit clock B');await app.vault.process(task.file,text=>text.replace(/^scheduled:.*$/m,'scheduled: '+${J(TOMORROW+'T18:35')}));document.querySelector('.ft-picker-input').value=${J(ddmmyy(later))};return true;`);
  await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await taskIs('Audit clock A',{status:'waiting',scheduled:later+'T08:10'});await taskIs('Audit clock B',{status:'waiting',scheduled:later+'T18:35'});await idle();
  await open();await click(`__ft.at(document.querySelector('.ft-picker-clear-time'))`);await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await taskIs('Audit clock A',{status:'waiting',scheduled:later});await taskIs('Audit clock B',{status:'waiting',scheduled:later});await idle();
  await page.key('Meta+z');await taskIs('Audit clock A',{status:'waiting',scheduled:later+'T08:10'});await taskIs('Audit clock B',{status:'waiting',scheduled:later+'T18:35'});await idle();
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.setDate(p.tasks().find(t=>t.text==='Audit clock B'),${J(TOMORROW)});return true;`);await idle();
  await open();
  if(!await page.eval(`return document.querySelector('.ft-picker-input').value===''`))throw new Error('Mixed Waiting days are replaced by an implicit day');
  await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await until(()=>page.eval(`return !!document.querySelector('.ft-picker-input.is-invalid')`),'a mixed day requires an explicit choice');await page.key('Escape');
  await taskIs('Audit clock A',{status:'waiting',scheduled:later+'T08:10'});await taskIs('Audit clock B',{status:'waiting',scheduled:TOMORROW+'T18:35'});
  await page.eval(`for(const v of app.plugins.plugins['focus-tasks'].views)v.clearSelection();return true;`);
});

step("invalid typed dates cannot silently save the old date", async () => {
  await click(`__ft.at(__ft.task('Audit reminder').querySelector('.ft-date'))`);
  await until(()=>page.eval(`return !!document.querySelector('.ft-picker-input')`),'date card');
  await page.eval(`document.querySelector('.ft-picker-input').select();return true;`); await page.type('31.02.2030'); await page.key('Enter');
  await until(()=>page.eval(`return document.querySelector('.ft-picker-input')?.classList.contains('is-invalid')`),'invalid input');
  await taskIs('Audit reminder',{scheduled:TODAY});
  await page.key('Escape');
});

step("an explicit midnight clock is retained even when today has already started", async () => {
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.createTask('Audit past reminder',{area:'Audit Area'},${J(TODAY)});return true;`);
  await until(()=>page.eval(`return !!__ft.task('Audit past reminder')`),'the reminder fixture');
  await click(`__ft.at(__ft.task('Audit past reminder').querySelector('.ft-date'))`);
  await until(()=>page.eval(`return !!document.querySelector('.ft-picker .is-hh')`),'the clock card');
  await click(`__ft.at(document.querySelector('.ft-picker .is-hh'))`); await page.type('00');await page.type('00');
  await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await taskIs('Audit past reminder',{scheduled:TODAY+'T00:00'});
  await click(`__ft.at(__ft.task('Audit past reminder').querySelector('.ft-date'))`);
  await until(()=>page.eval(`return !!document.querySelector('.ft-picker-input')`),'reopened clock');
  await click(`__ft.at(document.querySelector('.ft-picker-input'))`);await page.eval(`document.querySelector('.ft-picker-input').select();return true;`);await page.type(ddmmyy(TOMORROW));await page.key('Enter');
  await taskIs('Audit past reminder',{scheduled:TOMORROW+'T00:00'});
  await until(()=>page.eval(`return !document.querySelector('.ft-picker')`),'midnight saved');
});

step("a date card keeps its value and stays open when the disk write fails", async () => {
  await click(`__ft.at(__ft.task('Audit reminder').querySelector('.ft-date'))`);
  await until(()=>page.eval(`return !!document.querySelector('.ft-picker-input')`),'date card');
  await page.eval(`window.__auditProcess=app.vault.process; app.vault.process=async function(file,fn){if(file.basename==='Audit reminder')throw new Error('injected write failure');return __auditProcess.call(app.vault,file,fn);};return true;`);
  try {
    await page.eval(`document.querySelector('.ft-picker-input').select();return true;`); await page.type(ddmmyy(TOMORROW)); await page.key('Enter'); await sleep(500);
    await taskIs('Audit reminder',{scheduled:TODAY});
    if(!await page.eval(`return !!document.querySelector('.ft-picker-input')`))throw new Error('failed save discarded the card');
  } finally {await page.eval(`app.vault.process=__auditProcess;delete window.__auditProcess;return true;`);}
  await page.key('Enter');
  await taskIs('Audit reminder',{scheduled:TOMORROW});
});

step("midnight refresh brings tomorrow into Focus even with no Waiting tasks", async () => {
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];for(const task of p.tasks().filter(x=>x.status==='waiting'))await p.setWaiting(task,false);await p.createTask('Audit midnight',{area:'Audit Area'},${J(TOMORROW)});await p.setEverything(false);await p.setOpen('area:Audit Area',true);return true;`);
  await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return p.tasks().some(x=>x.text==='Audit midnight'&&x.date===${J(TOMORROW)})&&[...p.views].filter(v=>v.leaf).every(v=>!v.busy&&v.daySeen===${J(TODAY)});`),'tomorrow is indexed and the current-day render is finished');
  await settle();
  if(await page.eval(`return !!__ft.task('Audit midnight')`))throw new Error('tomorrow entered today');
  await page.eval(`window.__auditNow=Date.now;Date.now=()=>__auditNow()+86400000;for(const v of app.plugins.plugins['focus-tasks'].views)v.wake();return true;`);
  try {await until(()=>page.eval(`return !!__ft.task('Audit midnight')`),'tomorrow becomes current at midnight');}
  finally {await page.eval(`Date.now=__auditNow;delete window.__auditNow;app.plugins.plugins['focus-tasks'].refresh();return true;`);}
});

step("a Waiting hour becomes relevant without a file edit or a manual refresh", async () => {
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.setWaitingShown(false);const d=moment().add(2,'minutes');const task=await p.createTask('Audit timed return',{area:'Audit Area'},${J(TODAY)});await p.setWaiting(task,true,d.format('YYYY-MM-DD'),d.format('HH:mm'));return true;`);
  await taskIs('Audit timed return',{status:'waiting'});
  await until(()=>page.eval(`return !__ft.task('Audit timed return')&&[...app.plugins.plugins['focus-tasks'].views].some(v=>v.leaf&&!v.busy&&v.pending?.some(t=>t.text==='Audit timed return'));`),'the stored Waiting task has left Focus and is registered for timed return');
  await settle();
  if(await page.eval(`return !!__ft.task('Audit timed return')`))throw new Error('Waiting returned too soon');
  await page.eval(`window.__auditNow=Date.now;Date.now=()=>__auditNow()+180000;for(const v of app.plugins.plugins['focus-tasks'].views)v.wake();return true;`);
  try {await until(()=>page.eval(`return !!__ft.task('Audit timed return')`),'Waiting becomes current at its hour');}
  finally {await page.eval(`Date.now=__auditNow;delete window.__auditNow;app.plugins.plugins['focus-tasks'].refresh();return true;`);}
});

step("configured companion plugins actually run in this test vault", async () => {
  const live = await page.eval(`return Object.keys(app.plugins.plugins);`);
  for (const c of companions) if (!live.includes(c.id)) throw new Error('missing companion: '+c.id);
  if (!companions.length && live.includes('tasknotes')) throw new Error('the standalone run unexpectedly depends on TaskNotes');
  if (live.includes('tasknotes')) {
    await page.eval(`await app.plugins.plugins.tasknotes.api.lifecycle.ready(); const p=app.plugins.plugins['focus-tasks']; const task=await p.createTask('Audit recurring bridge',{area:'Audit Area'},${J(TODAY)}); await app.fileManager.processFrontMatter(task.file,fm=>{fm.recurrence=${J('DTSTART:'+TODAY.replaceAll('-','')+';FREQ=DAILY')};}); return true;`);
    await until(()=>page.eval(`return !!(await app.plugins.plugins.tasknotes.cacheManager.getTaskInfo(${J(taskPath('Audit recurring bridge'))}))?.recurrence;`),'TaskNotes indexes the recurring fixture');
    await page.eval(`const p=app.plugins.plugins['focus-tasks'];p.forgetScan();await p.toggle(p.tasks().find(x=>x.text==='Audit recurring bridge'));return true;`);
    await taskIs('Audit recurring bridge',{status:'open',scheduled:TOMORROW});
    if (!fm('Audit recurring bridge').complete_instances?.includes(TODAY)) throw new Error('TaskNotes did not complete the intended occurrence');
    if (!fm('Audit recurring bridge').uid || fm('Audit recurring bridge').area !== 'Audit Area') throw new Error('TaskNotes lost Focus identity or area');
    await page.eval(`await app.fileManager.trashFile(app.vault.getAbstractFileByPath(${J(taskPath('Audit recurring bridge'))})); return true;`);
  }
});

step("commands are registered", async () => {
  const ids = await page.eval(`return Object.keys(app.commands.commands).filter((k) => k.startsWith('focus-tasks:')).sort()`);
  const want = ["add-area", "add-intent", "add-task", "area-from-note", "find", "fold-all", "open", "steps-blocks", "toggle-all", "undo", "unfold-all"].map((k) => "focus-tasks:" + k);
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

step("ideas are free notes, derive tasks, search by body and retain failed drafts", async () => { await checkIntentsUI(page); });
step("row controls share first-line centres in pane, area and project views", async () => {
  fs.mkdirSync(SHOTS,{recursive:true});
  await checkRowAlignment(page,TODAY,TOMORROW,SHOTS);
});

function buildVault() {
  fs.rmSync(VAULT, { recursive: true, force: true });
  const plug = path.join(VAULT, ".obsidian/plugins/focus-tasks");
  fs.mkdirSync(plug, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) {
    if (BASELINE) fs.writeFileSync(path.join(plug, f), execFileSync('git', ['show', `${BASELINE}:${f}`], { cwd: ROOT }));
    else fs.copyFileSync(path.join(ROOT, f), path.join(plug, f));
  }
  for (const c of companions) {
    const dir = path.join(VAULT, '.obsidian/plugins', c.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const file of ['main.js', 'manifest.json', 'styles.css']) {
      const source = path.join(c.source, file);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dir, file));
      else if (file !== 'styles.css') throw new Error(`missing companion file: ${source}`);
    }
    if (c.settings) fs.writeFileSync(path.join(dir, 'data.json'), J(c.settings));
  }
  fs.writeFileSync(path.join(VAULT, ".obsidian/app.json"), J({ nativeMenus: false, trashOption: "local", promptDelete: false, alwaysUpdateLinks: true }));
  if(THEME) {
    const name=path.basename(THEME),dir=path.join(VAULT,'.obsidian/themes',name);fs.mkdirSync(dir,{recursive:true});
    for(const file of ['theme.css','manifest.json'])fs.copyFileSync(path.join(THEME,file),path.join(dir,file));
    fs.writeFileSync(path.join(VAULT,'.obsidian/appearance.json'),J({cssTheme:name}));
  }
  fs.mkdirSync(path.join(VAULT, "Notes"));
  fs.writeFileSync(path.join(VAULT, "Notes/Running log.md"), "# Running log\n\nWeek 1: 12 km.\n");
  fs.writeFileSync(path.join(VAULT, "Notes/Home.md"), "# Home\n");
  fs.writeFileSync(path.join(VAULT, "Notes/Garden plan.md"), "# Garden plan\n");
}

const isTestWindow = (p) => p.title === `${NAME} - Obsidian` || p.title.includes(` - ${NAME} - Obsidian`) || p.title.startsWith(`${NAME} - Obsidian`);

step("calendar badges follow cloud receipts, project clocks and grouped rescheduling", async () => {
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.setEverything(true);const area=(await p.collect(true,true)).find(a=>a.name==='Audit Area');
    const project=await p.createProject(area,'Audit calendar project');await p.setProjectDate(project,${J(TOMORROW)});p.data.opened['steps:'+project.path]=false;await p.saveAll();
    for(const [name,projectName] of [['Audit calendar standalone',null],['Audit calendar step','Audit calendar project']]) {
      const task=await p.createTask(name,{area:'Audit Area',project:projectName},${J(TODAY)});await p.setScheduled(task,${J(TODAY)},'16:30');
    }await p.setOpen('area:Audit Area',true);return true;`);
  const names=['Audit calendar standalone','Audit calendar step'];
  for(const name of names)await until(()=>page.eval(`return !!__ft.task(${J(name)})`),'timed row '+name);
  if(await page.eval(`return ${J(names)}.some(n=>__ft.task(n)?.querySelector('.ft-calendar-status.is-synced'))`))throw new Error('a clock alone claims calendar success');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];window.__calendarReceipt={schema:2,contract:'focus-view-at-start-v1',enabled:true,connected:true,tasks:{}};
    for(const task of p.tasks().filter(t=>${J(names)}.includes(t.text)))__calendarReceipt.tasks[task.uid]={file:task.file.path,title:task.text,scheduled:task.date+'T'+task.at,waiting:false,status:'synced',checkedAt:new Date().toISOString()};
    for(const folder of ['Internals','Internals/FocusTasks'])if(!app.vault.getAbstractFileByPath(folder))await app.vault.createFolder(folder);
    window.__calendarWrite=async()=>{const path='Internals/FocusTasks/calendar-status.md',text=${J('---\ntype: focus-tasks-calendar-status\n---\n\n```json\n')}+JSON.stringify(__calendarReceipt)+${J('\n```\n')},file=app.vault.getAbstractFileByPath(path);if(file)await app.vault.modify(file,text);else await app.vault.create(path,text);};await __calendarWrite();return true;`);
  for(const name of names)await until(()=>page.eval(`return !!__ft.task(${J(name)})?.querySelector('.ft-calendar-status.is-synced')`),'confirmed event badge '+name);
  if(!await page.eval(`const row=__ft.task('Audit calendar step');return row.classList.contains('ft-project-row')&&row.querySelector('.ft-date-text')?.textContent.includes('16:30')`))throw new Error('project date hides the timed step and its reminder');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.setDates(p.tasks().filter(t=>${J(names)}.includes(t.text)),${J(TOMORROW)},'18:25');return true;`);
  for(const name of names)await until(()=>page.eval(`return !!__ft.task(${J(name)})?.querySelector('.ft-calendar-status.is-pending')`),'changed clock awaits new acknowledgement');
  await page.eval(`for(const receipt of Object.values(__calendarReceipt.tasks))receipt.scheduled=${J(TOMORROW+'T18:25')};await __calendarWrite();return true;`);
  for(const name of names)await until(()=>page.eval(`return !!__ft.task(${J(name)})?.querySelector('.ft-calendar-status.is-synced')`),'updated event is confirmed');
  const calendarSetting=async()=>page.eval(`app.setting.open();app.setting.openTabById('focus-tasks');await new Promise(r=>setTimeout(r,300));const row=[...app.setting.activeTab.containerEl.querySelectorAll('.setting-item')].find(r=>r.querySelector('.setting-item-name')?.textContent?.includes('Apple Calendar'));const text=row?.querySelector('.setting-item-description')?.textContent;app.setting.close();return text;`);
  if(!(await calendarSetting())?.startsWith('Connected.'))throw new Error('valid phone receipt is reported as a connection problem');
  await page.eval(`__calendarReceipt.connected=false;await __calendarWrite();return true;`);
  for(const name of names)await until(()=>page.eval(`return !!__ft.task(${J(name)})?.querySelector('.ft-calendar-status.is-error')`),'connection error never stays green');
  if(!(await calendarSetting())?.startsWith('Reminders have not synced yet.'))throw new Error('settings hide a Calendar connection failure');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.setDates(p.tasks().filter(t=>${J(names)}.includes(t.text)),${J(TOMORROW)},null);return true;`);
  for(const name of names)await until(()=>page.eval(`return !!__ft.task(${J(name)})&&!__ft.task(${J(name)}).querySelector('.ft-calendar-status')`),'removing time removes the badge');
  await idle();
  await page.eval(`const p=app.plugins.plugins['focus-tasks'],v=[...p.views].find(v=>v.rows().some(([el])=>el===__ft.task('Audit calendar standalone'))),rows=v.rows(),task=rows.find(([,t])=>t.text==='Audit calendar standalone')?.[1],project=rows.find(([,t])=>t.isProject&&t.text==='Audit calendar project')?.[1];if(!task||!project)throw new Error('mixed calendar selection missing');v.selected=new Set([task,project]);await v.editDate(task,__ft.task('Audit calendar standalone').querySelector('.ft-date'));return true;`);
  await until(()=>page.eval(`return !!document.querySelector('.ft-picker-save')`),'mixed project and task calendar');
  await click(`__ft.at(document.querySelector('.ft-picker .is-hh'))`);await page.type('19');await page.type('10');await click(`__ft.at(document.querySelector('.ft-picker-save'))`);
  await taskIs('Audit calendar standalone',{scheduled:TOMORROW+'T19:10'});
  if(!await page.eval(`return app.metadataCache.getFileCache(app.vault.getAbstractFileByPath('Tasks/Audit calendar project.md'))?.frontmatter?.scheduled===${J(TOMORROW)}`))throw new Error('group clock was applied to a project');
  await idle();await page.key('Meta+z');await taskIs('Audit calendar standalone',{scheduled:TOMORROW});
});

// Exercise the OS route with a link created before a rename and project move.
step("a Calendar UID link finds the renamed, moved and folded task without opening a note", async () => {
  const target=await page.eval(`if(app.vault.getName()!==${J(NAME)})throw new Error('wrong URI test vault');const p=app.plugins.plugins['focus-tasks'];
    const area=(await p.collect(true,true)).find(a=>a.name==='Audit Area'),project=await p.createProject(area,'UID destination project');
    const other=await p.createTask('Calendar duplicate name',{area:'Audit Area'},${J(TOMORROW)}),task=await p.createTask('Calendar duplicate name',{area:'Audit Area'},${J(TOMORROW)});
    await app.workspace.openLinkText(task.file.path,'','tab');return {uid:task.uid,file:task.file.path,otherUid:other.uid,project:project.path};`);
  await until(()=>page.eval(`return app.workspace.activeLeaf?.view?.file?.path===${J(target.file)}`),'start outside Focus');
  const before=await page.eval(`return app.workspace.getLeavesOfType('markdown').map(l=>l.id).sort();`);
  const python=process.env.FOCUS_CALENDAR_PYTHON || path.join(process.env.HOME,'ai-hub','.venv-calendar','bin','python');
  const code="import sys,datetime as dt;sys.path.insert(0,'bridge');from apple_calendar import Reminder,focus_url;print(focus_url(Reminder(sys.argv[2],'', 'Old task title',dt.datetime.now(dt.timezone.utc),False,sys.argv[1])))";
  const uri=execFileSync(python,['-c',code,NAME,target.uid],{cwd:ROOT,encoding:'utf8'}).trim();
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].tasks().some(t=>t.uid===${J(target.uid)})`),'URI target indexed');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.rename(p.tasks().find(t=>t.uid===${J(target.uid)}),'Renamed Calendar UID target');await p.setFields(p.tasks().find(t=>t.uid===${J(target.uid)}),{projects:['[[UID destination project]]'],scheduled:${J(TODAY)}});await p.setProjectDate(app.vault.getAbstractFileByPath(${J(target.project)}),${J(TOMORROW)});p.setEverything(false);p.data.folded['area:Audit Area']=true;delete p.data.opened['future:Audit Area'];p.data.opened['steps:'+${J(target.project)}]=false;p.saveFolds();p.refresh();return true;`);
  execFileSync('open',[uri]);
  await until(()=>page.eval(`const v=app.workspace.activeLeaf?.view;return v?.getViewType()==='focus-tasks-view'&&v.renderer?.rows().some(([el,t])=>t.uid===${J(target.uid)}&&el.classList.contains('is-selected'))`),'native URI selects renamed project step',15000);
  const after=await page.eval(`const v=app.workspace.activeLeaf.view.renderer,row=v.rows().find(([,t])=>t.uid===${J(target.uid)});if(row[1].text!=='Renamed Calendar UID target'||v.selected.size!==1||[...v.selected][0].uid!==${J(target.uid)})throw Error('wrong task selected');return app.workspace.getLeavesOfType('markdown').map(l=>l.id).sort();`);
  if(J(before)!==J(after))throw new Error('Calendar link created another note tab');
  if(await page.eval(`return app.plugins.plugins['focus-tasks'].openTask('missing-calendar-uid')`)!==false)throw new Error('missing task was treated as found');
  if(J(before)!==J(await page.eval(`return app.workspace.getLeavesOfType('markdown').map(l=>l.id).sort()`)))throw new Error('missing UID opened a note');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'],r=app.workspace.activeLeaf.view.renderer,task=p.tasks().find(t=>t.uid===${J(target.uid)}),el=r.rows().find(([,t])=>t.uid===task.uid)[0].querySelector('.ft-text'),before=await app.vault.read(task.file);
    await r.editInline(task,el,null);el.textContent='Unfinished Calendar link draft';el.dispatchEvent(new Event('input',{bubbles:true}));
    if(await p.openTask(${J(target.otherUid)})!==false||!r.editing||document.activeElement!==el||await app.vault.read(task.file)!==before)throw Error('UID navigation interrupted or saved an unfinished edit');await r.endEdit(false);return true;`);
});

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
  if(THEME)await until(()=>page.eval(`return app.customCss.theme===${J(path.basename(THEME))};`),'requested theme active');
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
    for (const id of ${J(companions.map(c => c.id))}) {
      await app.plugins.enablePluginAndSave(id);
      if (!app.plugins.plugins[id]) throw new Error('companion failed to load: ' + id);
      if (id === 'tasknotes') await app.plugins.plugins[id].api.lifecycle.ready();
    }
    // what is folded or opened is per device and outlives the vault: a run must not inherit it
    p.data.folded = {}; p.data.opened = {}; p.saveFolds();
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

let failed = 0, passed = 0;
try {
  await openVault();
  console.log(`Focus Tasks e2e in ${NAME}`);
  const available=args.includes('--audit-only') ? steps.slice(steps.findIndex(s=>s.name.startsWith("an area's own note"))) : steps;
  const match=args.indexOf('--match'),runSteps=match>=0?available.filter(s=>new RegExp(args[match+1]).test(s.name)):available;
  if(!runSteps.length)throw Error('no matching test scenarios');
  for (const [i, s] of runSteps.entries()) {
    try {
      await s.fn();
      passed++;
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
console.log(failed ? `\nFAILED` : `\nall ${passed} steps passed`);
process.exit(failed ? 1 : 0);
