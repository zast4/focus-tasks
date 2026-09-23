# Developing Focus Tasks

No build step: `main.js` is the plugin as Obsidian loads it (plain CommonJS against the
`obsidian` API), `styles.css` next to it. Edit, reload the plugin, test.

## Branches: he keeps working while we change things

He uses this plugin every day, so new work must never land in his vault on its own.

- `notes-model` — the branch his vault runs. Only a merge puts anything here.
- `next` — where all new work goes. Commit freely, run the suites, do not deploy.
- tag `shipped` — the last commit that reached his vault. Everything after it is unreported.

Three words drive it:

- he says nothing → keep committing to `next`; his vault stays exactly as it is.
- **«ревью»** → report everything in `git log shipped..next` as one summary, oldest first,
  grouped by what changed for him, not by commit. He does not track what he has already read,
  so the report always starts at `shipped`, however many rounds went into it.
- **«вливай»** → merge `next` into `notes-model`, copy `main.js`, `manifest.json`,
  `styles.css` into `~/vaults/Vault/.obsidian/plugins/focus-tasks/`, reload the plugin over
  CDP, then move the tag: `git tag -f shipped notes-model`. All three suites must be green
  before the merge.

His notes are not branchable — `Задачи/`, areas and projects are live data. Touch them only
when he asks, whatever branch is checked out.

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
  - `area` — the area's name, `projects` — a list with a wikilink to the project's note (absent = a
    loose task; we keep one project per task, the list is TaskNotes' shape);
  - `scheduled` — the date the focus goes by, `due`, `completedDate` — the day it was checked off;
  - `priority`: `low` / `normal` / `high`; `title` — the whole text when the file name had to be cut;
  - the body of the note is the task's description;
- the file name is a readable label only: it follows the text, the `uid` does not;
- a linked note = `note: "[[...]]"` in an area's or a project's note;
- the order the rows were dragged into lives in `data.json` (`order.tasks["area:<name>" | "project:<note>"]`).

Tasks the plugin does not touch: `cancelled` and `someday` (хотелки in ordinary notes are not migrated
yet). The Tasks plugin is not part of this model — a task is no longer a checkbox line.

### TaskNotes on the same notes

The field names and their values are TaskNotes' own, so that plugin can be installed on the same
vault and bring its recurrence, reminders, time tracking, calendar and Bases views for free. Checked
by hand on a copy of the real vault (147 tasks), TaskNotes 4.13.4:

- in its settings, **Task identification** → *Property*, `type` = `задача`, tasks folder `Задачи`;
  its default Bases views filter by the `#task` tag, so delete `TaskNotes/Views/` once and let it
  write them again — the filter then reads `list(note["type"]).contains("задача")`;
- it reads all our notes, and its edits keep `uid` and `area` (it never drops unknown keys);
- it writes `complete_instances`, `timeEntries`, `dateModified`, `recurrence` into our notes; our
  plugin and `obsidian_tasks.py` keep those keys (block lists included) when they write;
- a task it creates has no `area` (and no `uid`): the plugin takes the area from the task's project
  and writes a `uid` on the first change. A task with neither an area nor a project stays invisible
  to us — that is TaskNotes' own inbox;
- a repeating task (`recurrence`) is not finished by a tick: the checkbox asks TaskNotes to complete
  that one occurrence, so the note rolls on to the next date. Without TaskNotes installed the tick
  completes the task as usual.

## Tests

`test/e2e.mjs` drives a real Obsidian over the Chrome DevTools Protocol: it builds a fresh vault
(`test/focus-tasks-e2e/`), opens it in a new window, installs the plugin from this folder and goes
through every feature with real mouse and keyboard input, checking the files on disk.

```sh
open -a Obsidian --args --remote-debugging-port=9222   # any vault open
npm install
node test/model.mjs                                    # the data layer, no Obsidian needed
node test/e2e.mjs                                      # --keep leaves the vault open
node test/mobile.mjs                                   # the same in mobile emulation, with touch
```

`test/model.mjs` runs `main.js` in node against a fake Obsidian (`test/harness.mjs`): a vault in
memory with the same frontmatter rules. It is where the nasty cases live — junk YAML, dates with a
time, duplicate uids, two projects of one name, renames that collide, order after a move, four fuzz
rounds over random vaults that hold one invariant: **no open task may be invisible**. It takes a
second, so run it on every change.

`test/mobile.mjs` turns on Obsidian's own mobile emulation (a setting of the whole app — both suites
switch it deliberately, or the desktop run silently tests the phone build) and drives the list with
touch events on a 390×844 screen.

What each scenario is for, and which test holds it: `SCENARIOS.md`.

It must pass (39/39) before a release, together with the model suite (89) and the phone suite (14). On failure the vault stays open and screenshots go to
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
