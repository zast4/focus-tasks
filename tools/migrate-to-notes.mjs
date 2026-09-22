#!/usr/bin/env node
// Turns checkbox tasks into one note each: «задача = заметка».
//
//   node tools/migrate-to-notes.mjs --vault <путь> [--folder Zettelkasten] [--out Задачи]
//                                   [--wishes] [--apply]
//
// Without --apply nothing is written: the script only reports what it would do. `--wishes` also takes
// the «### TODO» blocks of ordinary notes (хотелки) — they become tasks with `status: someday` and a
// link back to their note.
//
// A task note keeps a readable file name; its identity is `uid`, which never changes.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf("--" + name); return i < 0 ? fallback : args[i + 1]; };
const has = (name) => args.includes("--" + name);
const VAULT = path.resolve(flag("vault") || ".");
const FOLDER = flag("folder", "Zettelkasten");
const OUT = flag("out", "Задачи");
const WISHES = has("wishes");
const APPLY = has("apply");

const DATES = { "⏳": "scheduled", "📅": "due", "🛫": "start", "✅": "done", "➕": "created", "❌": "cancelled" };
const PRIORITY = { "🔺": "highest", "⏫": "high", "🔼": "medium", "🔽": "low", "⏬": "lowest" };
const DATE_RE = /\s*(⏳|📅|🛫|✅|➕|❌)️?\s*(\d{4}-\d{2}-\d{2})/g;
const STATUS = { " ": "open", x: "done", X: "done", "-": "cancelled" };

const read = (p) => fs.readFileSync(p, "utf8");
const frontmatter = (text) => {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const out = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = line.match(/^([a-zA-Zа-яА-Я_-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
};
// A readable file name: no more than 60 characters, cut on a word boundary (the full text stays in
// `title` when it does not fit).
function fileName(name) {
  const clean = name.replace(/[\\/#^\[\]|?*<>":]/g, "-").replace(/\s+/g, " ").trim();
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).replace(/[,;:.\s-]+$/, "") + "…";
}
const yaml = (v) => (/^[\p{L}\p{N} .,:_-]*$/u.test(v) && !v.includes(": ") ? v : JSON.stringify(v));

// "- [ ] Текст 🔽 ⏳ 2026-09-22" → {status, title, priority, dates}
function parseTask(line) {
  const m = line.match(/^(\s*)[-*] \[(.)\] (.*)$/);
  if (!m) return null;
  const dates = {};
  let body = m[3];
  for (const [, mark, day] of body.matchAll(DATE_RE)) dates[DATES[mark]] = day;
  body = body.replace(DATE_RE, "").trim();
  let priority = null;
  for (const [emoji, word] of Object.entries(PRIORITY)) if (body.includes(emoji)) { priority = word; body = body.replace(emoji, "").trim(); }
  return { indent: m[1].length, status: STATUS[m[2]] || "open", title: body.replace(/\s+/g, " ").trim(), priority, dates };
}

let n = 0;
const uid = () => `ft-${Date.now().toString(36).slice(-4)}${(n++).toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 5)}`;
const taken = new Set();
function notePath(title) {
  let base = fileName(title) || "Задача";
  let name = base, i = 2;
  while (taken.has(name.toLowerCase()) || fs.existsSync(path.join(VAULT, OUT, name + ".md"))) name = `${base} (${i++})`;
  taken.add(name.toLowerCase());
  return path.join(OUT, name + ".md");
}

const made = [];
const report = { areas: 0, projects: 0, tasks: 0, nested: 0, wishes: 0, withBody: 0, byStatus: {}, files: 0 };
const edits = new Map();  // source note → new text

function takeTasks(rel, lines, meta) {
  const keep = [];
  for (let i = 0; i < lines.length; i++) {
    const task = parseTask(lines[i]);
    if (!task) { keep.push(lines[i]); continue; }
    // the lines under it: description (indented text) and nested subtasks
    const body = [];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() && /^\s/.test(lines[j]) && (lines[j].match(/^\s*/)[0].length > task.indent)) { body.push(lines[j]); j++; }
    i = j - 1;
    if (task.indent > 0) { report.nested++; keep.push(lines[i]); continue; }  // a subtask goes with its parent
    report.tasks++;
    report.byStatus[task.status] = (report.byStatus[task.status] || 0) + 1;
    if (body.length) report.withBody++;
    const front = { uid: uid(), type: "задача", status: meta.someday ? "someday" : task.status };
    if (meta.area) front.area = meta.area;
    if (fileName(task.title) !== task.title) front.title = task.title;  // the name was cut, keep the whole text
    if (meta.project) front.project = `[[${meta.project}]]`;
    if (meta.source) front.source = `[[${meta.source}]]`;
    if (task.priority) front.priority = task.priority;
    for (const [key, day] of Object.entries(task.dates)) front[key] = day;
    const text = ["---", ...Object.entries(front).map(([k, v]) => `${k}: ${yaml(String(v))}`), "---", "",
      ...(body.length ? [body.map((l) => l.replace(/^\s{1,4}/, "")).join("\n"), ""] : [])].join("\n");
    made.push({ path: notePath(task.title), text, title: task.title, from: rel });
  }
  return keep;
}

// --- task files: areas and projects -------------------------------------------------------------
const dir = path.join(VAULT, FOLDER);
for (const fn of fs.readdirSync(dir)) {
  if (!fn.endsWith(".md")) continue;
  const rel = path.join(FOLDER, fn);
  const text = read(path.join(VAULT, rel));
  const fm = frontmatter(text);
  if (!fm.area) continue;
  const project = /project|проект/i.test(fm.type || "") ? fn.replace(/\.md$/, "") : null;
  report[project ? "projects" : "areas"]++;
  report.files++;
  const kept = takeTasks(rel, text.split("\n"), { area: fm.area, project });
  edits.set(rel, kept.join("\n"));
}

// --- «### TODO» blocks of ordinary notes: хотелки -----------------------------------------------
if (WISHES) {
  const walk = (d) => fs.readdirSync(path.join(VAULT, d), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(d, e.name);
    if (e.isDirectory()) return e.name.startsWith(".") || ["Internals", "Books", "Docs"].includes(e.name) ? [] : walk(rel);
    return e.name.endsWith(".md") ? [rel] : [];
  });
  for (const rel of walk(".").map((p) => p.replace(/^\.\//, ""))) {
    const text = read(path.join(VAULT, rel));
    if (frontmatter(text).area) continue;  // a task file, handled above
    const lines = text.split("\n");
    let inBlock = false, changed = false;
    const kept = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^#{1,4}\s*TODO/i.test(lines[i])) { inBlock = true; kept.push(lines[i]); continue; }
      if (inBlock && /^#{1,6}\s/.test(lines[i])) inBlock = false;
      if (!inBlock || !parseTask(lines[i])) { kept.push(lines[i]); continue; }
      const before = report.tasks;
      const rest = takeTasks(rel, lines.slice(i, i + 1 + 20), { area: null, source: rel.replace(/\.md$/, "").split("/").pop(), someday: true });
      report.wishes += report.tasks - before;
      const eaten = 1 + (20 - (rest.length - 1));
      kept.push(...rest.slice(1));
      i += Math.max(0, eaten - 1);
      changed = true;
    }
    if (changed) edits.set(rel, kept.join("\n"));
  }
}

// --- write or report ---------------------------------------------------------------------------
console.log(`заметок задач будет создано: ${made.length}`);
console.log(`  из файлов задач: ${report.tasks - report.wishes} (области ${report.areas}, проекты ${report.projects})`);
if (WISHES) console.log(`  хотелок из блоков TODO: ${report.wishes}`);
console.log(`  по статусу: ${JSON.stringify(report.byStatus)}`);
console.log(`  с описанием: ${report.withBody} · вложенных подзадач оставлено в описании: ${report.nested}`);
if (!APPLY) {
  console.log("\nбез --apply ничего не записано. Примеры:\n");
  for (const m of made.slice(0, 2)) console.log(`--- ${m.path}\n${m.text}`);
  process.exit(0);
}
// A heading left without its tasks says nothing: drop the empty ones («## Проекты» keeps its links).
function tidy(text) {
  const lines = text.replace(/\n{3,}/g, "\n\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^#{1,6}\s+(.*)$/);
    if (head) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const empty = j >= lines.length || /^#{1,6}\s/.test(lines[j]);
      if (empty && !/проект/i.test(head[1])) { i = j - 1; continue; }
    }
    out.push(lines[i]);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "\n");
}

fs.mkdirSync(path.join(VAULT, OUT), { recursive: true });
for (const m of made) fs.writeFileSync(path.join(VAULT, m.path), m.text);
for (const [rel, text] of edits) fs.writeFileSync(path.join(VAULT, rel), tidy(text));
console.log(`\nзаписано в ${OUT}/ и обновлено исходных заметок: ${edits.size}`);
