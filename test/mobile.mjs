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
import { Page, J, sleep, ymd, until } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
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
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return r.width && r.height ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;`);
const tapOn = async (selector, what) => {
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
    plugin: !!app.plugins.plugins['focus-tasks'], rows: __m.rows().length };`);
  if (!state.mobile) throw new Error("not in mobile mode: " + J(state));
  if (state.width > 500) throw new Error("the window is not phone-sized: " + state.width);
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

step("a tap on the box completes the task and the area's «Выполненные» takes it", async () => {
  await tapOn(`__m.task('Купить сметану').querySelector('input')`, "the box of Купить сметану");
  await taskIs("Купить сметану", { status: "done", completedDate: TODAY });
  await until(() => page.eval(`return !!__m.task('Купить сметану')?.closest('.ft-done-block')`), "the row moved to Completed");
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
  await tapOn(`__m.text('.ft-picker-today', 'Сегодня') || __m.text('.ft-picker-today', 'Today')`, "«Today» in the picker");
  await taskIs("Сходить в зал", { scheduled: TODAY });
});

step("a finger drags a task into a project", async () => {
  const from = await until(() => at(`__m.task('Позвонить маме сегодня').querySelector('.ft-grip')`), "the grip");
  const onto = await until(() => at(`__m.project('Ремонт')`), "the project header");
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

step("«Показать будущее» opens the undated work", async () => {
  await tapOn(`__m.text('.ft-future span:not(.ft-future-icon)', 'Показать будущее · 1')`, "«Показать будущее»");
  await until(() => page.eval(`return !!__m.task('Разобрать кладовку')`), "the undated task is on screen");
  await tapOn(`__m.text('.ft-future span:not(.ft-future-icon)', 'Скрыть будущее')`, "«Скрыть будущее»");
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

step("no errors from the plugin in the console", async () => {
  const mine = page.errors.filter((e) => /focus-tasks/.test(e) || /ft-/.test(e));
  if (mine.length) throw new Error(mine.join("\n"));
});

// --- the vault and the window ---------------------------------------------------------------------

function buildVault() {
  fs.rmSync(VAULT, { recursive: true, force: true });
  const plug = path.join(VAULT, ".obsidian/plugins/focus-tasks");
  fs.mkdirSync(plug, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(path.join(ROOT, f), path.join(plug, f));
  fs.writeFileSync(path.join(VAULT, ".obsidian/app.json"), J({ nativeMenus: false, trashOption: "local", promptDelete: false, alwaysUpdateLinks: true }));
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
  project(n) { return this.all('.ft-project').find((e) => e.textContent.includes(n)); },
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
try {
  await openVault();
  for (const [i, { name, fn }] of steps.entries()) {
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
console.log(failed ? `\n${failed} failed of ${steps.length}` : `\nall ${steps.length} phone steps passed`);
process.exit(failed ? 1 : 0);
