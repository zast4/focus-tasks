# Developing Focus Tasks

No build step: `main.js` is the plugin as Obsidian loads it (plain CommonJS against the
`obsidian` API), `styles.css` next to it. Edit, reload the plugin, test.

## Layout of main.js

- **Strings** — `STRINGS.en` / `STRINGS.ru`, `t(key, ...args)`; every visible label goes through it.
- **Pure helpers** — `parseLine` (a checkbox line → text, focus date, its emoji), `insertBlock`
  (lines at the end of a section; a missing section is added; an empty one gets a blank line under
  its heading), `blockAt` / `reindent` (a task with its nested lines), `toggleLine` (done without
  the Tasks plugin), `parseDay` (date input of the picker).
- **DatePicker**, **TargetModal**, **NotePicker**, **NameModal**, **ConfirmModal**.
- **FocusRenderer** (`MarkdownRenderChild`) — the whole view. Used by the pane (`FocusView`,
  `ItemView`) and by the ```` ```focus-tasks``` ```` code block.
  - `render()` is serialized (`busy` / `again`) and deferred while editing (`editing`) or dragging
    (`held`); `build()` renders off-screen and swaps in one go, so the scroll doesn't jump.
  - `hold()` pins a button on screen for a moment after «All» / fold-all (Obsidian moves the scroll
    after a re-render).
  - Drag: pointer events on the grip, listened on `window` (a row that re-renders mid-drag must not
    leave the drag hanging); a click without moving opens the row's menu.
  - Selection: `select` (Shift / Cmd-click, on mousedown), `paint` (after every render the selection
    follows its tasks by note + line), `chosen` (screen order); the grip of a selected row drags the
    group, `editDate`, `selectionMenu` and `keys` (a `Scope` with Mod+1…4 and Esc, pushed while rows are
    selected and the list's tab is active, so Obsidian's «go to tab» elsewhere is untouched) date it. The row map `items` is swapped together with the
    DOM (`fresh` while building), so a click during a render still finds its row.
  - `check`: a box marks its row at once and ignores further clicks until the list is re-read (a
    second click would undo the first); a failed write puts the row back. `toggle` holds one toggle
    per line in the plugin, so the same task clicked in two views does not toggle twice.
  - `completed(box, done, key)`: «Completed · N» — under a project for its steps, under an area for its
    loose tasks (✅ today from `fileTasks`), folded by the `done:<area|path>` key; its rows are not
    tracked, so selection and drag skip them.
  - Rows are a grid: the box lives in `.ft-box`, a cell one line tall (`--ft-line`), and is centred in
    it — themes size checkboxes in the checkbox's own em, so a computed margin misses by a few pixels.
  - Inline editing: `editor()` (contenteditable, Enter / Esc / blur, Mod+digit hotkeys via a `Scope`),
    `editInline`, `rowAfter`, `draft`, `renameProject`, `projectRow`.
  - `open(file)` never replaces the pane itself with the note.
- **FocusSettingTab**.
- **Plugin** — settings + `data` (`folded`, `opened`, `order`) in `data.json`; «All» per device in
  local storage; `classify` / `notes` / `fileTasks` / `collect` (the model); task edits (`change` — rewrites the task's line
  wherever it is now, from the line as the note has it, and `watch` warns when the note is saved over
  the change a moment later; `replace`, `setDate`,
  `setDates`, `moveTasks`, `remove` with undo, `rename`, `insertAfter`, `addLine`, `toggle`); areas and projects
  (`createArea`, `createProject`, `renameProject`, `deleteProject` / `deleteArea`, linked notes:
  `linked`, `setLinked`, `pickNote`, `areaFromNote`, `projectFromNote`).

## The data contract

Other tools read the same notes, so keep these stable:

- an **area** = a note in the folder with `area:` in its frontmatter; `type:` = the project word
  (`project` / `проект`) makes it a **project**, anything else an area;
- a **task** = a note of its own in the tasks folder (`Задачи` by default) with `type: задача`:
  - `uid` — its identity, never changes (a rename or a move keeps it);
  - `status`: `open` / `done` / `cancelled` / `someday`;
  - `area` — the area's name, `project` — a wikilink to the project's note (absent = a loose task);
  - `scheduled` — the date the focus goes by, `due`, `done` — the day it was checked off;
  - `priority`: `low` … `highest`; `title` — the whole text when the file name had to be cut;
  - the body of the note is the task's description;
- the file name is a readable label only: it follows the text, the `uid` does not;
- a linked note = `note: "[[...]]"` in an area's or a project's note;
- the order the rows were dragged into lives in `data.json` (`order.tasks["area:<name>" | "project:<note>"]`).

Tasks the plugin does not touch: `cancelled` and `someday` (хотелки in ordinary notes are not migrated
yet). The Tasks plugin is not part of this model — a task is no longer a checkbox line.

## Tests

`test/e2e.mjs` drives a real Obsidian over the Chrome DevTools Protocol: it builds a fresh vault
(`test/focus-tasks-e2e/`), opens it in a new window, installs the plugin from this folder and goes
through every feature with real mouse and keyboard input, checking the files on disk.

```sh
open -a Obsidian --args --remote-debugging-port=9222   # any vault open
npm install
node test/e2e.mjs                                      # --keep leaves the vault open
```

It must pass (32/32) before a release. On failure the vault stays open and screenshots go to
`test/shots/`. What the test learned the hard way:

- input reaches a window only while it is in front — every click/key calls `Page.bringToFront`;
- the first click on a fresh window only activates it (macOS) — the test spends one on an empty spot;
- an old window of the same vault that is still closing takes a new one down — wait until it is gone;
- the list re-renders a moment after a file changes (Obsidian re-reads it): read positions only
  after the list has held still, and wait for the exact row state you expect;
- settings open in a window of their own (Obsidian 1.13) — read them through `app.setting.activeTab`.

Not covered: the phone (layout, touch drag).

## Release

```sh
npm version 0.2.0          # bumps package.json, manifest.json, versions.json; tag without "v"
git push && git push origin 0.2.0
```

The GitHub Action publishes a release with `main.js`, `manifest.json`, `styles.css` and a zip;
BRAT users get it on their next update check. Commits use the GitHub noreply email.
