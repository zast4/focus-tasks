#!/usr/bin/env node
// Puts a build into the vault and says, on disk, which one it is.
//
//   node tools/deliver.mjs --mode test      # hand it over for a look; the stable one stays a click away
//   node tools/deliver.mjs --mode stable    # merged: this becomes the only build, the test one is dropped
//
// Inside the plugin's folder:
//   main.js, manifest.json, styles.css  — the copy that runs
//   build.json                          — which build that copy is
//   builds/stable/…, builds/test/…      — the two it can be switched between, with their own build.json
//
// The plugin reads build.json itself: the settings say what is running and offer the other mode,
// and the list carries a «test» mark while a test build is the one running.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FILES = ["main.js", "manifest.json", "styles.css"];

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const mode = arg("mode");
if (!["stable", "test"].includes(mode)) {
  console.error("usage: deliver.mjs --mode stable|test [--vault <path>] [--stable-ref <ref>]");
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

const note = JSON.stringify({ mode, commit, subject, at: new Date().toISOString(), queue: mode === "test" ? queue : 0 }, null, 2) + "\n";
const into = path.join(plugin, "builds", mode);
fs.mkdirSync(into, { recursive: true });
for (const file of FILES) {
  fs.copyFileSync(path.join(HERE, file), path.join(into, file));
  fs.copyFileSync(path.join(HERE, file), path.join(plugin, file));   // and it becomes the one running
}
// Written whole or not at all: the plugin reads this file at moments we do not choose, and half of
// it parses as nothing — which is indistinguishable from an ordinary install.
const atomic = (file, text) => {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
};
atomic(path.join(into, "build.json"), note);
atomic(path.join(plugin, "build.json"), note);

// Merged means the two are the same build: both modes stay in the settings, but the test one is no
// longer anywhere else to go, so its button is dead and the list wears no mark.
if (mode === "stable") {
  const twin = path.join(plugin, "builds", "test");
  fs.mkdirSync(twin, { recursive: true });
  for (const file of FILES) fs.copyFileSync(path.join(HERE, file), path.join(twin, file));
  atomic(path.join(twin, "build.json"), JSON.stringify({ ...JSON.parse(note), mode: "test" }, null, 2) + "\n");
}

console.log(`${mode}: ${commit} ${subject}${mode === "test" && queue ? ` (+${queue} over ${stableRef})` : ""}`);
