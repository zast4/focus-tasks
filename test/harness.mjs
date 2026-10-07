// A fake Obsidian, enough to run main.js outside the app.
//
// The plugin talks to: vault (files, create/process/trash/rename), metadataCache (frontmatter of a
// file), fileManager (processFrontMatter, renameFile, trashFile), workspace, keymap, plugins.
// Everything here keeps the files in memory, parses their frontmatter the way Obsidian does, and
// records the notices. That makes the whole task model testable in milliseconds: collect(), toggle,
// dates, drag order, delete + undo, migration-shaped data, junk frontmatter.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// --- Real YAML, shared by fixtures and the Obsidian module stub -----------------------------

export function parseYaml(text) {
  const parsed = yamlParse(text, { maxAliasCount: 100 });
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

export function stringifyYaml(obj) {
  return yamlStringify(obj, { lineWidth: 0 });
}

const splitFront = (text) => {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(text);
  return match ? [match[1], text.slice(match[0].length).replace(/^\r?\n/, "")] : [null, text];
};

// --- the fake app ----------------------------------------------------------------------------

class TFile {
  constructor(vault, filePath) {
    this.vault = vault;
    this.path = filePath;
    this.stat = { mtime: Date.now(), ctime: Date.now() };
  }
  get name() { return this.path.split("/").pop(); }
  get basename() { return this.name.replace(/\.md$/, ""); }
  get extension() { return this.name.includes(".") ? this.name.split(".").pop() : ""; }
  get parent() { const dir = this.path.split("/").slice(0, -1).join("/"); return { path: dir || "/", name: dir.split("/").pop() || "" }; }
}

export class FakeVault {
  constructor() {
    this.files = new Map();     // path → text
    this.handles = new Map();   // path → TFile
    this.folders = new Set();
    this.trashed = [];
    this.events = { create: [], modify: [], delete: [], rename: [] };
  }
  file(p) {
    if (!this.handles.has(p)) this.handles.set(p, new TFile(this, p));
    return this.handles.get(p);
  }
  getMarkdownFiles() { return [...this.files.keys()].filter((p) => p.endsWith(".md")).map((p) => this.file(p)); }
  getFiles() { return this.getMarkdownFiles(); }
  getAbstractFileByPath(p) {
    if (this.files.has(p)) return this.file(p);
    if (this.folders.has(p)) return { path: p, children: [] };
    return null;
  }
  async create(p, text) {
    if (this.files.has(p)) throw new Error("File already exists: " + p);
    this.files.set(p, text);
    const f = this.file(p);
    this.fire("create", f);
    return f;
  }
  async createFolder(p) { this.folders.add(p); }
  async read(file) { return this.files.get(file.path); }
  async cachedRead(file) { return this.files.get(file.path); }
  async modify(file, text) { this.files.set(file.path, text); this.fire("modify", file); }
  async process(file, fn) {
    const text = this.files.get(file.path);
    const next = fn(text);
    this.files.set(file.path, next);
    this.fire("modify", file);
    return next;
  }
  async trash(file) { this.trashed.push({ path: file.path, text: this.files.get(file.path) }); this.files.delete(file.path); this.fire("delete", file); }
  async delete(file) { return this.trash(file); }
  async rename(file, to) {
    const text = this.files.get(file.path);
    const from = file.path;
    this.files.delete(from);
    this.files.set(to, text);
    this.handles.delete(from);
    file.path = to;
    this.handles.set(to, file);
    // Obsidian updates the links to a renamed note (the vaults here have «always update links» on):
    // without this the fake vault would break links the real one keeps, and tests would lie.
    const name = (p) => p.split("/").pop().replace(/\.md$/, "");
    const before = [from.replace(/\.md$/, ""), name(from)];
    for (const [path, body] of [...this.files.entries()]) {
      if (path === to) continue;
      let next = body;
      for (const old of before) {
        next = next.split(`[[${old}]]`).join(`[[${name(to)}]]`);
        next = next.split(`[[${old}|`).join(`[[${name(to)}|`);
      }
      if (next !== body) this.files.set(path, next);
    }
    this.fire("rename", file, from);
    return file;
  }
  on(name, fn) { (this.events[name] = this.events[name] || []).push(fn); return { name, fn }; }
  off(name, fn) { this.events[name] = (this.events[name] || []).filter((x) => x !== fn); }
  offref(ref) { if (ref) this.off(ref.name, ref.fn); }
  fire(name, ...args) { for (const fn of this.events[name] || []) if (typeof fn === "function") fn(...args); }
}

class FakeMetadataCache {
  constructor(vault) { this.vault = vault; this.handlers = []; }
  getFileCache(file) {
    const text = this.vault.files.get(file?.path);
    if (text === undefined) return null;
    const [front, body] = splitFront(text);
    const sections = [];
    if (front !== null) sections.push({ type: "yaml" });
    if (body.trim()) sections.push({ type: "paragraph" });
    const headings = [...body.matchAll(/^(#{1,6})\s+(.+)$/gm)].map(m => ({ level: m[1].length, heading: m[2] }));
    try { return front === null ? { sections, headings } : { frontmatter: parseYaml(front), sections, headings }; }
    catch { return { sections }; }
  }
  // As Obsidian resolves: the full path, then a path ending in the link («b/Plan»), then the name;
  // nothing for a link that matches nothing.
  getFirstLinkpathDest(link, from) {
    const want = link.replace(/\.md$/, "");
    const paths = [...this.vault.files.keys()];
    const bare = (p) => p.replace(/\.md$/, "");
    const hit = paths.find((p) => bare(p) === want)
      || paths.find((p) => bare(p).endsWith("/" + want))
      || paths.find((p) => bare(p).split("/").pop() === want.split("/").pop());
    return hit ? this.vault.file(hit) : null;
  }
  // The shortest text that still names this note alone: its name, or its path when another note has that name.
  fileToLinktext(file) {
    if (!file.path) return file.basename;   // a bare {basename} stub some tests hand in
    const twins = [...this.vault.files.keys()].filter((p) => p !== file.path && p.replace(/\.md$/, "").split("/").pop() === file.basename);
    return twins.length ? file.path.replace(/\.md$/, "") : file.basename;
  }
  on(name, fn) { this.handlers.push({ name, fn }); return { name, fn }; }
  off() {}
  trigger(name, ...args) { for (const h of this.handlers) if (h.name === name) h.fn(...args); }
}

class FakeFileManager {
  constructor(vault, cache) { this.vault = vault; this.cache = cache; }
  async processFrontMatter(file, fn) {
    const text = this.vault.files.get(file.path);
    if (text === undefined) throw new Error("no such file: " + file.path);
    const [front, body] = splitFront(text);
    const fm = front === null ? {} : parseYaml(front);
    fn(fm);
    const next = "---\n" + stringifyYaml(fm) + "---\n" + (body ? (body.startsWith("\n") ? body : "\n" + body) : "\n");
    this.vault.files.set(file.path, next);
    this.vault.fire("modify", file);
  }
  async renameFile(file, to) { return this.vault.rename(file, to); }
  async trashFile(file) { return this.vault.trash(file); }
}

export class FakeApp {
  constructor() {
    this.vault = new FakeVault();
    this.metadataCache = new FakeMetadataCache(this.vault);
    this.fileManager = new FakeFileManager(this.vault, this.metadataCache);
    this.notices = [];
    this.storage = new Map();
    this.plugins = { plugins: {} };
    this.keymap = { pushScope() {}, popScope() {} };
    this.workspace = {
      activeLeaf: null,
      getLeaf: () => ({ openFile: async () => {} }),
      getLeavesOfType: () => [],
      getActiveFile: () => null,
      iterateAllLeaves() {},
      on: () => ({}),
      off() {},
      revealLeaf() {},
      setActiveLeaf() {},
    };
    this.commands = { commands: {}, executeCommandById() {} };
  }
  loadLocalStorage(k) { return this.storage.get(k) ?? null; }
  saveLocalStorage(k, v) { v === null ? this.storage.delete(k) : this.storage.set(k, v); }
}

// --- the obsidian module the plugin requires -------------------------------------------------

function obsidianStub(app) {
  const noop = () => {};
  class Component {
    constructor() { this.children = []; }
    addChild(c) { this.children.push(c); return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); }
    registerEvent() {}
    registerDomEvent() {}
    load() {}
    unload() {}
  }
  class Plugin extends Component {
    constructor(a, manifest) { super(); this.app = a || app; this.manifest = manifest || { version: "test" }; this._data = null; }
    async loadData() { return this._data; }
    async saveData(d) { this._data = JSON.parse(JSON.stringify(d)); }
    addRibbonIcon() { return { addClass: noop }; }
    addSettingTab() {}
    addCommand(cmd) { (this.commands = this.commands || []).push(cmd); }
    registerView() {}
    registerObsidianProtocolHandler(name, handler) { (this.protocolHandlers ||= {})[name] = handler; }
    registerMarkdownCodeBlockProcessor(name, fn) { (this.codeProcessors ||= new Map()).set(name, fn); }
    registerEvent() {}
  }
  class Notice {
    constructor(message) { app.notices.push(typeof message === "string" ? message : "(fragment)"); }
    hide() {}
  }
  const moment = createRequire(import.meta.url)("moment");
  return {
    Plugin, Notice, Component, moment,
    PluginSettingTab: class {}, Setting: class {}, ItemView: class {}, Modal: class {},
    SuggestModal: class {}, FuzzySuggestModal: class {}, Menu: class { addItem() { return this; } addSeparator() {} showAtMouseEvent() {} },
    MarkdownRenderChild: class extends Component {}, MarkdownRenderer: { render: async () => {} },
    Keymap: { isModEvent: () => false }, setIcon: noop, prepareSimpleSearch: () => () => true,
    Platform: { isMobile: false, isMacOS: true }, Scope: class { register() {} }, parseYaml, stringifyYaml,
    normalizePath: (p) => p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "") || "/",
    createFragment: (fn) => { const f = { appendText: noop, createEl: () => ({}) }; fn(f); return f; },
  };
}

// --- loading the plugin ------------------------------------------------------------------------

export async function loadPlugin(app, settings = {}) {
  const require2 = createRequire(import.meta.url);
  const stub = obsidianStub(app);
  const cache = require2.cache;
  const id = require2.resolve(path.join(ROOT, "main.js"));
  delete cache[id];
  const Module = require2("node:module");
  const original = Module.prototype.require;
  Module.prototype.require = function (name) {
    if (name === "obsidian") return stub;
    return original.apply(this, arguments);
  };
  let PluginClass;
  try {
    PluginClass = require2(path.join(ROOT, "main.js"));
  } finally {
    Module.prototype.require = original;
  }
  globalThis.window = globalThis.window || { localStorage: { getItem: () => "en" } };
  globalThis.createFragment = stub.createFragment;
  globalThis.document = globalThis.document || { body: {}, createElement: () => ({}) };
  const plugin = new PluginClass(app, { version: "test" });
  plugin._data = { settings: Object.assign({ language: "en", folder: "Areas", tasksFolder: "Tasks", typeArea: "area", typeProject: "project" }, settings) };
  await plugin.onload();
  return plugin;
}

// --- writing notes into the fake vault ----------------------------------------------------------

let seq = 0;
export const uid = () => "ft-test" + (++seq);

export function writeNote(app, filePath, fields, body = "") {
  const text = "---\n" + stringifyYaml(fields) + "---\n" + (body ? "\n" + body + "\n" : "\n");
  app.vault.files.set(filePath, text);
  return app.vault.file(filePath);
}

export function areaNote(app, name, extra = {}) {
  return writeNote(app, `Areas/${name}.md`, { area: name, type: "area", ...extra });
}

export function projectNote(app, area, name, extra = {}) {
  return writeNote(app, `Areas/${name}.md`, { area, type: "project", ...extra });
}

export function taskNote(app, name, fields = {}, body = "") {
  const front = { uid: uid(), type: "задача", status: "open", ...fields };
  if (front.project) { front.projects = [`[[${front.project}]]`]; delete front.project; }
  return writeNote(app, `Tasks/${name}.md`, front, body);
}

export const frontmatter = (app, filePath) => {
  const text = app.vault.files.get(filePath);
  if (text === undefined) return null;
  const [front] = splitFront(text);
  return front === null ? {} : parseYaml(front);
};

export const bodyOf = (app, filePath) => splitFront(app.vault.files.get(filePath) || "")[1];

export const paths = (app) => [...app.vault.files.keys()].sort();
