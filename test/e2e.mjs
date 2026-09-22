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
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const NAME = "focus-tasks-e2e";
const VAULT = path.join(ROOT, "test", NAME);
const SHOTS = path.join(ROOT, "test", "shots");
const PORT = process.env.OBSIDIAN_CDP_PORT || 9222;
const J = JSON.stringify;

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = ymd(new Date());
const TOMORROW = ymd(new Date(Date.now() + 864e5));
const YESTERDAY = ymd(new Date(Date.now() - 864e5));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- CDP ---------------------------------------------------------------------------------------

class Page {
  static async list() {
    return (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((p) => p.type === "page" && p.url.startsWith("app://obsidian.md"));
  }

  static async connect(match) {
    const page = (await Page.list()).find(match);
    if (!page) return null;
    const c = new Page();
    c.title = page.title;
    c.ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((ok, bad) => { c.ws.on("open", ok); c.ws.on("error", bad); });
    c.id = 0;
    c.waiting = new Map();
    c.errors = [];
    c.ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.id && c.waiting.has(m.id)) {
        const [ok, bad] = c.waiting.get(m.id);
        c.waiting.delete(m.id);
        m.error ? bad(new Error(m.error.message)) : ok(m.result);
      } else if (m.method === "Runtime.exceptionThrown") {
        c.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        c.errors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ") + " " + J(m.params.stackTrace?.callFrames?.[0]?.url || ""));
      }
    });
    return c;
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((ok, bad) => {
      this.waiting.set(id, [ok, bad]);
      this.ws.send(J({ id, method, params }));
      setTimeout(() => { if (this.waiting.delete(id)) bad(new Error(`no answer to ${method} in 20 s`)); }, 20000);
    });
  }

  async eval(body) {
    const r = await this.send("Runtime.evaluate", { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  // Closes the window; its answer never comes, so don't wait for one.
  async close() {
    this.ws.send(J({ id: ++this.id, method: "Runtime.evaluate", params: { expression: "setTimeout(() => window.close(), 50)" } }));
    await sleep(1000);
    this.ws.close();
  }

  // Input reaches a window only while it is in front (a second vault window starts behind).
  front() { return this.send("Page.bringToFront"); }

  // modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8
  mouse(type, x, y, buttons = 1, modifiers = 0) {
    return this.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, modifiers });
  }

  async click({ x, y }, modifiers = 0) {
    await this.front();
    await this.mouse("mouseMoved", x, y, 0, modifiers);
    await this.mouse("mousePressed", x, y, 1, modifiers);
    await this.mouse("mouseReleased", x, y, 0, modifiers);
    await sleep(150);
  }

  async drag(a, b) {
    await this.front();
    await this.mouse("mouseMoved", a.x, a.y, 0);
    await this.mouse("mousePressed", a.x, a.y);
    for (let k = 1; k <= 14; k++) {
      await this.mouse("mouseMoved", a.x + ((b.x - a.x) * k) / 14, a.y + ((b.y - a.y) * k) / 14);
      await sleep(25);
    }
    await this.mouse("mouseReleased", b.x, b.y, 0);
    await sleep(200);
  }

  async type(text) {
    await this.front();
    await this.send("Input.insertText", { text });
    await sleep(80);
  }

  // "Enter", "Escape", "Meta+1" …
  async key(combo) {
    const parts = combo.split("+"), key = parts.pop();
    const modifiers = parts.reduce((m, p) => m | ({ Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 }[p] || 0), 0);
    const digit = /^[0-9]$/.test(key), letter = /^[a-z]$/i.test(key);
    const code = digit ? "Digit" + key : letter ? "Key" + key.toUpperCase() : key;
    const vk = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8 }[key] || (digit || letter ? key.toUpperCase().charCodeAt(0) : 0);
    await this.front();
    for (const type of ["rawKeyDown", "keyUp"]) await this.send("Input.dispatchKeyEvent", { type, key, code, modifiers, windowsVirtualKeyCode: vk });
    await sleep(120);
  }

  async shot(file) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  }
}

// Finders that run in the page; each returns the centre of an element (scrolled into view) or null.
const HELPERS = `
window.__ftLast = Date.now();
new MutationObserver(() => { window.__ftLast = Date.now(); })
  .observe(document.querySelector('.focus-tasks-pane'), { subtree: true, childList: true, characterData: true });
window.__ft = {
  view() { return [...document.querySelectorAll('.focus-tasks-pane .focus-tasks-view')].find((e) => e.getClientRects().length); },
  all(sel, root) { return [...(root || document).querySelectorAll(sel)].filter((e) => e.getClientRects().length); },
  task(n) { return this.all('li.ft-task', this.view()).find((e) => e.querySelector('.ft-text')?.textContent.trim() === n); },
  project(n) { return this.all('.ft-project', this.view()).find((e) => e.querySelector('.ft-link')?.textContent.trim() === n); },
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

async function until(check, what, ms = 5000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await check(); if (last) return last; } catch (e) { last = e.message; }
    await sleep(100);
  }
  throw new Error(`timed out: ${what}` + (last ? ` (last: ${J(last)})` : ""));
}

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
const selectedAre = (names) => until(async () => J(await selected()) === J(names), "selected: " + J(names));
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

step("+ on a project makes steps that point at it", async () => {
  await click(`__ft.at(__ft.project('Marathon').querySelector('.ft-plus'))`);
  await editing();
  await page.type("Buy shoes");
  await page.key("Enter");
  await taskIs("Buy shoes", { area: "💪Sport", projects: "[[Marathon]]", scheduled: null });
  await editing();
  await page.type("Plan route");
  await page.key("Enter");
  await taskIs("Plan route", { projects: "[[Marathon]]" });
  await editing();
  await page.key("Escape");
  await idle();
});

step("inline edit: ⌘1 dates today, Enter renames the note and opens the next row with the same date", async () => {
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
  await idle();
  await until(() => page.eval(`return __ft.task('Lace them')?.querySelector('.ft-date')?.textContent === 'Today'`), "«Today» on the right");
});

step("⌘2 tomorrow, ⌘4 no date", async () => {
  await until(() => page.eval(`return !!__ft.task('Plan route')`), "Plan route on screen");
  await click(`__ft.at(__ft.task('Plan route').querySelector('.ft-text'))`);
  await editing();
  await page.key("Meta+2");
  await taskIs("Plan route", { scheduled: TOMORROW });
  await page.key("Meta+4");
  await taskIs("Plan route", { scheduled: null });
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

step("the date on the right: Today button, a day of the month, Clear date", async () => {
  const pick = async () => {
    await until(() => page.eval(`return !!__ft.task('Stretch')`), "Stretch on screen");
    await click(`__ft.at(__ft.task('Stretch').querySelector('.ft-date'))`);
    await until(() => page.eval(`return !!document.querySelector('.ft-picker')`), "picker");
  };
  await pick();
  await click(`__ft.at(document.querySelector('.ft-picker-today'))`);
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

step("the box completes the task: status and the day; «Completed» of its project brings it back", async () => {
  const done = `(() => { const r = __ft.task('Lace them'); return !!r && !!r.closest('.ft-done-block') && r.querySelector('input').checked; })()`;
  await click(`__ft.at(__ft.task('Lace them').querySelector('input'))`);
  await taskIs("Lace them", { status: "done", completedDate: TODAY });
  await until(() => page.eval(`return ${done} && !!__ft.task('Lace them').closest('.ft-project-body')`), "Lace them under the project's Completed");
  if (await page.eval(`return !!document.querySelector('.ft-done-project')`)) throw new Error("the project label is back");
  await click(`__ft.at(__ft.text('.ft-done-title', 'Completed · 1'))`);
  await until(() => page.eval(`return !__ft.task('Lace them')`), "Completed folded");
  await click(`__ft.at(__ft.text('.ft-done-title', 'Completed · 1'))`);
  await until(() => page.eval(`return ${done}`), "Completed open again");
  await click(`__ft.at(__ft.task('Lace them').querySelector('input'))`);
  await taskIs("Lace them", { status: "open", completedDate: null });
  await until(() => page.eval(`const r = __ft.task('Lace them'); return !!r && !r.closest('.ft-done-block')`), "Lace them open again");
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
  await until(() => page.eval(`return !!__ft.task('Lace them tight')?.closest('.ft-done-block')`), "the row moved to Completed");
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
  await until(() => page.eval(`return __ft.task('Plan route') && !__ft.task('Plan route').closest('.ft-project-body')`), "Plan route among the area's tasks");
  const from = await pos(`__ft.grip(__ft.task('Run 5k'))`, "grip of Run 5k");
  const to = await pos(`__ft.at(__ft.task('Plan route'), 0.85)`, "lower half of Plan route");
  await page.drag(from, to);
  await until(() => {
    const list = taskOrder("area:💪Sport");
    const a = list.indexOf(uidOf("Plan route")), b = list.indexOf(uidOf("Run 5k"));
    return a >= 0 && b === a + 1;
  }, "Run 5k right after Plan route in the saved order");
  await until(() => page.eval(`const rows = __ft.all('li.ft-task', __ft.view()).map((e) => e.querySelector('.ft-text').textContent.trim());
    return rows.indexOf('Run 5k') === rows.indexOf('Plan route') + 1;`), "and on screen");
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

step("«Hide» / «All» at the bottom", async () => {
  await click(`__ft.at(__ft.text('.ft-all-toggle', 'Hide'))`);
  await until(() => page.eval(`return !__ft.text('.ft-rest-title', 'Other areas') && !__ft.area('Reading')`), "only the focus");
  await click(`__ft.at(__ft.text('.ft-all-toggle', 'All'))`);
  await until(() => page.eval(`return !!__ft.text('.ft-rest-title', 'Other areas') && !!__ft.area('Reading')`), "everything again");
});

step("Collapse all / Expand all", async () => {
  await click(`__ft.at(__ft.text('.ft-foot-button', 'Collapse all'))`);
  await until(() => page.eval(`return __ft.all('li.ft-task', __ft.view()).length === 0`), "no task rows");
  await click(`__ft.at(__ft.text('.ft-foot-button', 'Expand all'))`);
  await until(() => page.eval(`return __ft.all('li.ft-task', __ft.view()).length >= 3`), "task rows back");
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
    return selected();
  };
  const names = await pick("Stretch", "Run 5k");
  const from = await pos(`__ft.grip(__ft.task(${J(names[0])}))`, "grip of the first selected row");
  const to = await pos(`__ft.at(__ft.project('Marathon 2027'))`, "Marathon 2027 header");
  await page.drag(from, to);
  for (const name of names) await taskIs(name, { projects: "[[Marathon 2027]]" });
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
  await page.key("Meta+4");
  await sleep(800);
  for (const name of again) if (fm(name)?.scheduled !== TODAY) throw new Error(`⌘4 in another tab changed ${name}`);
  await toPane();
  await page.key("Escape");
  await selectedAre([]);
});

step("the tasks folder setting", async () => {
  await plugin(`p.settings.tasksFolder = 'Задачи 2'; await p.saveAll(); p.refresh(); return true;`);
  await until(() => page.eval(`return !!document.querySelector('.focus-tasks-pane .ft-onboarding') || __ft.all('li.ft-task', __ft.view()).length === 0`), "no tasks from the new folder");
  await plugin(`p.settings.tasksFolder = 'Задачи'; await p.saveAll(); p.refresh(); return true;`);
  await until(() => page.eval(`return __ft.all('li.ft-task', __ft.view()).length > 0`), "tasks back");
});

step("the settings tab renders", async () => {
  const ok = await page.eval(`app.setting.open(); app.setting.openTabById('focus-tasks'); await new Promise((r) => setTimeout(r, 300));
    const text = app.setting.activeTab?.containerEl.textContent || ''; app.setting.close();
    return ['Folder', 'Tasks folder', 'Language', 'Area note name', 'Date format'].every((s) => text.includes(s));`);
  if (!ok) throw new Error("settings missing");
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
  await until(() => page.eval(`return !!(${row("Call coach")})?.closest('.ft-done-block')`), "the row moved to Completed in the block");
  await page.click(await page.eval(`return __ft.at((${row("Call coach")}).querySelector('input'))`));
  await taskIs("Call coach", { status: "open" });
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
  const want = ["add-area", "add-task", "area-from-note", "fold-all", "open", "toggle-all", "unfold-all"].map((k) => "focus-tasks:" + k);
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
