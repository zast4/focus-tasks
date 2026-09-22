// The Chrome DevTools plumbing the tests share: a connection to one Obsidian window, real mouse,
// keyboard and touch input, and the small helpers around them. Kept apart from the tests so that the
// desktop suite (test/e2e.mjs) and the phone suite (test/mobile.mjs) drive the app the same way.
import WebSocket from "ws";
import fs from "node:fs";

export const PORT = process.env.OBSIDIAN_CDP_PORT || 9222;
export const J = JSON.stringify;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Waits for `check()` to come true, or throws with what it was waiting for.
export async function until(check, what, ms = 8000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await check(); if (last) return last; } catch (e) { last = e.message; }
    await sleep(120);
  }
  throw new Error(`timed out: ${what}`);
}

export class Page {
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

  // --- touch, for the phone suite --------------------------------------------------------------

  touch(type, points) {
    return this.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: 1 })) });
  }

  async tap({ x, y }, hold = 60) {
    await this.front();
    await this.touch("touchStart", [{ x, y }]);
    await sleep(hold);
    await this.touch("touchEnd", []);
    await sleep(200);
  }

  // A long press is how a phone opens a context menu.
  async press(point, ms = 800) { return this.tap(point, ms); }

  async swipe(a, b, steps = 12) {
    await this.front();
    await this.touch("touchStart", [a]);
    for (let k = 1; k <= steps; k++) {
      await this.touch("touchMove", [{ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps }]);
      await sleep(30);
    }
    await this.touch("touchEnd", []);
    await sleep(250);
  }
}
