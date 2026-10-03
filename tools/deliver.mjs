#!/usr/bin/env node
// Puts a build into the vault and says, inside the code itself, which one it is.
//
//   node tools/deliver.mjs --mode test      # hand it over for a look; the stable one stays a click away
//   node tools/deliver.mjs --mode test --stage-only  # prepare the spare without changing the running plugin
//   node tools/deliver.mjs --mode stable    # merged: both modes become the same build
//
// Two places are written:
//   .obsidian/plugins/focus-tasks/         — the copy that runs
//   Internals/FocusTasks/{stable,test}/    — the two it can be switched between, with a build.json each
//
// The spare builds live in the vault, not beside the plugin. Obsidian Sync carries a plugin's own
// three files to the other machine and leaves anything else next to them behind — which is how the
// laptop ended up running a delivered build that believed it was a stranger's install. For the same
// reason the identity of a build is baked into its `main.js` (the `const BUILD = …` line) instead of
// travelling in a file of its own.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FILES = ["main.js", "manifest.json", "styles.css"];
const ROOT = "Internals/FocusTasks";

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const mode = arg("mode");
const stageOnly = process.argv.includes("--stage-only");
if (stageOnly && mode !== "test") throw new Error("--stage-only is for a test candidate");
if (!["stable", "test"].includes(mode)) {
  console.error("usage: deliver.mjs --mode stable|test [--stage-only] [--vault <path>] [--stable-ref <ref>]");
  process.exit(2);
}
const vault = arg("vault", path.join(process.env.HOME, "vaults/Vault"));
const stableRef = arg("stable-ref", "shipped");   // the tag that marks what was merged last
const plugin = path.join(vault, ".obsidian/plugins/focus-tasks");
if (!fs.existsSync(plugin)) {
  console.error(`no plugin folder in the vault: ${plugin}`);
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { cwd: HERE }).toString().trim();
const [commit, subject] = git("log", "-1", "--format=%h%x00%s").split("\0");
// How far this build is ahead of what was merged: the number the settings show on a test build.
let queue = 0;
try { queue = Number(git("rev-list", "--count", `${stableRef}..HEAD`)); } catch { /* no tag yet */ }

const stamp = (as) => ({ mode: as, commit, subject, at: new Date().toISOString(), queue: as === "test" ? queue : 0 });

// The one line in main.js that says which build this is; everything else is copied byte for byte.
const LINE = /^const BUILD = \{[^\n]*\};$/m;
const source = fs.readFileSync(path.join(HERE, "main.js"), "utf8");
if (!LINE.test(source)) {
  console.error("main.js has no `const BUILD = {…};` line to stamp");
  process.exit(1);
}
const baked = (as) => source.replace(LINE, `const BUILD = ${JSON.stringify(stamp(as))};`);

// Written whole or not at all: these files are read at moments we do not choose.
const atomic = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
};

const put = (dir, as) => {
  for (const file of FILES) {
    if (file === "main.js") atomic(path.join(dir, file), baked(as));
    else atomic(path.join(dir, file), fs.readFileSync(path.join(HERE, file)));
  }
  atomic(path.join(dir, "build.json"), JSON.stringify(stamp(as), null, 2) + "\n");
};

// Merged means both modes are this build, so the settings say «the test build is the stable one»
// and neither button has anywhere to go.
const modes = mode === "stable" ? ["stable", "test"] : ["test"];
for (const as of modes) put(path.join(vault, ROOT, as), as);
for (const file of stageOnly ? [] : FILES) {
  if (file === "main.js") atomic(path.join(plugin, file), baked(mode));
  else atomic(path.join(plugin, file), fs.readFileSync(path.join(HERE, file)));
}

// What the older scheme left beside the plugin: unread now, and Sync keeps trying to carry it.
if (!stageOnly) {
  fs.rmSync(path.join(plugin, "build.json"), { force: true });
  fs.rmSync(path.join(plugin, "builds"), { recursive: true, force: true });
}

console.log(`${mode}: ${commit} ${subject}${mode === "test" && queue ? ` (+${queue} over ${stableRef})` : ""}`);
