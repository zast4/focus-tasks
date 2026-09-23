#!/usr/bin/env node
// Folds a task's one-line description into its own name: «Заголовок. Описание».
//
//   node tools/fold-descriptions.mjs --vault <путь> [--folder Задачи] [--lines 1] [--apply]
//
// A task is a service note: what it is about belongs in its name, and a real plan belongs in a
// project. Notes whose body is longer than `--lines` are left alone and listed at the end — they are
// the candidates for «Make it a project».
//
// The whole text lives in `title` (the file name is cut to 60 characters, as the plugin does), so
// nothing is lost when a name is long. Without --apply nothing is written.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf("--" + name); return i < 0 ? fallback : args[i + 1]; };
const VAULT = path.resolve(flag("vault") || ".");
const FOLDER = flag("folder", "Задачи");
const LIMIT = Number(flag("lines", "1"));
const APPLY = args.includes("--apply");
const NAME_MAX = 60;

const fileName = (name) => name.replace(/[\\/#^\[\]|?*<>":]/g, "-").replace(/\s+/g, " ").trim();

const split = (text) => {
  if (!text.startsWith("---\n")) return [null, text];
  const end = text.indexOf("\n---", 3);
  if (end < 0) return [null, text];
  return [text.slice(4, end), text.slice(end + 4).replace(/^\n/, "")];
};

const field = (front, key) => front.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1]?.trim().replace(/^["'](.*)["']$/s, "$1") || null;

// `title: …` set, replaced or removed, keeping every other line as it was.
function setTitle(front, title) {
  const lines = front.split("\n").filter((l) => !/^title:/.test(l));
  if (title) lines.push(`title: ${JSON.stringify(title)}`);
  return lines.join("\n");
}

const folder = path.join(VAULT, FOLDER);
if (!fs.existsSync(folder)) { console.error(`нет папки ${folder}`); process.exit(1); }

const folded = [], skipped = [], untouched = [];
for (const name of fs.readdirSync(folder).sort()) {
  if (!name.endsWith(".md")) continue;
  const file = path.join(folder, name);
  const text = fs.readFileSync(file, "utf8");
  const [front, body] = split(text);
  if (front === null || !/^type:\s*(задача|task)\s*$/m.test(front)) continue;
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) { untouched.push(name); continue; }
  if (lines.length > LIMIT || lines.some((l) => /^[-*]\s*\[[ xX-]\]/.test(l) || /^#{1,6}\s/.test(l))) {
    skipped.push({ name: name.replace(/\.md$/, ""), lines: lines.length });
    continue;
  }
  const was = field(front, "title") || name.replace(/\.md$/, "");
  const tail = lines[0].replace(/\s+/g, " ").trim();
  if (was.includes(tail)) { untouched.push(name); continue; }   // already said in the name
  const title = `${was.replace(/[.\s]+$/, "")}. ${tail}`;
  const short = fileName(title).slice(0, NAME_MAX).trim();
  const next = "---\n" + setTitle(front, short === title ? null : title) + "\n---\n";
  folded.push({ file, name: name.replace(/\.md$/, ""), title, rename: short !== name.replace(/\.md$/, "") ? short : null, next });
}

console.log(`описаний в одну строку свёрнуто в название: ${folded.length}`);
console.log(`оставлено как есть (план в теле, ${LIMIT} стр. и больше): ${skipped.length}`);
console.log(`без описания: ${untouched.length}`);

if (!APPLY) {
  console.log("\nбез --apply ничего не записано. Примеры:");
  for (const item of folded.slice(0, 5)) console.log(`  ${item.name}\n    → ${item.title}`);
  if (skipped.length) {
    console.log("\nкандидаты в проекты (тело длиннее одной строки):");
    for (const item of skipped) console.log(`  ${item.name} — ${item.lines} стр.`);
  }
  process.exit(0);
}

const taken = new Set(fs.readdirSync(folder));
let renamed = 0;
for (const item of folded) {
  fs.writeFileSync(item.file, item.next);
  if (item.rename) {
    let base = item.rename, i = 2;
    while (taken.has(base + ".md")) base = `${item.rename} (${i++})`;
    fs.renameSync(item.file, path.join(folder, base + ".md"));
    taken.delete(path.basename(item.file));
    taken.add(base + ".md");
    renamed++;
  }
}
console.log(`\nзаписано: ${folded.length}, из них переименовано файлов: ${renamed}`);
if (skipped.length) console.log(`не тронуто (кандидаты в проекты): ${skipped.map((x) => x.name).join(", ")}`);
