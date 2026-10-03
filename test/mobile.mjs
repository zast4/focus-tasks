#!/usr/bin/env node
// The phone suite: the same plugin in Obsidian's own mobile emulation, driven with touch events on a
// phone-sized screen. It checks what a finger can reach and what a narrow screen does to the layout —
// the things the desktop suite cannot see.
//
// Needs Obsidian running with a DevTools port (any vault open):
//   open -a Obsidian --args --remote-debugging-port=9222
//   node test/mobile.mjs            (--keep leaves the vault and its window open)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Page, J, sleep, ymd, until } from "./cdp.mjs";
import { layoutFixture, checkLayoutMatrix, checkCurrentLayout, openLayoutContext } from "./mobile-layout.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const themeArg = args.indexOf("--theme");
const THEME = themeArg >= 0 ? path.resolve(args[themeArg + 1]) : null;
const baselineArg=args.indexOf('--baseline');
const BASELINE=baselineArg>=0?args[baselineArg+1]:null;
const tasksArg=args.indexOf('--with-tasks');
const TASKS=tasksArg<0?null:args[tasksArg+1]&&!args[tasksArg+1].startsWith('--')?path.resolve(args[tasksArg+1]):path.join(process.env.HOME,'vaults/Vault/.obsidian/plugins/obsidian-tasks-plugin');
const NAME = "focus-tasks-mobile";
const VAULT = path.join(ROOT, "test", NAME);
const SHOTS = path.join(ROOT, "test", "shots");
const TODAY = ymd(new Date());
const WIDTH = 390, HEIGHT = 844;  // iPhone 14
const MIN_TAP = 24;               // the smallest thing a finger should have to hit, in CSS px

let page, main;
const read = (rel) => { try { return fs.readFileSync(path.join(VAULT, rel), "utf8"); } catch { return null; } };
const fm = (name) => {
  const text = read(`Задачи/${name}.md`);
  if (!text?.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  const out = {};
  let list = null;
  for (const line of text.slice(4, end).split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && list) { out[list] = item[1].replace(/^["']|["']$/g, "").trim(); continue; }  // the first item is enough here
    const m = line.match(/^([a-zA-Zа-яА-Я_-]+):\s*(.*)$/);
    list = null;
    if (!m) continue;
    if (m[2].trim()) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    else list = m[1];
  }
  return out;
};
const taskIs = (name, fields, what) => until(() => {
  const f = fm(name);
  return f && Object.entries(fields).every(([k, v]) => (v === null ? f[k] === undefined : String(f[k] ?? "") === String(v)));
}, what || `${name}: ${J(fields)}`);

const at = (selector) => page.eval(`
  const el = ${selector};
  if (!el) return null;
  el.scrollIntoView({ block: 'center', behavior:'instant' });
  const r = el.getBoundingClientRect();
  const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2),hit=document.elementFromPoint(x,y);
  return r.width && r.height && hit && (hit===el||el.contains(hit)) ? {x,y} : null;`);
const tapOn = async (selector, what) => {
  await page.front();
  await page.eval(`(${selector})?.scrollIntoView({block:'center',behavior:'instant'});return true;`);
  await sleep(180);
  const point = await until(() => at(selector), what || selector);
  await page.tap(point);
};

// The right-hand end of an element: a tap there puts the caret after the last character.
const atEnd = (selector) => page.eval(`
  const el = ${selector};
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return r.width ? { x: Math.round(r.right - 2), y: Math.round(r.top + r.height / 2) } : null;`);

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

// Between steps: close whatever the on-screen keyboard left behind (Obsidian's own suggestion
// popup swallows the next tap) and let the list settle.
async function calm() {
  await page.key("Escape").catch(() => {});
  await page.eval(`
    document.activeElement?.blur?.();
    document.querySelectorAll('.suggestion-container, .suggestion-bg, .menu, .ft-picker').forEach((e) => e.remove());
    return true;`).catch(() => {});
  await sleep(350);
}

// --- the tests ----------------------------------------------------------------------------------

step("the plugin runs in Obsidian's mobile mode", async () => {
  const state = await page.eval(`return { mobile: document.body.classList.contains('is-mobile'), width: window.innerWidth,
    plugin: !!app.plugins.plugins['focus-tasks'], tasks:!!app.plugins.plugins['obsidian-tasks-plugin'], rows: __m.rows().length };`);
  if (!state.mobile) throw new Error("not in mobile mode: " + J(state));
  if (state.width > 500) throw new Error("the window is not phone-sized: " + state.width);
  if(state.tasks!==!!TASKS)throw new Error('Tasks companion does not match the requested composition: '+J(state));
  if (!state.rows) throw new Error("no task rows on screen");
});

step("nothing runs off the side of a phone screen", async () => {
  const over = await page.eval(`
    const view = document.querySelector('.focus-tasks-view');
    const wide = [...view.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
      .map((e) => e.className + ': ' + Math.round(e.getBoundingClientRect().right));
    return { scroll: view.scrollWidth, client: view.clientWidth, wide: wide.slice(0, 5) };`);
  if (over.scroll > over.client + 1) throw new Error("the list scrolls sideways: " + J(over));
  if (over.wide.length) throw new Error("these stick out: " + J(over.wide));
});

step("a checkbox, a grip and a date are big enough for a finger", async () => {
  const sizes = await page.eval(`
    const row = __m.rows()[0];
    const size = (sel) => { const e = row.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
    return { box: size('.ft-box'), grip: size('.ft-grip'), date: size('.ft-date') };`);
  for (const [what, size] of Object.entries(sizes)) {
    if (!size) throw new Error(`${what} is not on the row at all`);
    if (Math.min(...size) < MIN_TAP) throw new Error(`${what} is ${size.join("×")} — too small to tap`);
  }
});

step("the grip is visible without hovering", async () => {
  const shown = await page.eval(`
    const g = __m.rows()[0].querySelector('.ft-grip');
    return g ? Number(getComputedStyle(g).opacity) : 0;`);
  if (shown < 0.3) throw new Error("the grip is invisible on a phone: opacity " + shown);
});

step("a tap on the box completes the task and the day's closed block takes it", async () => {
  await page.eval(`const p = app.plugins.plugins['focus-tasks']; if (!p.doneShown()) p.setDoneShown(true); return true;`);
  await tapOn(`__m.task('Купить сметану').querySelector('input')`, "the box of Купить сметану");
  await taskIs("Купить сметану", { status: "done", completedDate: TODAY });
  await until(() => page.eval(`return !!__m.task('Купить сметану')?.closest('.ft-done-today')`), "the row moved to the closed block");
  await tapOn(`__m.task('Купить сметану').querySelector('input')`, "the box again");
  await taskIs("Купить сметану", { status: "open" });
});

step("a tap on the end of the text appends to it", async () => {
  const end = await until(() => atEnd(`__m.task('Позвонить маме').querySelector('.ft-text')`), "the end of the text");
  await page.tap(end);
  await until(() => page.eval(`return !!document.querySelector('.ft-text.is-editing')`), "an editor opened");
  await page.type(" сегодня");
  await page.eval(`document.querySelectorAll('.suggestion-container, .suggestion-bg').forEach((e) => e.remove()); return true;`);
  await page.key("Enter");   // saves and opens an empty row under it, as on the desktop
  await until(() => fm("Позвонить маме сегодня") !== null, "the note was renamed to the new text");
  await page.key("Escape");
  await until(() => page.eval(`return !document.querySelector('.ft-text.is-editing')`), "the empty row was dropped");
});

step("a tap on the grip opens the row's menu", async () => {
  // A long press is Obsidian's own gesture and synthetic touches do not trigger it, so the phone way
  // into a row's menu is the grip — and that must work with a finger, not only with a mouse.
  const point = await until(() => at(`__m.task('Сходить в зал').querySelector('.ft-grip')`), "the grip of Сходить в зал");
  const before = await page.eval(`return { bg: !!document.querySelector('.suggestion-bg'), editing: !!document.querySelector('.ft-text.is-editing'),
    active: document.activeElement?.className || document.activeElement?.tagName };`);
  if (before.bg || before.editing) throw new Error("the phone keyboard was still up before this step: " + J(before));
  await page.eval(`window.__tapped = []; for (const t of ['pointerdown', 'pointerup', 'click', 'pointercancel'])
    document.addEventListener(t, (e) => window.__tapped.push(t + '→' + (e.target.className || e.target.tagName)), true); return true;`);
  await page.tap(point);
  await sleep(500);
  const what = await page.eval(`return { menu: !!document.querySelector('.menu'), items: [...document.querySelectorAll('.menu-item-title')].map((e) => e.textContent.trim()),
    overlays: [...document.body.children].map((e) => e.className).filter((c) => typeof c === 'string' && c && !c.includes('app-container')) };`);
  if (!what.items.length) throw new Error("no menu after tapping the grip: " + J(what));
  if (!what.items.includes("Сегодня")) throw new Error("the task menu is not the one that opened: " + J(what.items));
  await page.key("Escape");
  await until(() => page.eval(`return !document.querySelector('.menu')`), "the menu closed");
});

step("the date picker fits the screen and sets a date by tap", async () => {
  await tapOn(`__m.task('Сходить в зал').querySelector('.ft-date')`, "the date of Сходить в зал");
  const box = await until(() => page.eval(`
    const p = document.querySelector('.ft-picker');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: window.innerWidth, h: window.innerHeight };`), "the picker");
  if (box.left < 0 || box.right > box.w) throw new Error("the picker hangs off the side: " + J(box));
  if (box.top < 0 || box.bottom > box.h) throw new Error("the picker hangs off the bottom: " + J(box));
  await page.type("сегодня");
  await page.key("Enter");
  await taskIs("Сходить в зал", { scheduled: TODAY });
});

step("a finger drags a task into a project", async () => {
  // the plain focus is flat, with no project headers to drop onto: the tree is in «All»
  await page.eval(`const p = app.plugins.plugins['focus-tasks']; window.__wasAll = p.everything(); p.setEverything(true); return true;`);
  await until(() => at(`__m.task('Позвонить маме сегодня').querySelector('.ft-grip')`), "the grip");
  await until(() => at(`__m.project('Ремонт')`), "the project header");
  await sleep(180);
  const {from,onto}=await page.eval(`const point=e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};};
    return {from:point(__m.task('Позвонить маме сегодня').querySelector('.ft-grip')),onto:point(__m.project('Ремонт'))};`);
  await page.eval(`window.__drag = []; for (const t of ['pointerdown','pointermove','pointerup','pointercancel','touchcancel'])
    window.addEventListener(t, (e) => window.__drag.push(t), true); return true;`);
  // the swipe, step by step, so the state mid-drag is visible
  await page.touch("touchStart", [from]);
  for (let k = 1; k <= 12; k++) {
    await page.touch("touchMove", [{ x: from.x + ((onto.x - from.x) * k) / 12, y: from.y + ((onto.y - from.y) * k) / 12 }]);
    await sleep(30);
  }
  const mid = await page.eval(`return { dragging: !!document.querySelector('.ft-dragging'), line: document.querySelector('.ft-drop-line')?.style.display,
    into: !!document.querySelector('.ft-drop-into'), events: window.__drag.join(',') };`);
  await page.touch("touchEnd", []);
  await sleep(400);
  if (!mid.dragging) throw new Error("the row never started dragging: " + J(mid));
  const sidebar = await page.eval(`return !!document.querySelector('.mod-left-split.is-sidedock-collapsed') === false && !!document.querySelector('.workspace-drawer.mod-left.is-open')`);
  if (sidebar) throw new Error("the drag opened Obsidian's sidebar instead of moving the row");
  await taskIs("Позвонить маме сегодня", { projects: "[[Ремонт]]" },
    "the task went into the project; it landed on " + J(await page.eval(`
      const e = document.elementFromPoint(${onto.x}, ${onto.y});
      return { hit: e && (e.className || e.tagName), marked: !!document.querySelector('.ft-drop-into'),
               line: (document.querySelector('.ft-drop-line') || {}).style?.display };`)));
  await page.eval(`app.plugins.plugins['focus-tasks'].setEverything(window.__wasAll); return true;`);
});

step("«+» on an area adds a task with the on-screen keyboard", async () => {
  await tapOn(`__m.areaTitle('🧤Рутина').querySelector('.ft-plus')`, "«+» of Рутина");
  await until(() => page.eval(`return !!document.querySelector('.ft-text.is-editing')`), "an empty row is being typed");
  await page.type("Помыть окна");
  await page.key("Enter");
  await until(() => fm("Помыть окна") !== null, "the note was made");
  await page.key("Escape");
  await taskIs("Помыть окна", { area: "🧤Рутина", scheduled: TODAY });
});

step("the ⏳ on an area's header opens its upcoming work, by finger", async () => {
  // the counter lives on the header now, among ▷ and ✓ — there is no grey row under the list
  await tapOn(`__m.all('.ft-area-title .ft-later-chip')[0]`, "the ⏳ of the area");
  await until(() => page.eval(`return !!__m.task('Разобрать кладовку')`), "the undated task is on screen");
  await tapOn(`__m.all('.ft-area-title .ft-later-chip')[0]`, "the ⏳ again");
  await until(() => page.eval(`return !__m.task('Разобрать кладовку')`), "hidden again");
});

step("the bottom buttons are reachable and readable", async () => {
  const foot = await page.eval(`
    const b = [...document.querySelectorAll('.ft-foot-button')].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), h: Math.round(r.height), w: Math.round(r.width) }; });
    return b;`);
  if (!foot.length) throw new Error("no buttons at the bottom");
  const small = foot.filter((b) => b.h < MIN_TAP);
  if (small.length) throw new Error("too small to tap: " + J(small));
});

step("ticking a box does not throw the phone screen around", async () => {
  await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    for (let i = 0; i < 20; i++) await p.createTask('Строка ' + i, { area: '🧤Рутина', project: null }, ${J(TODAY)});
    p.refresh(); return true;`);
  await sleep(900);
  const place = await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    const view = [...p.views][0];
    const s = view.scroller;
    s.scrollTop = Math.round(s.scrollHeight / 2);
    await new Promise((r) => setTimeout(r, 400));
    const top = s.getBoundingClientRect().top;
    const name = (r) => r.querySelector('.ft-text').textContent.trim();
    const rows = [...view.containerEl.querySelectorAll('li.ft-task')].filter((r) => { const y = r.getBoundingClientRect().top; return y > top + 10 && y < top + s.clientHeight - 80; });
    if (rows.length < 3) return { error: 'only ' + rows.length + ' rows on screen' };
    const b = rows[1].querySelector('input').getBoundingClientRect();
    return { tick: name(rows[1]), mark: name(rows[rows.length - 1]), markY: Math.round(rows[rows.length - 1].getBoundingClientRect().top),
      point: { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } };`);
  if (place.error) throw new Error("the phone list could not be measured: " + place.error);
  await page.tap(place.point);
  await taskIs(place.tick, { status: "done" });
  await sleep(1200);
  const moved = await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    const view = [...p.views][0];
    const row = [...view.containerEl.querySelectorAll('li.ft-task')].find((r) => r.querySelector('.ft-text').textContent.trim() === ${J(place.mark)});
    return row ? Math.round(row.getBoundingClientRect().top) : null;`);
  if (moved === null) throw new Error("the row that was on screen is gone: " + J(place));
  if (Math.abs(moved - place.markY) > 3) throw new Error(`the screen jumped by ${Math.abs(moved - place.markY)}px when a box was tapped`);
  await page.eval(`
    const p = app.plugins.plugins['focus-tasks'];
    for (const task of p.tasks()) if (task.text.startsWith('Строка ')) await p.trash(task.file);
    p.refresh(); return true;`);
  await sleep(600);
});

step("a picture of the list on a phone, for the record", async () => {
  await page.eval(`app.plugins.plugins['focus-tasks'].refresh(); return true;`);
  await sleep(600);
  await page.shot(path.join(SHOTS, "phone.png"));
});

step("project context is above its first step on 320, 390 and 430px screens", async () => {
  await page.eval(`const p=app.plugins.plugins['focus-tasks']; p.data.opened['steps:Areas/Ремонт.md']=false; p.saveFolds(); p.refresh(); return true;`);
  for (const width of [320, 390, 430]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
    await sleep(300);
    const state=await page.eval(`const row=__m.project('Ремонт'); const caption=row?.querySelector('.ft-mobile-project-caption'); const text=row?.querySelector('.ft-text');
      if(!caption||!text) return null; const c=caption.getBoundingClientRect(), t=text.getBoundingClientRect();
      return { captionBottom:c.bottom, taskTop:t.top, textWidth:t.width, rowRight:row.getBoundingClientRect().right, screen:innerWidth };`);
    if (!state || state.captionBottom>state.taskTop+2 || state.textWidth<100 || state.rowRight>state.screen)
      throw new Error('project layout at '+width+': '+J(state));
  }
  await page.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
  await page.shot(path.join(SHOTS, 'focus-tasks-mobile-projects.png'));
});

step("offline capture writes the task immediately and survives a plugin reload", async () => {
  await page.send('Network.enable');
  await page.send('Network.emulateNetworkConditions', { offline:true, latency:0, downloadThroughput:0, uploadThroughput:0 });
  try {
    await tapOn(`__m.areaTitle('🧤Рутина').querySelector('.ft-plus')`, 'add offline');
    await until(() => page.eval(`return !!document.querySelector('.ft-text.is-editing')`), 'offline editor');
    await page.type('Офлайн покупка');
    await page.key('Enter');
    await page.key('Escape');
    await taskIs('Офлайн покупка', { area:'🧤Рутина', scheduled:TODAY, status:'open' });
    const uid=fm('Офлайн покупка').uid;
    await page.eval(`await app.plugins.disablePlugin('focus-tasks'); await app.plugins.enablePlugin('focus-tasks'); return true;`);
    await taskIs('Офлайн покупка', { uid, status:'open' });
    await until(() => page.eval(`return !!document.querySelector('.focus-tasks-pane .focus-tasks-view')`), 'offline view after reload');
  } finally { await page.send('Network.emulateNetworkConditions', { offline:false, latency:0, downloadThroughput:-1, uploadThroughput:-1 }); }
});

step("phone area and project pages accept undated tasks offline", async () => {
  await page.send('Network.enable');
  await page.send('Network.emulateNetworkConditions', { offline:true, latency:0, downloadThroughput:0, uploadThroughput:0 });
  try {
    for (const local of [
      { path:'Areas/Рутина.md', root:'.ft-area-page', text:'Офлайн внутри области', area:'🧤Рутина' },
      { path:'Areas/Ремонт.md', root:'.ft-page', text:'Офлайн внутри проекта', area:'🏡Дом', project:'[[Ремонт]]' },
    ]) {
      await page.eval(`const p=app.plugins.plugins['focus-tasks']; const file=app.vault.getAbstractFileByPath(${J(local.path)}); await p.${local.project?'ensureStepsBlock':'ensureAreaBlock'}(file);const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});app.workspace.setActiveLeaf(leaf,{focus:true});return true;`);
      await until(()=>page.eval(`return [...document.querySelectorAll(${J(local.root)})].some(e=>e.getClientRects().length && e.querySelector('.ft-plus'));`),'visible local page');
      await tapOn(`([...document.querySelectorAll(${J(local.root)})].find(e=>e.getClientRects().length))?.querySelector('.ft-plus')`,'local add offline');
      await until(()=>page.eval(`return [...document.querySelectorAll('.ft-text.is-editing')].some(e=>e.getClientRects().length);`),'local offline editor');
      await page.type(local.text); await page.key('Enter'); await page.key('Escape');
      await taskIs(local.text,{area:local.area,scheduled:null,...(local.project?{projects:local.project}:{})});
    }
    await page.eval(`await app.plugins.disablePlugin('focus-tasks');await app.plugins.enablePlugin('focus-tasks');await app.commands.executeCommandById('focus-tasks:open');return true;`);
    await taskIs('Офлайн внутри области',{scheduled:null,status:'open'});
    await taskIs('Офлайн внутри проекта',{scheduled:null,status:'open',projects:'[[Ремонт]]'});
  } finally {
    await page.send('Network.emulateNetworkConditions', {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  }
});

step("local area projects and expanded steps are flat on 320, 390 and 430px screens", async () => {
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];const note=app.vault.getAbstractFileByPath('Areas/Дом.md');
    await p.ensureAreaBlock(note);await p.createTask('Отдельная задача области',{area:'🏡Дом'},null);
    await p.setOpen('steps:Areas/Ремонт.md',true);const leaf=app.workspace.getLeaf('tab');
    await leaf.setViewState({type:'markdown',state:{file:note.path,mode:'preview'}});app.workspace.setActiveLeaf(leaf,{focus:true});return true;`);
  await until(()=>page.eval(`const root=[...document.querySelectorAll('.ft-area-page')].find(e=>e.getClientRects().length);return root?.querySelectorAll('.ft-steps li.ft-task').length>=2;`),'expanded project inside the local area');
  for (const width of [320,390,430]) {
    await page.send('Emulation.setDeviceMetricsOverride',{width,height:HEIGHT,deviceScaleFactor:2,mobile:true});
    await sleep(300);
    const state=await page.eval(`const root=[...document.querySelectorAll('.ft-area-page')].find(e=>e.getClientRects().length);const left=root.getBoundingClientRect().left;
      return {screen:innerWidth,rows:[...root.querySelectorAll('li.ft-task')].map(e=>({text:e.textContent,left:e.getBoundingClientRect().left-left,right:e.getBoundingClientRect().right,gripLeft:e.querySelector(':scope > .ft-grip')?.getBoundingClientRect().left}))};`);
    if(state.rows.length<3 || state.rows.some(r=>Math.abs(r.left-state.rows[0].left)>1 || r.right>state.screen+1 || r.gripLeft<0))
      throw new Error('local area layout at '+width+': '+J(state));
    if(width===390)await page.shot(path.join(SHOTS,'focus-tasks-mobile-area-flat.png'));
  }
  await page.send('Emulation.setDeviceMetricsOverride',{width:WIDTH,height:HEIGHT,deviceScaleFactor:2,mobile:true});
  await tapOn(`([...document.querySelectorAll('.ft-area-page')].find(e=>e.getClientRects().length))?.querySelector('li.ft-task:not(.ft-project-row) > .ft-grip')`,'flat area task grip');
  await until(()=>page.eval(`return !!document.querySelector('.menu');`),'task menu from the local area grip');
});

step("local project grips stay reachable on 320, 390 and 430px screens", async () => {
  await page.eval(`const file=app.vault.getAbstractFileByPath('Areas/Ремонт.md');const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});app.workspace.setActiveLeaf(leaf,{focus:true});return true;`);
  await until(()=>page.eval(`return [...document.querySelectorAll('.ft-page')].some(e=>e.getClientRects().length&&e.querySelector('li.ft-task'));`),'project page with tasks');
  for(const width of [320,390,430]) {
    await page.send('Emulation.setDeviceMetricsOverride',{width,height:HEIGHT,deviceScaleFactor:2,mobile:true});await sleep(300);
    const rows=await page.eval(`const root=[...document.querySelectorAll('.ft-page')].find(e=>e.getClientRects().length);return [...root.querySelectorAll('li.ft-task')].map(e=>({left:e.querySelector(':scope > .ft-grip').getBoundingClientRect().left,right:e.getBoundingClientRect().right}));`);
    if(!rows.length||rows.some(r=>r.left<0||r.right>width+1))throw new Error('project grip outside '+width+'px screen: '+J(rows));
  }
  await page.send('Emulation.setDeviceMetricsOverride',{width:WIDTH,height:HEIGHT,deviceScaleFactor:2,mobile:true});
  await tapOn(`([...document.querySelectorAll('.ft-page')].find(e=>e.getClientRects().length))?.querySelector('li.ft-task > .ft-grip')`,'local project task grip');
  await until(()=>page.eval(`return !!document.querySelector('.menu');`),'task menu from the project page grip');
});

for (const context of ["embedded-focus", "pane", "area", "project"]) {
  step("shared phone columns, text width and touch targets: " + context, async () => {
    await layoutFixture(page, TODAY);
    await openLayoutContext(page, context);
    await checkLayoutMatrix(page, context, SHOTS);
  });
}

step("mobile metadata and project controls respond to touch without opening an editor", async () => {
  await openLayoutContext(page, "embedded-focus");
  await page.send('Emulation.setDeviceMetricsOverride', {width:390,height:HEIGHT,deviceScaleFactor:2,mobile:true});
  await tapOn(`window.__layoutRoot()?.querySelector('li.ft-mobile-project .ft-date')`, 'project first step date');
  await until(()=>page.eval(`return !!document.querySelector('.ft-picker');`),'date picker from mobile metadata');
  if(await page.eval(`return !!document.querySelector('.ft-text.is-editing');`))throw new Error('date tap opened editor');
  await calm();
  await tapOn(`window.__layoutRoot()?.querySelector('li.ft-mobile-project .ft-steps-more')`, 'project expansion');
  await until(()=>page.eval(`return !!window.__layoutRoot()?.querySelector('li.ft-project-row.is-open');`),'expanded project from its caption');
  await checkLayoutMatrix(page, "embedded-focus-expanded", SHOTS);
  await tapOn(`([...window.__layoutRoot().querySelectorAll('li.ft-task')].find(e=>e.querySelector('.ft-text')?.textContent.includes('Решить, когда летим'))) ?.querySelector('.ft-running')`, 'return waiting task');
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].tasks().find(t=>t.uid==='ft-ui-3')?.status==='open';`),'waiting control changes the fixture status');
  if(await page.eval(`return !!document.querySelector('.ft-text.is-editing');`))throw new Error('waiting control opened editor');
});

step("mobile long text stays readable while editing and Escape saves without changing task properties", async () => {
  await openLayoutContext(page,'embedded-focus');
  await page.send('Emulation.setDeviceMetricsOverride',{width:320,height:HEIGHT,deviceScaleFactor:2,mobile:true});
  await page.eval(`window.__layoutRoot().style.fontSize='26px';return true;`);await sleep(250);
  await tapOn(`([...window.__layoutRoot().querySelectorAll('li.ft-task')].find(e=>e.querySelector('.ft-text')?.textContent.includes('Пройти часть 2'))) ?.querySelector('.ft-text')`, 'edit project first action');
  await until(()=>page.eval(`return !!document.querySelector('.ft-text.is-editing');`),'mobile project editor');
  await page.type(' '+ 'длиннаяссылка'.repeat(8));
  const edited=await page.eval(`return document.querySelector('.ft-text.is-editing').textContent.replace(/\\s+/g,' ').trim();`);
  await checkCurrentLayout(page,'embedded-focus-editing-320-26',SHOTS);
  if(!await page.eval(`return !!document.querySelector('.ft-text.is-editing');`))throw new Error('fixture editor lost focus before Escape');
  await page.key('Escape');
  await until(()=>page.eval(`return !document.querySelector('.ft-text.is-editing');`),'editor cancelled');
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].tasks().find(t=>t.uid==='ft-ui-0')?.text===${J(edited)};`),'Escape saves the edited title');
  const task=await page.eval(`const t=app.plugins.plugins['focus-tasks'].tasks().find(t=>t.uid==='ft-ui-0');return {status:t.status,date:t.date,project:t.project};`);
  const late=ymd(new Date(new Date(TODAY+'T12:00:00').getTime()-6*86400000));
  if(task.status!=='open'||task.date!==late||task.project!=='Пройти учебный курс UI')throw new Error('editing changed task properties: '+J(task));
});

step("mobile long text draft uses the same columns and can be cancelled", async () => {
  await openLayoutContext(page,'area');
  await page.send('Emulation.setDeviceMetricsOverride',{width:320,height:HEIGHT,deviceScaleFactor:2,mobile:true});
  await page.eval(`window.__layoutRoot().style.fontSize='26px';return true;`);await sleep(200);
  await tapOn(`window.__layoutRoot().querySelector('.ft-area-page-head > .ft-plus')`,'add a long local draft');
  await until(()=>page.eval(`return !!document.querySelector('.ft-draft-row .ft-text.is-editing');`),'draft editor');
  await page.type('Черновик '+ 'неразрывноеслово'.repeat(6));
  await checkCurrentLayout(page,'area-draft-320-26',SHOTS);
  await page.eval(`const el=document.querySelector('.ft-draft-row .ft-text.is-editing');if(!el)throw new Error('draft lost focus');
    const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);return true;`);
  await page.key('Backspace');
  if(await page.eval(`return !!document.querySelector('.ft-draft-row .ft-text.is-editing')?.textContent;`))throw new Error('draft was not cleared');
  await page.key('Escape');
  await until(()=>page.eval(`return !document.querySelector('.ft-draft-row .ft-text.is-editing');`),'draft cancelled');
  if(await page.eval(`return app.plugins.plugins['focus-tasks'].tasks().some(t=>t.text.startsWith('Черновик '));`))throw new Error('cancelled draft created a task');
});

step("mobile metadata completion keeps the next project action in place when the project folds", async () => {
  await openLayoutContext(page,'pane');
  await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:HEIGHT,deviceScaleFactor:2,mobile:true});
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];p.data.opened['steps:Areas/Пройти учебный курс UI.md']=true;
    p.data.folded['area:🧤Рутина']=false;p.data.order.areas=['🧤Рутина','👨‍💻IT UI','🏡Дом'];p.saveFolds();p.refresh();return true;`);
  await until(()=>page.eval(`return !!window.__layoutRoot()?.querySelector('li.ft-steps');`),'expanded steps before completion');
  await page.front();
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];const v=[...p.views].find(v=>v.containerEl===window.__layoutRoot());
    const row=v.rows().find(([,t])=>t.uid==='ft-ui-0')[0];const s=v.scroller;
    window.__scrollTrace=[];const keep=v.keepPlace.bind(v);v.keepPlace=a=>{const before=s.scrollTop;keep(a);window.__scrollTrace.push({anchor:a,before,after:s.scrollTop});};
    s.scrollTop+=row.getBoundingClientRect().top-s.getBoundingClientRect().top-60;return true;`);await sleep(400);
  const before=await page.eval(`const p=app.plugins.plugins['focus-tasks'];const v=[...p.views].find(v=>v.containerEl===window.__layoutRoot());
    const rect=uid=>v.rows().find(([,t])=>t.uid===uid)[0].querySelector('.ft-box').getBoundingClientRect();
    const a=rect('ft-ui-0'),b=rect('ft-ui-1');const x=a.left+a.width/2,y=a.top+a.height/2;
    return {point:{x,y},nextY:b.top,hit:!!document.elementFromPoint(x,y)?.closest('.ft-box'),scroll:v.scroller.scrollTop};`);
  if(!before.hit||before.scroll<1)throw new Error('completion fixture not ready: '+J(before));
  await page.tap(before.point);
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].tasks().find(t=>t.uid==='ft-ui-0')?.status==='done';`),'first project step done');
  await sleep(1200);
  const after=await page.eval(`const p=app.plugins.plugins['focus-tasks'];const v=[...p.views].find(v=>v.containerEl===window.__layoutRoot());
    const row=v.rows().find(([el,t])=>t.uid==='ft-ui-1'||v.items.get(el)?.task?.uid==='ft-ui-1');return row?.[0].querySelector('.ft-box').getBoundingClientRect().top;`);
  if(after==null||Math.abs(after-before.nextY)>3)throw new Error('next project action jumped: '+J({before:before.nextY,after,scroll:before.scroll,trace:await page.eval('return window.__scrollTrace;')}));
  await checkCurrentLayout(page,'pane-after-project-completion',SHOTS);
});

step("no errors from the plugin in the console", async () => {
  const mine = page.errors.filter((e) => /focus-tasks/.test(e) || /ft-/.test(e));
  if (mine.length) throw new Error(mine.join("\n"));
});

// --- the vault and the window ---------------------------------------------------------------------

function buildVault() {
  fs.rmSync(VAULT, { recursive: true, force: true });
  const plug = path.join(VAULT, ".obsidian/plugins/focus-tasks");
  fs.mkdirSync(plug, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) {
    if(BASELINE)fs.writeFileSync(path.join(plug,f),execFileSync('git',['show',BASELINE+':'+f],{cwd:ROOT}));
    else fs.copyFileSync(path.join(ROOT, f), path.join(plug, f));
  }
  if(TASKS) {
    const target=path.join(VAULT,'.obsidian/plugins/obsidian-tasks-plugin');fs.mkdirSync(target,{recursive:true});
    for(const file of ['main.js','manifest.json','styles.css'])fs.copyFileSync(path.join(TASKS,file),path.join(target,file));
    fs.writeFileSync(path.join(target,'data.json'),J({}));
  }
  fs.writeFileSync(path.join(VAULT, ".obsidian/app.json"), J({ nativeMenus: false, trashOption: "local", promptDelete: false, alwaysUpdateLinks: true }));
  fs.writeFileSync(path.join(VAULT, '.obsidian/appearance.json'), J({theme:'obsidian',baseFontSize:16,cssTheme:THEME?'Layout fixture':''}));
  if(THEME) {
    const target=path.join(VAULT,'.obsidian/themes/Layout fixture');fs.mkdirSync(target,{recursive:true});
    fs.copyFileSync(path.join(THEME,'theme.css'),path.join(target,'theme.css'));
    fs.writeFileSync(path.join(target,'manifest.json'),J({name:'Layout fixture',version:'1.0.0',minAppVersion:'1.0.0',author:'Mobile test fixture'}));
  }
  const note = (rel, front, body = "") => fs.writeFileSync(path.join(VAULT, rel), `---\n${front}\n---\n${body}`);
  fs.mkdirSync(path.join(VAULT, "Areas"));
  fs.mkdirSync(path.join(VAULT, "Задачи"));
  note("Areas/Рутина.md", 'area: "🧤Рутина"\ntype: область');
  note("Areas/Дом.md", 'area: "🏡Дом"\ntype: область');
  note("Areas/Ремонт.md", 'area: "🏡Дом"\ntype: проект');
  const task = (name, front) => note(`Задачи/${name}.md`, `uid: ft-m${name.length}${name.charCodeAt(0)}\ntype: задача\nstatus: open\n${front}`);
  task("Купить сметану", `area: "🧤Рутина"\nscheduled: ${TODAY}`);
  task("Позвонить маме", `area: "🧤Рутина"\nscheduled: ${TODAY}`);
  task("Сходить в зал", `area: "🧤Рутина"\nscheduled: ${TODAY}`);
  task("Разобрать кладовку", `area: "🧤Рутина"`);   // no date: it lives in the upcoming block
  task("Поменять смеситель", `area: "🏡Дом"\nprojects:\n  - "[[Ремонт]]"\nscheduled: ${TODAY}`);
}

const HELPERS = `
window.__m = {
  view() { return document.querySelector('.focus-tasks-view'); },
  all(sel) { return [...this.view().querySelectorAll(sel)].filter((e) => e.getClientRects().length); },
  rows() { return this.all('li.ft-task'); },
  task(n) { return this.rows().find((e) => e.querySelector('.ft-text')?.textContent.trim() === n); },
  project(n) { return this.all('li.ft-project-row').find((e) => e.querySelector('.ft-link')?.textContent.includes(n)); },
  areaTitle(n) { return this.all('.ft-area-title').find((e) => e.textContent.includes(n.replace(/^[^\\p{L}]+/u, '')) || e.textContent.includes(n)); },
  text(sel, t) { return [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === t); },
};`;

const isTestWindow = (p) => p.title.includes(NAME);

async function openVault() {
  for (const p of (await Page.list()).filter(isTestWindow)) {
    await (await Page.connect((x) => x.id === p.id)).close();
    await until(async () => !(await Page.list()).some((x) => x.id === p.id), "the old window to close", 15000);
    await sleep(2000);
  }
  buildVault();
  main = await Page.connect((p) => !isTestWindow(p));
  if (!main) throw new Error(`no Obsidian on 127.0.0.1 — start it with --remote-debugging-port=9222`);
  const r = await main.eval(`return require('electron').ipcRenderer.sendSync('vault-open', ${J(VAULT)}, false);`);
  if (r !== true) throw new Error("vault-open: " + J(r));
  page = await until(() => Page.connect(isTestWindow), "the test window", 20000);
  await page.send("Runtime.enable");
  await page.front();
  await until(() => page.eval(`return !!(window.app && app.workspace.layoutReady)`), "layout ready", 20000);
  await page.eval(`
    document.querySelectorAll('.modal-close-button').forEach((b) => b.click());
    await app.plugins.setEnable(true);
    await app.plugins.loadManifests();
    if(${J(!!TASKS)})await app.plugins.enablePluginAndSave('obsidian-tasks-plugin');
    await app.plugins.enablePluginAndSave('focus-tasks');
    const p = app.plugins.plugins['focus-tasks'];
    p.settings.language = 'ru'; p.applyLanguage();
    p.settings.folder = 'Areas'; p.settings.tasksFolder = 'Задачи';
    p.settings.typeArea = 'область'; p.settings.typeProject = 'проект';
    await p.saveAll();
    return true;`);
  // A phone screen, and Obsidian's own mobile build: it reloads the window, so reconnect after it.
  await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await page.eval(`app.emulateMobile(true); return true;`).catch(() => {});
  await sleep(4000);
  page = await until(async () => {
    const p = await Page.connect(isTestWindow);
    if (!p) return null;
    const ready = await p.eval(`return !!(window.app && app.workspace.layoutReady && document.body.classList.contains('is-mobile'))`).catch(() => false);
    return ready ? p : null;
  }, "the window back in mobile mode", 40000);
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await page.front();
  // the mobile build starts in restricted mode again: turn the plugin back on there
  await page.eval(`
    document.querySelectorAll('.modal-close-button').forEach((b) => b.click());
    [...document.querySelectorAll('.modal button')].find((b) => /Trust author|Доверять/i.test(b.textContent))?.click();
    await app.plugins.setEnable(true);
    await app.plugins.loadManifests();
    if(${J(!!TASKS)})await app.plugins.enablePluginAndSave('obsidian-tasks-plugin');
    await app.plugins.enablePluginAndSave('focus-tasks');
    const p = app.plugins.plugins['focus-tasks'];
    p.settings.language = 'ru'; p.applyLanguage();
    p.settings.folder = 'Areas'; p.settings.tasksFolder = 'Задачи';
    p.settings.typeArea = 'область'; p.settings.typeProject = 'проект';
    await p.saveAll();
    return true;`);
  await until(() => page.eval(`return !!app.plugins.plugins['focus-tasks']`), "the plugin is on in mobile mode", 20000);
  await page.eval(`await app.commands.executeCommandById('focus-tasks:open'); return true;`);
  await until(() => page.eval(`return !!document.querySelector('.focus-tasks-view li.ft-task')`), "the list is on screen", 20000);
  await page.eval(HELPERS + " return true;");
}

async function closeVault() {
  if (!page) return;
  // Mobile emulation is a setting of the whole app, not of this window: leaving it on would make the
  // desktop suite test the phone build. It always goes back off, even with --keep.
  await page.eval(`app.emulateMobile(false); return true;`).catch(() => {});
  await sleep(3000);
  if (KEEP) return;
  const last = await Page.connect(isTestWindow);
  if (last) await last.close();
  await main?.eval(`require('electron').ipcRenderer.sendSync('vault-remove', ${J(VAULT)}); return true;`).catch(() => {});
  fs.rmSync(VAULT, { recursive: true, force: true });
}

fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const selectedSteps=args.includes('--layout-only')?steps.filter(({name})=>/shared phone|mobile metadata|mobile long text/.test(name)):steps;
try {
  await openVault();
  for (const [i, { name, fn }] of selectedSteps.entries()) {
    try {
      await calm();
      await fn();
      console.log("  ✓ " + name);
    } catch (e) {
      failed++;
      console.log("  ✗ " + name + "\n      " + e.message);
      await page.shot(path.join(SHOTS, `${NAME}-${i}.png`)).catch(() => {});
    }
  }
} catch (e) {
  failed++;
  console.log("  ✗ setup\n      " + e.message);
} finally {
  await closeVault().catch(() => {});
}
console.log(failed ? `\n${failed} failed of ${selectedSteps.length}` : `\nall ${selectedSteps.length} phone steps passed`);
process.exit(failed ? 1 : 0);
