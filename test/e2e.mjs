#!/usr/bin/env node
// End-to-end test of Focus Tasks in a fresh vault, driven over the Chrome DevTools Protocol.
//
// Needs Obsidian running with a DevTools port (any vault open):
//   open -a Obsidian --args --remote-debugging-port=9222
// The test builds test/focus-tasks-e2e/ from scratch, opens it in a new Obsidian window, installs
// the plugin from this folder, goes through every feature with real mouse and keyboard input and
// checks the files on disk. The window is closed and the vault forgotten at the end (--keep keeps them).
//
//   node test/e2e.mjs                                   without the Tasks plugin (own ✅ toggle)
//   node test/e2e.mjs --with-tasks <plugin folder>      with Tasks installed (e.g. <vault>/.obsidian/plugins/obsidian-tasks-plugin)
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const TASKS = args.includes("--with-tasks") ? path.resolve(args[args.indexOf("--with-tasks") + 1]) : null;
const KEEP = args.includes("--keep");
const NAME = TASKS ? "focus-tasks-e2e-tasks" : "focus-tasks-e2e";
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

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

step("opens with an onboarding and the area buttons", async () => {
  await until(() => page.eval(`return !!document.querySelector('.focus-tasks-pane .ft-onboarding')`), "onboarding");
  const foot = await page.eval(`return __ft.all('.ft-foot-button', __ft.view()).map((b) => b.textContent.trim())`);
  if (J(foot) !== J(["+ Area", "+ Area from a note"])) throw new Error("footer: " + J(foot));
  if (!(await page.eval(`return !!document.querySelector('.side-dock-ribbon-action[aria-label="Open Focus"]')`))) throw new Error("no ribbon icon");
});

step("+ Area creates an area note in the folder and shows it under «All»", async () => {
  await click(`__ft.at(__ft.text('.ft-foot-button', '+ Area'))`);
  await modalInput();
  await page.type("💪Sport");
  await page.key("Enter");
  await fileHas("Tasks/Sport.md", '---\nkind: focus-area\narea: "💪Sport"\ntype: area\n---\n');
  await until(() => page.eval(`return !!__ft.text('.ft-rest-title', 'Other areas') && !!__ft.text('.ft-empty-add', 'Empty')`), "Sport under Other areas, empty");
});

step("a click on «Empty» types a task; Enter goes on to the next", async () => {
  await click(`__ft.at(__ft.text('.ft-empty-add', 'Empty'))`);
  await editing();
  await page.type("Run 5k");
  await page.key("Enter");
  await fileHas("Tasks/Sport.md", "- [ ] Run 5k\n");
  await editing();
  await page.type("Stretch");
  await page.key("Enter");
  await fileHas("Tasks/Sport.md", "## Inbox\n\n- [ ] Run 5k\n- [ ] Stretch\n");
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
  await fileHas("Tasks/Marathon.md", '---\nparents:\n  - "[[Sport]]"\narea: "💪Sport"\ntype: project\n---\n\n## Steps\n');
  await fileHas("Tasks/Sport.md", "## Projects\n\n- 📁 [[Marathon]]\n");
  await until(() => page.eval(`return !!__ft.project('Marathon')`), "Marathon on screen");
});

step("+ on a project adds steps", async () => {
  await click(`__ft.at(__ft.project('Marathon').querySelector('.ft-plus'))`);
  await editing();
  await page.type("Buy shoes");
  await page.key("Enter");
  await fileHas("Tasks/Marathon.md", "- [ ] Buy shoes\n");
  await editing();
  await page.type("Plan route");
  await page.key("Enter");
  await fileHas("Tasks/Marathon.md", "## Steps\n\n- [ ] Buy shoes\n- [ ] Plan route\n");
  await editing();
  await page.key("Escape");
  await idle();
});

step("inline edit: ⌘1 dates today, Enter saves the text and adds a row below with the same date", async () => {
  await until(() => page.eval(`return !!__ft.task('Buy shoes')`), "Buy shoes on screen");
  await click(`__ft.at(__ft.task('Buy shoes').querySelector('.ft-text'))`);
  await editing();
  await page.eval(`__ft.caretToEnd()`);
  await page.type(" fast");
  await page.key("Meta+1");
  await fileHas("Tasks/Marathon.md", `- [ ] Buy shoes ⏳ ${TODAY}\n`);
  await page.key("Enter");
  await fileHas("Tasks/Marathon.md", `- [ ] Buy shoes fast ⏳ ${TODAY}\n`);
  await editing();
  await page.type("Lace them");
  await page.key("Enter");
  await fileHas("Tasks/Marathon.md", `- [ ] Buy shoes fast ⏳ ${TODAY}\n- [ ] Lace them ⏳ ${TODAY}\n- [ ] Plan route\n`);
  await editing();
  await page.key("Escape");
  await idle();
  // dated today → Sport is in the focus now, above «Other areas»
  await until(() => page.eval(`return __ft.task('Lace them')?.querySelector('.ft-date')?.textContent === 'Today'`), "«Today» on the right");
});

step("⌘2 tomorrow, ⌘4 no date", async () => {
  await until(() => page.eval(`return !!__ft.task('Plan route')`), "Plan route on screen");
  await click(`__ft.at(__ft.task('Plan route').querySelector('.ft-text'))`);
  await editing();
  await page.key("Meta+2");
  await fileHas("Tasks/Marathon.md", `- [ ] Plan route ⏳ ${TOMORROW}\n`);
  await page.key("Meta+4");
  await fileHas("Tasks/Marathon.md", "- [ ] Plan route\n");
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
  await fileHas("Tasks/Sport.md", "- [ ] Run 5k ⏳ 2026-12-25\n");
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
  await fileHas("Tasks/Sport.md", `- [ ] Stretch ⏳ ${TODAY}\n`);
  await idle();
  await pick();
  await click(`__ft.at([...document.querySelectorAll('.ft-picker-day:not(.is-other)')].find((d) => d.textContent === '15'))`);
  await fileHas("Tasks/Sport.md", `- [ ] Stretch ⏳ ${TODAY.slice(0, 8)}15\n`);
  await idle();
  await pick();
  await click(`__ft.at(document.querySelector('.ft-picker-foot button'))`);
  await fileHas("Tasks/Sport.md", "- [ ] Stretch\n");
  await idle();
});

step((TASKS ? "the checkbox completes through Tasks" : "the checkbox completes without Tasks: [x] and a ✅ date")
  + "; the task goes to «Completed» at the bottom of the area, its box brings it back", async () => {
  const done = `(() => { const r = __ft.task('Lace them'); return !!r && !!r.closest('.ft-done-block') && r.querySelector('input').checked; })()`;
  await click(`__ft.at(__ft.task('Lace them').querySelector('input'))`);
  await fileHas("Tasks/Marathon.md", `- [x] Lace them ⏳ ${TODAY} ✅ ${TODAY}`);
  await until(() => page.eval(`return ${done} && __ft.area('Sport').parentElement.lastElementChild.matches('.ft-done-block')`), "Lace them under Completed, last in Sport");
  if (!(await page.eval(`return !!__ft.text('.ft-done-title', 'Completed · 1')`))) throw new Error("no «Completed · 1»");
  // folds and unfolds
  await click(`__ft.at(__ft.text('.ft-done-title', 'Completed · 1'))`);
  await until(() => page.eval(`return !__ft.task('Lace them')`), "Completed folded");
  await click(`__ft.at(__ft.text('.ft-done-title', 'Completed · 1'))`);
  await until(() => page.eval(`return ${done}`), "Completed open again");
  // its box: open again, among the focus
  await click(`__ft.at(__ft.task('Lace them').querySelector('input'))`);
  await fileHas("Tasks/Marathon.md", `- [ ] Lace them ⏳ ${TODAY}\n`);
  await until(() => page.eval(`const r = __ft.task('Lace them'); return !!r && !r.closest('.ft-done-block') && !document.querySelector('.focus-tasks-pane .ft-done-block')`), "Lace them open again");
  await settle();
  await click(`__ft.at(__ft.task('Lace them').querySelector('input'))`);
  await fileHas("Tasks/Marathon.md", `- [x] Lace them ⏳ ${TODAY} ✅ ${TODAY}`);
  await until(() => page.eval(`return ${done}`), "Lace them under Completed again");
});

step("a second click on the same box before the list catches up does not undo the first", async () => {
  await until(() => page.eval(`return !!__ft.task('Buy shoes fast')`), "Buy shoes fast on screen");
  const box = await pos(`__ft.at(__ft.task('Buy shoes fast').querySelector('input'))`, "box of Buy shoes fast");
  await page.click(box);
  await page.click(box);  // the row has not moved yet
  await until(() => page.eval(`const r = __ft.task('Buy shoes fast'); return !!r && !!r.closest('.ft-done-block')`), "Buy shoes fast under Completed");
  await settle();
  if (!read("Tasks/Marathon.md").includes(`- [x] Buy shoes fast ⏳ ${TODAY}`)) throw new Error("the second click undid the first: " + J(read("Tasks/Marathon.md").split("\n").find((l) => l.includes("Buy shoes"))));
  // its box in «Completed» still brings it back
  await click(`__ft.at(__ft.task('Buy shoes fast').querySelector('input'))`);
  await fileHas("Tasks/Marathon.md", `- [ ] Buy shoes fast ⏳ ${TODAY}\n`);
  await until(() => page.eval(`const r = __ft.task('Buy shoes fast'); return !!r && !r.closest('.ft-done-block')`), "Buy shoes fast open again");
});

step("a box on a row the note changed under: a notice, and the row goes back as it was", async () => {
  await until(() => page.eval(`return !!__ft.task('Buy shoes fast')`), "Buy shoes fast on screen");
  // the list is held still while the note changes, so the row on screen is out of date
  await page.eval(`const v = [...app.plugins.plugins['focus-tasks'].views][0]; v.editing = true;
    const f = app.vault.getAbstractFileByPath('Tasks/Marathon.md');
    await app.vault.process(f, (d) => d.replace('- [ ] Buy shoes fast', '- [ ] Buy shoes fast now'));
    return true;`);
  await click(`__ft.at(__ft.task('Buy shoes fast').querySelector('input'))`);
  await until(() => page.eval(`return [...document.querySelectorAll('.notice')].some((n) => n.textContent.includes('The task changed'))`), "the «changed» notice");
  if (!(await page.eval(`return !document.querySelector('.focus-tasks-pane li.is-toggling')`))) throw new Error("the row stayed struck through");
  await page.eval(`const v = [...app.plugins.plugins['focus-tasks'].views][0]; v.editing = false;
    await app.vault.process(app.vault.getAbstractFileByPath('Tasks/Marathon.md'), (d) => d.replace('- [ ] Buy shoes fast now', '- [ ] Buy shoes fast'));
    v.render(); return true;`);
  await until(() => page.eval(`return !!__ft.task('Buy shoes fast')`), "Buy shoes fast back on screen");
});

step("the note changed on another device: the box completes the line as it is there now", async () => {
  await until(() => page.eval(`return !!__ft.task('Buy shoes fast')`), "Buy shoes fast on screen");
  // the list is held still while another device moves the task's date
  await page.eval(`const v = [...app.plugins.plugins['focus-tasks'].views][0]; v.editing = true;
    await app.vault.process(app.vault.getAbstractFileByPath('Tasks/Marathon.md'),
      (d) => d.replace('- [ ] Buy shoes fast ⏳ ${TODAY}', '- [ ] Buy shoes fast ⏳ ${YESTERDAY}'));
    return true;`);
  await click(`__ft.at(__ft.task('Buy shoes fast').querySelector('input'))`);
  await fileHas("Tasks/Marathon.md", `- [x] Buy shoes fast ⏳ ${YESTERDAY} ✅ ${TODAY}`);
  await page.eval(`const v = [...app.plugins.plugins['focus-tasks'].views][0]; v.editing = false;
    await app.vault.process(app.vault.getAbstractFileByPath('Tasks/Marathon.md'),
      (d) => d.replace(/- \\[x\\] Buy shoes fast[^\\n]*/, '- [ ] Buy shoes fast ⏳ ${TODAY}'));
    v.render(); return true;`);
  await fileHas("Tasks/Marathon.md", `- [ ] Buy shoes fast ⏳ ${TODAY}\n`);
  await until(() => page.eval(`const r = __ft.task('Buy shoes fast'); return !!r && !r.closest('.ft-done-block')`), "Buy shoes fast back in the focus");
});

step("the note saved over the change by another device: a notice says so", async () => {
  await until(() => page.eval(`return !!__ft.task('Buy shoes fast')`), "Buy shoes fast on screen");
  await click(`__ft.at(__ft.task('Buy shoes fast').querySelector('input'))`);
  await fileHas("Tasks/Marathon.md", `- [x] Buy shoes fast ⏳ ${TODAY} ✅ ${TODAY}`);
  // the other device wins the race and saves the note as it was
  await page.eval(`await app.vault.process(app.vault.getAbstractFileByPath('Tasks/Marathon.md'),
    (d) => d.replace(/- \\[x\\] Buy shoes fast[^\\n]*/, '- [ ] Buy shoes fast ⏳ ${TODAY}')); return true;`);
  await until(() => page.eval(`return [...document.querySelectorAll('.notice')].some((n) => /did not stick/.test(n.textContent))`), "the «did not stick» notice", 8000);
  await until(() => page.eval(`const r = __ft.task('Buy shoes fast'); return !!r && !r.closest('.ft-done-block')`), "Buy shoes fast back in the focus");
});

step("drag a task onto an area header moves it into the area's inbox", async () => {
  const from = await pos(`__ft.grip(__ft.task('Plan route'))`, "grip of Plan route");
  const to = await pos(`__ft.at(__ft.area('Sport'))`, "Sport header");
  await page.drag(from, to);
  await fileLacks("Tasks/Marathon.md", "Plan route");
  await fileHas("Tasks/Sport.md", "- [ ] Stretch\n- [ ] Plan route\n");
});

step("drag a task below another reorders the lines", async () => {
  // Obsidian re-reads Marathon.md a moment later; until then Plan route still shows under it
  await until(() => page.eval(`return __ft.task('Plan route') && !__ft.task('Plan route').closest('.ft-project-body')`), "Plan route among the area's tasks");
  const from = await pos(`__ft.grip(__ft.task('Run 5k'))`, "grip of Run 5k");
  const to = await pos(`__ft.at(__ft.task('Plan route'), 0.85)`, "lower half of Plan route");
  await page.drag(from, to);
  await fileHas("Tasks/Sport.md", "- [ ] Stretch\n- [ ] Plan route\n- [ ] Run 5k ⏳ 2026-12-25\n");
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
  await fileLacks("Tasks/Sport.md", "Stretch");
  await click(`__ft.at(document.querySelector('.notice .ft-undo'))`, "Undo");
  await fileHas("Tasks/Sport.md", "## Inbox\n\n- [ ] Stretch\n- [ ] Plan route\n");
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
  await until(() => page.eval(`return __ft.all('li.ft-task', __ft.view()).length >= 4`), "task rows back");
});

step("rename a project in place (links follow); Enter adds the next project after it", async () => {
  await click(`__ft.grip(__ft.project('Marathon'))`);
  await menu("Rename");
  await editing();
  await page.eval(`__ft.selectAll()`);
  await page.type("Marathon 2027");
  await page.key("Enter");
  await until(() => exists("Tasks/Marathon 2027.md") && !exists("Tasks/Marathon.md"), "renamed file");
  await fileHas("Tasks/Sport.md", "- 📁 [[Marathon 2027]]\n");
  await editing();
  await page.type("Half marathon");
  await page.key("Enter");
  await fileHas("Tasks/Half marathon.md", '---\nparents:\n  - "[[Sport]]"\narea: "💪Sport"\ntype: project\n---\n');
  await fileHas("Tasks/Sport.md", "- 📁 [[Marathon 2027]]\n- 📁 [[Half marathon]]\n");
  await until(() => J(data().order?.projects?.["💪Sport"]) === J(["Tasks/Marathon 2027.md", "Tasks/Half marathon.md"]), "project order");
  await editing();
  await page.key("Escape");
  await idle();
});

step("link a note to a project: the name opens the note, the menu opens the task file", async () => {
  const before = read("Notes/Running log.md");
  await click(`__ft.grip(__ft.project('Marathon 2027'))`);
  await menu("Link a note…");
  await modalInput(".prompt-input");
  await page.type("Running log");
  await sleep(200);
  await page.key("Enter");
  await fileHas("Tasks/Marathon 2027.md", 'note: "[[Running log]]"');
  if (read("Notes/Running log.md") !== before) throw new Error("the linked note was changed");
  await until(() => page.eval(`return __ft.project('Marathon 2027')?.querySelector('.ft-link.is-linked')`), "linked mark");
  await click(`__ft.at(__ft.project('Marathon 2027').querySelector('.ft-link'))`);
  await until(async () => (await activePath()) === "Notes/Running log.md", "the linked note open");
  if (!(await page.eval(`return app.workspace.getLeavesOfType('focus-tasks-view').length === 1`))) throw new Error("the pane was replaced");
  await toPane();
  await click(`__ft.grip(__ft.project('Marathon 2027'))`);
  await menu("Open task file");
  await until(async () => (await activePath()) === "Tasks/Marathon 2027.md", "the task file open");
  await toPane();
  await click(`__ft.grip(__ft.project('Marathon 2027'))`);
  await menu("Unlink the note");
  await fileLacks("Tasks/Marathon 2027.md", "note:");
});

step("+ Area from a note: a task file linked to an existing note of the same name", async () => {
  await toPane();
  await click(`__ft.at(__ft.text('.ft-foot-button', '+ Area from a note'))`);
  await modalInput(".prompt-input");
  await page.type("Notes/Home");
  await sleep(200);
  await page.key("Enter");
  await modalInput();
  if ((await page.eval(`return document.activeElement.value`)) !== "Home") throw new Error("the name is not prefilled");
  await page.key("Enter");
  await fileHas("Tasks/Home.md", 'note: "[[Notes/Home]]"');
  await until(() => page.eval(`return !!__ft.area('Home')`), "Home on screen");
  await click(`__ft.at(__ft.area('Home').querySelector('.ft-link'))`);
  await until(async () => (await activePath()) === "Notes/Home.md", "Notes/Home open");
  await toPane();
});

step("Project from a note", async () => {
  await click(`__ft.grip(__ft.area('Home'))`);
  await menu("Project from a note");
  await modalInput(".prompt-input");
  await page.type("Garden plan");
  await sleep(200);
  await page.key("Enter");
  // the task file has the note's name, so both links carry a path
  await fileHas("Tasks/Garden plan.md", /area: "?Home"?\ntype: project\nnote: "\[\[Notes\/Garden plan\]\]"/);
  await fileHas("Tasks/Home.md", "## Projects\n\n- 📁 [[Tasks/Garden plan]]\n");
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
  await fileHas("Tasks/Marathon 2027.md", `- [ ] Call coach ⏳ ${TODAY}\n`);
});

step(TASKS ? "the task menu offers the Tasks dialog" : "no Tasks dialog without Tasks", async () => {
  await toPane();
  await until(() => page.eval(`return !!__ft.task('Call coach')`), "Call coach on screen");
  await click(`__ft.grip(__ft.task('Call coach'))`);
  await until(() => page.eval(`return !!document.querySelector('.menu')`), "menu");
  const has = await page.eval(`return !!__ft.text('.menu .menu-item-title', 'Tasks dialog (date, priority)')`);
  await page.key("Escape");
  if (has !== !!TASKS) throw new Error("Tasks dialog item: " + has);
});

step("click, then Shift-click selects the rows between; Cmd-click drops one; the menu dates them all", async () => {
  await toPane();
  await until(() => page.eval(`return !!__ft.task('Stretch') && !!__ft.task('Run 5k')`), "Sport's tasks on screen");
  await click(`__ft.at(__ft.task('Stretch').querySelector('.ft-text'))`);
  await editing();
  await click(`__ft.at(__ft.task('Run 5k').querySelector('.ft-text'))`, "Run 5k", SHIFT);
  await idle();
  await selectedAre(["Stretch", "Plan route", "Run 5k"]);
  await settle();
  await page.key("Escape");
  await selectedAre([]);
  await click(`__ft.at(__ft.task('Run 5k').querySelector('.ft-text'))`, "Run 5k", SHIFT);
  await selectedAre(["Stretch", "Plan route", "Run 5k"]);
  await click(`__ft.at(__ft.task('Plan route').querySelector('.ft-text'))`, "Plan route", CMD);
  await selectedAre(["Stretch", "Run 5k"]);
  await click(`__ft.at(__ft.task('Plan route').querySelector('.ft-text'))`, "Plan route", CMD);
  await selectedAre(["Stretch", "Plan route", "Run 5k"]);
  const selectionMenu = async () => {
    await click(`__ft.grip(__ft.task('Run 5k'))`);
    await until(() => page.eval(`return !!__ft.text('.menu .menu-item-title', 'Selected: 3')`), "the selection menu");
  };
  await selectionMenu();
  await page.key("Escape");  // closes the menu only
  await until(() => page.eval(`return !document.querySelector('.menu')`), "the menu closed");
  await selectedAre(["Stretch", "Plan route", "Run 5k"]);
  await selectionMenu();
  await menu("Tomorrow");
  await fileHas("Tasks/Sport.md", `## Inbox\n\n- [ ] Stretch ⏳ ${TOMORROW}\n- [ ] Plan route ⏳ ${TOMORROW}\n- [ ] Run 5k ⏳ ${TOMORROW}\n`);
  await selectedAre([]);
});

step("the grip of a selected row drags them all; ⌘1–4 and the date picker date them all", async () => {
  const pick = async (from, to) => {
    await until(() => page.eval(`return !!__ft.task(${J(from)}) && !!__ft.task(${J(to)})`), `${from} … ${to} on screen`);
    await click(`__ft.at(__ft.task(${J(from)}).querySelector('.ft-text'))`, from, CMD);
    await click(`__ft.at(__ft.task(${J(to)}).querySelector('.ft-text'))`, to, SHIFT);
    await selectedAre(["Stretch", "Plan route", "Run 5k"]);
  };
  // into a project of another note: written in the screen order, cut from the area
  await pick("Stretch", "Run 5k");
  let from = await pos(`__ft.grip(__ft.task('Plan route'))`, "grip of Plan route");
  let to = await pos(`__ft.at(__ft.project('Marathon 2027'))`, "Marathon 2027 header");
  await page.drag(from, to);
  await fileHas("Tasks/Marathon 2027.md", `- [ ] Call coach ⏳ ${TODAY}\n- [ ] Stretch ⏳ ${TOMORROW}\n- [ ] Plan route ⏳ ${TOMORROW}\n- [ ] Run 5k ⏳ ${TOMORROW}\n`);
  await fileLacks("Tasks/Sport.md", /Stretch|Plan route|Run 5k/);
  await selectedAre([]);
  // Obsidian re-reads Sport.md a moment later; until then the moved rows show there too
  await until(() => page.eval(`return __ft.all('li.ft-task', __ft.view()).filter((e) => /^(Stretch|Plan route|Run 5k)$/.test(e.querySelector('.ft-text').textContent.trim()))
    .every((e) => e.closest('.ft-project-body'))`), "the moved rows only in Marathon 2027");
  // hotkeys as in the editor: ⌘4 no date; ⌘3 the picker (Esc closes only it); ⌘2 tomorrow
  await settle();
  await pick("Stretch", "Run 5k");
  await page.key("Meta+4");
  await fileHas("Tasks/Marathon 2027.md", `- [ ] Call coach ⏳ ${TODAY}\n- [ ] Stretch\n- [ ] Plan route\n- [ ] Run 5k\n`);
  await selectedAre([]);
  await settle();
  await pick("Stretch", "Run 5k");
  await page.key("Meta+3");
  await until(() => page.eval(`return !!document.querySelector('.ft-picker')`), "picker");
  await page.key("Escape");
  await until(() => page.eval(`return !document.querySelector('.ft-picker')`), "the picker closed");
  await selectedAre(["Stretch", "Plan route", "Run 5k"]);
  await page.key("Meta+2");
  const tomorrow = `- [ ] Stretch ⏳ ${TOMORROW}\n- [ ] Plan route ⏳ ${TOMORROW}\n- [ ] Run 5k ⏳ ${TOMORROW}\n`;
  await fileHas("Tasks/Marathon 2027.md", tomorrow);
  await selectedAre([]);
  // with another tab active ⌘4 is Obsidian's again; back in the list Esc drops the selection
  await settle();
  await pick("Stretch", "Run 5k");
  await page.eval(`app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('markdown')[0], { focus: true }); return true;`);
  await page.key("Meta+4");
  await sleep(800);
  if (!read("Tasks/Marathon 2027.md").includes(tomorrow)) throw new Error("⌘4 in another tab changed the dates");
  await selectedAre(["Stretch", "Plan route", "Run 5k"]);
  await page.key("Escape");
  await selectedAre([]);
  // the date on the right of a selected row
  await settle();
  await pick("Stretch", "Run 5k");
  await click(`__ft.at(__ft.task('Plan route').querySelector('.ft-date'))`);
  await until(() => page.eval(`return !!document.querySelector('.ft-picker')`), "picker");
  await click(`__ft.at(document.querySelector('.ft-picker-today'))`);
  await fileHas("Tasks/Marathon 2027.md", `- [ ] Stretch ⏳ ${TODAY}\n- [ ] Plan route ⏳ ${TODAY}\n- [ ] Run 5k ⏳ ${TODAY}\n`);
  await idle();
  // above another task of the same note
  await settle();
  await pick("Stretch", "Run 5k");
  from = await pos(`__ft.grip(__ft.task('Run 5k'))`, "grip of Run 5k");
  to = await pos(`__ft.at(__ft.task('Buy shoes fast'), 0.15)`, "top of Buy shoes fast");
  await page.drag(from, to);
  await fileHas("Tasks/Marathon 2027.md", `## Steps\n\n- [ ] Stretch ⏳ ${TODAY}\n- [ ] Plan route ⏳ ${TODAY}\n- [ ] Run 5k ⏳ ${TODAY}\n- [ ] Buy shoes fast ⏳ ${TODAY}\n- [x] Lace them`);
  await fileHas("Tasks/Marathon 2027.md", /Lace them[^\n]*\n- \[ \] Call coach ⏳ \d{4}-\d{2}-\d{2}\n?$/);
});

step("the folder setting: new areas go to the new folder, created if missing", async () => {
  await plugin(`p.settings.folder = 'Work/Tasks'; await p.saveAll(); p.refresh(); return true;`);
  await until(() => page.eval(`return !!document.querySelector('.focus-tasks-pane .ft-onboarding')`), "empty in the new folder");
  await click(`__ft.at(__ft.text('.ft-foot-button', '+ Area'))`);
  await modalInput();
  await page.type("Job");
  await page.key("Enter");
  await fileHas("Work/Tasks/Job.md", 'area: "Job"');
  await plugin(`p.settings.folder = 'Tasks'; await p.saveAll(); p.refresh(); return true;`);
  await until(() => page.eval(`return !!__ft.area('Sport') && !__ft.area('Job')`), "back to Tasks");
});

step("the settings tab renders", async () => {
  const ok = await page.eval(`app.setting.open(); app.setting.openTabById('focus-tasks'); await new Promise((r) => setTimeout(r, 300));
    const text = app.setting.activeTab?.containerEl.textContent || ''; app.setting.close();  // settings may open in a window of their own
    return ['Folder', 'Language', 'Area note name', 'Steps heading', 'Date format'].every((s) => text.includes(s));`);
  if (!ok) throw new Error("settings missing");
});

step("delete a project: its file goes to the trash, its link leaves the area", async () => {
  await toPane();
  await until(() => page.eval(`return !!__ft.project('Half marathon')`), "Half marathon on screen");
  await click(`__ft.grip(__ft.project('Half marathon'))`);
  await menu("Delete project");
  await until(() => page.eval(`return !!document.querySelector('.modal .mod-warning')`), "confirm");
  await click(`__ft.at(document.querySelector('.modal .mod-warning'))`);
  await until(() => !exists("Tasks/Half marathon.md") && exists(".trash/Half marathon.md"), "in .trash");
  await fileLacks("Tasks/Sport.md", "Half marathon");
});

step("delete an area", async () => {
  await click(`__ft.grip(__ft.area('Reading'))`);
  await menu("Delete area");
  await until(() => page.eval(`return !!document.querySelector('.modal .mod-warning')`), "confirm");
  await click(`__ft.at(document.querySelector('.modal .mod-warning'))`);
  await until(() => !exists("Tasks/Reading.md"), "Reading gone");
  await until(() => page.eval(`return !__ft.area('Reading')`), "Reading off screen");
});

step("Russian interface", async () => {
  await plugin(`p.settings.language = 'ru'; p.applyLanguage(); p.refresh(); return true;`);
  await until(() => page.eval(`return !!__ft.text('.ft-foot-button', '+ Область') && !!__ft.text('.ft-rest-title', 'Остальные области')`), "Russian labels");
  await plugin(`p.settings.language = 'en'; p.applyLanguage(); await p.saveAll(); p.refresh(); return true;`);
});

step("a ```focus-tasks``` block in a note renders the same list", async () => {
  fs.writeFileSync(path.join(VAULT, "Dashboard.md"), "---\ncssclasses: [focus-tasks-note]\n---\n\n```focus-tasks\n```\n");
  await until(() => page.eval(`return !!app.vault.getAbstractFileByPath('Dashboard.md')`), "Dashboard indexed");
  await page.eval(`const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath('Dashboard.md')); return true;`);
  await until(() => page.eval(`return __ft.all('.workspace-leaf.mod-active .focus-tasks-view .ft-area-title').some((e) => e.textContent.includes('Sport'))`), "block rendered");
});

step("in a note's block, with another note beside it active: Shift-click selects, ⌘2 dates them all", async () => {
  // Dashboard (from the step before) on the left with its cursor on the block, a note on the right, active
  await page.eval(`const dash = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === 'Dashboard.md');
    dash.view.editor?.setCursor({ line: 4, ch: 0 });
    const right = app.workspace.createLeafBySplit(dash, 'vertical');
    await right.openFile(app.vault.getAbstractFileByPath('Notes/Running log.md'));
    app.workspace.setActiveLeaf(right, { focus: true });
    return true;`);
  const block = `[...document.querySelectorAll('.focus-tasks-view')].find((e) => !e.closest('.focus-tasks-pane') && e.getClientRects().length)`;
  const row = (name) => `__ft.all('li.ft-task', ${block}).find((e) => e.querySelector('.ft-text')?.textContent.trim() === ${J(name)})`;
  await until(() => page.eval(`return !!(${row("Stretch")}) && !!(${row("Run 5k")})`), "the block's rows");
  await page.click(await page.eval(`return __ft.at((${row("Stretch")}).querySelector('.ft-text'))`), CMD);
  await page.click(await page.eval(`return __ft.at((${row("Run 5k")}).querySelector('.ft-text'))`), SHIFT);
  await until(async () => J(await page.eval(`return __ft.all('li.ft-task.is-selected', ${block}).map((e) => e.querySelector('.ft-text').textContent.trim())`))
    === J(["Stretch", "Plan route", "Run 5k"]), "three rows selected in the block");
  if ((await activePath()) !== "Dashboard.md") throw new Error("the block's note is not the active tab: " + (await activePath()));
  await page.key("Meta+2");
  await fileHas("Tasks/Marathon 2027.md", `- [ ] Stretch ⏳ ${TOMORROW}\n- [ ] Plan route ⏳ ${TOMORROW}\n- [ ] Run 5k ⏳ ${TOMORROW}\n- [ ] Buy shoes fast ⏳ ${TODAY}\n`);
  await until(() => page.eval(`return !!(${block})`), "the block still rendered");
});

step("a box inside a note's block completes the task too", async () => {
  const block = `[...document.querySelectorAll('.focus-tasks-view')].find((e) => !e.closest('.focus-tasks-pane') && e.getClientRects().length)`;
  const row = (name) => `__ft.all('li.ft-task', ${block}).find((e) => e.querySelector('.ft-text')?.textContent.trim() === ${J(name)})`;
  await until(() => page.eval(`return !!(${row("Stretch")})`), "Stretch in the block");
  await page.click(await page.eval(`return __ft.at((${row("Stretch")}).querySelector('input'))`));
  await fileHas("Tasks/Marathon 2027.md", `- [x] Stretch`);
  await until(() => page.eval(`const r = ${row("Stretch")}; return !!r && !!r.closest('.ft-done-block')`), "Stretch under Completed in the block");
  await page.click(await page.eval(`return __ft.at((${row("Stretch")}).querySelector('input'))`));
  await fileHas("Tasks/Marathon 2027.md", /- \[ \] Stretch/);
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
  if (TASKS) {
    const dest = path.join(VAULT, ".obsidian/plugins/obsidian-tasks-plugin");
    fs.mkdirSync(dest, { recursive: true });
    for (const f of ["main.js", "manifest.json", "styles.css"]) if (fs.existsSync(path.join(TASKS, f))) fs.copyFileSync(path.join(TASKS, f), path.join(dest, f));
  }
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
    ${TASKS ? "await app.plugins.enablePluginAndSave('obsidian-tasks-plugin');" : ""}
    await app.plugins.enablePluginAndSave('focus-tasks');
    const p = app.plugins.plugins['focus-tasks'];
    p.settings.language = 'en'; p.applyLanguage();
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
  console.log(`Focus Tasks e2e in ${NAME}${TASKS ? " (with Tasks)" : ""}`);
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
