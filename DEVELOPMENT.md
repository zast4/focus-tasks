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
- every exchange, code or not, is appended to `~/ai-hub/data/focus-tasks/review-log.md` — a commit,
  an answer to a question, an edit of his data. Written as he would need to read it, having read
  nothing else. Without that file the rule below depends on my remembering the conversation.
- **«ревью»** → report everything that happened since the last merge, not only the code: the commits
  in `git log shipped..next` **and every entry of the review log**, grouped by what changed for him.
  Questions he asked in between are answered again, in full. He reads nothing of the running
  commentary, so the report is the only thing he sees — it always starts at `shipped`, however many
  rounds went into it.
- **«вливай»** → merge `next` into `notes-model`, deliver it as the stable build, reload the plugin
  over CDP, then move the tag: `git tag -f shipped notes-model` and empty the review log down to its
  heading. All three suites must be green before the merge.
- **«покажи» / a test drive** → deliver the current build as `test` without merging. He keeps the
  stable one a click away and decides afterwards.

## Two builds in his vault

He cannot read git, and the branch checked out here says nothing about what his Obsidian runs — it
runs the copies in the plugin folder. Worse, he reads the vault on a second machine over Obsidian
Sync, and Sync carries a plugin's own three files but **not** the extras left beside them. So the
answer travels inside the code, and the spares live in the vault:

```
.obsidian/plugins/focus-tasks/main.js   ← `const BUILD = {mode, commit, subject, at, queue}` is stamped here
Internals/FocusTasks/stable/…  test/…   ← the two builds it can be switched between, each with build.json
```

```sh
node tools/deliver.mjs --mode test     # hand it over for a look; the stable one stays a click away
node tools/deliver.mjs --mode stable   # merged: both modes become this build
```

`readBuild` just reads that constant — no file, no race, nothing to lose in a sync. The first row of
the settings says what is running («Сборка: Тестовая · 23.09 19:40 · заголовок») and always carries
**both** buttons; a mode is clickable only when its files are in the vault and are somewhere else to
go (`buildChoices` greys out the running one and, when the two builds are the same commit, the other
one too). `switchBuild` copies the three files from `Internals/FocusTasks/<mode>` over the plugin's
own and restarts it. The list carries a small «тест» mark in its footer while a test build runs.
Installed the ordinary way (BRAT, the store) `BUILD.mode` is `null`: no row, no mark, and instead the
list and the settings carry the «still being built» line with the Telegram contact — which is what
the public 0.2.1 release exists to say.

**«ревью» starts with the state**: which build he is running, and how many commits are queued over
the stable one — then the report of everything in the review log.

The branch holds plugin code only. His notes — `Задачи/`, areas and projects — are live data:
touch them only when he asks, and then write them straight into the vault he is working in, so he
sees the change at once. Data never waits for a merge. His ticks are his: do not mark a task done,
and do not reopen one that turned done while you were working.

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
  - `checkboxLeftovers()` counts `- [ ]` lines in the area notes; the view shows the 0.1.0 upgrade
    hint when there are no task notes at all.
  - a project with `finished` (everything in it checked off today) renders as a header only, `is-done`
    + «done N», no body — its «+» still adds the next step, which makes it ordinary again.
  - `askReturn` + `setRunning`: `status: in-progress` — started and out of his hands. Sending a task
    off is a question, not a toggle: `askReturn` opens the picker as a card («Вернуться к задаче», a
    plain calendar, today by default, the hour in two keyboard-only segments, `min` = today, no
    «clear»), and only an answer writes anything — `setRunning(list, true, day, at)` puts the status
    and `scheduled` in one change (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`). Cancel the card and the task
    is untouched.
    **Running is not a list of its own.** «Not today» is one answer whoever holds the task, so a
    running task waits where the upcoming ones wait: `area.future.loose` / `bucket.later`, behind the
    same «⏳N», sorted by its own date. `area.running` / `bucket.running` only count them — to keep an
    area that holds nothing else in the focus (`areas.filter(a => a.focus || a.done.length ||
    a.running)`, or the counter and the way back would vanish with it) and to say «из них запущено N»
    on the chip. The ▷ on the row is the whole visible difference. `backDue(task)` decides waiting or
    back: the day, or the exact moment when an hour was named. Nothing in the vault changes at 16:00,
    so the list watches the clock itself: `pending` is every waiting task **as the model sees it**
    (taking it from the rendered rows meant a folded group was not watched at all), `setAlarm()` fires
    a timeout on the nearest moment to the second, and a 30-second sweep behind it covers a machine
    that slept through the timeout. `wake()` skips the redraw while a card or a drag is open. ▷ is on **every** row (`is-offer`, shown on hover): on an ordinary one it opens the
    card, on a running one it hands the task back into today's focus, dropping the hour. Clicking the
    date of a running task opens the card again; clearing its day any other way (`setDate(task, null)`)
    hands it back too. `obsidian_tasks.py` keeps such tasks out of the bot's focus reports until the
    day arrives (`running_ahead()`, day part only).
  - `priorityItems(menu, task|tasks)` + `setPriority`: the levels of TaskNotes' `priority`, and
    `null` to take the mark off; reachable from the dot itself, the row's menu and a selection's.
  - `chip(head, …)`: a counter that folds a part of a row — «⏳N» upcoming (`steps-later:<path>`,
    closed by default) and «✓N» closed today (`done:<path>` / `done:<area>`, open by default). On a
    project it also unfolds the project, or the rows it opens would stay hidden.
  - `completed(box, done, key, inProject)`: the closed work of the day under a hairline, with no
    heading of its own — inside its project for a step, at the bottom of the area for a loose task
    (then the row names no project). Its rows are not tracked, so selection and drag skip them.
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

### TaskNotes in one click

`COMPANION` holds its id, repo and the property we identify tasks by. `installCompanion()` goes
through `app.plugins.installPlugin` — Obsidian's own installer, **not public API**: it is feature-
checked, and without it the user is sent to the plugin browser. `tuneCompanion()` writes
`taskIdentificationMethod` / `taskPropertyName` / `taskPropertyValue` / `tasksFolder` into TaskNotes'
settings and calls its `saveSettings()`, but only when all four keys are already there — if it ever
renames them we say so instead of writing nonsense. `companionAimed()` is what the settings row reads.

## The data contract

Other tools read the same notes, so keep these stable:

- an **area** = a note in the folder with `area:` in its frontmatter; `type:` = the project word
  (`project` / `проект`) makes it a **project**, anything else an area;
- a **task** = a note of its own in the tasks folder (`Задачи` by default) with `type: задача`:
  - `uid` — its identity, never changes (a rename or a move keeps it);
  - `status`: `open` / `in-progress` / `done` / `cancelled` / `someday`; `in-progress` is TaskNotes'
    own built-in status, so a task sent off reads the same in both plugins, and `obsidian_tasks.py`
    keeps it out of every focus report (`OUT_OF_FOCUS`). The plugin never writes `in-progress` without
    a `scheduled` day: that day is the one the task comes back on, and it is the only date in this
    model allowed to carry an hour (`2026-09-24T16:30`); everything else is planned by the day;
  - `area` — the area's name, `projects` — a list with a wikilink to the project's note (absent = a
    loose task; we keep one project per task, the list is TaskNotes' shape);
  - `scheduled` — the date the focus goes by (`task.date` is its day, `task.at` the hour when one was
    written), `due`, `completedDate` — the day it was checked off;
  - `priority`: `low` / `normal` / `high`; `title` — the whole text when the file name had to be cut;
  - the body of the note is the task's description;
- the file name is a readable label only: it follows the text, the `uid` does not;
- a linked note = `note: "[[...]]"` in an area's or a project's note;
- the order the rows were dragged into lives in `data.json` (`order.tasks["area:<name>" | "project:<note>"]`);
- what is **folded** does not: it lives per device in local storage (`focus-tasks-folds`, beside
  `focus-tasks-all`). In `data.json` it travelled with Sync, and two machines on one vault folded each
  other's headers back open — a click that undid itself a second later. The first run on a device
  still inherits whatever `data.json` remembers.

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

It must pass (48/48) before a release, together with the model suite (126) and the phone suite (15). On failure the vault stays open and screenshots go to
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
