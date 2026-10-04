# Developing Focus Tasks

No build step: `main.js` is the plugin as Obsidian loads it (plain CommonJS against the
`obsidian` API), `styles.css` next to it. Edit, reload the plugin, test.

## Branches: he keeps working while we change things

He uses this plugin every day, so new work must never land in his vault on its own.

- `shipped` identifies the code the vault actually runs. `notes-model` is the stable integration branch and may lag that verified tag.
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
node tools/deliver.mjs --mode test --stage-only # prepare a candidate; keep the running build
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

- Pure helpers parse/format dates, classify statuses, split exact frontmatter fences and
  create readable names and independent UIDs.
- DatePicker supports day-only auto-save and explicit hour/minute cards. Invalid input
  and failed writes preserve the card. Scrolling unrelated panes cannot commit it.
- FocusRenderer draws global Focus/All/Waiting/closed views and local project/area blocks;
  owns selection, shortcuts, editing, menus, touch drag and their lifecycle.
- FocusTasks reads canonical task notes, indexes containers, and serializes mutations.
  `track` explicitly joins only calls with the transaction token. `frontOwned` and
  `processOwned` record exact bytes inside atomic vault callbacks for safe Undo.
- Undo checks file identity/content and order conflicts, reverses owned renames through
  Obsidian, preserves external writes and does not resurrect external deletion.
- Settings explain the running build, optional TaskNotes and Calendar acknowledgement.
- `bridge/` owns one-way Apple Calendar notification reconciliation outside Obsidian.
  Credentials and Python environments stay outside the vault and repository.

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
  - `status`: `open` / `waiting` / `done` / `cancelled` / `someday`. `waiting` means
    look again on the scheduled day/hour. TaskNotes' `in-progress` is active work;
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
node test/mobile.mjs                                   # mobile emulation, with touch
node --test test/audit.mjs test/archive-repair.mjs test/delivery.mjs # failures/concurrency/delivery
node --test test/stress.mjs                              # histories + 10,000 tasks
node test/e2e.mjs --with-tasks                           # actual installed Tasks
node test/e2e.mjs --with-tasknotes                        # actual installed TaskNotes
python -m unittest discover -s bridge -p test_calendar.py # calendar Python environment required
```

`test/model.mjs` runs `main.js` in node against a fake Obsidian (`test/harness.mjs`): a vault in
memory with the same frontmatter rules. It is where the nasty cases live — junk YAML, dates with a
time, duplicate uids, two projects of one name, renames that collide, order after a move, four fuzz
rounds over random vaults that hold one invariant: **no open task may be invisible**. It takes a
second, so run it on every change.

`test/mobile.mjs` turns on Obsidian's own mobile emulation (a setting of the whole app — both suites
switch it deliberately, or the desktop run silently tests the phone build) and drives the list with
touch events. The layout matrix covers 320/390/430 px and text sizes 18/22/26 px, in the embedded
Focus note, the dedicated pane, area notes and project notes. The same contracts also run after
expanding a project and during inline editing. Fixtures include long titles, an empty project,
one-step and multi-step projects, dated Waiting, deadlines and completed project tasks.

Mobile changes must use the shared row layout: checkbox, full-width action text and wrapping
metadata underneath. Normal mode has no visible grip and no reserved grip cell. Long press opens
the menu; Reorder temporarily adds the grip column and a Done toolbar. Drag handles have their own
touch-action region; short swipes on text keep native scrolling. Done, navigation and backgrounding
end the mode; it is renderer state, never saved to settings or Sync. Project context uses the same
cells, and expanded steps do not add indentation. Avoid absolute offsets for task grips.

Before staging any mobile change:

- Make the new geometry/interaction test fail against the previous build. Use
  `node test/mobile.mjs --layout-only --baseline <commit>`; the fixture vault receives the old code,
  while the working tree stays untouched. A zero-width or missing fixture is a test failure.
- Check first-line alignment, shared columns, usable text width, horizontal overflow, and control
  bounds/intersections. A screenshot existing or a row fitting the viewport does not prove layout.
- Run geometry in both normal and reordering mode. Verify short tap, scrolling, long press,
  duplicate native contextmenu, multi-touch, cancelled drag, mode refresh and navigation cleanup.
- Before dispatching a tap, bring the test window forward, finish scrolling and verify the target
  with `elementFromPoint`. Measure drag endpoints together after scrolling; stale coordinates can
  make a test interact with the wrong task while appearing to test its control.
- Run the full suite and repeat it with the user's theme, for example
  `node test/mobile.mjs --theme <Blue-Topaz-directory>`. Theme files go into the disposable vault.
  If Tasks is enabled, also run that composition with `--with-tasks [plugin-directory]`.
- Inspect the recorded screens in `test/shots/mobile-layout-*.png`, including a narrow screen with
  large text. Verify the project action, loose Waiting task and expanded steps together.
- Report mobile emulation accurately. Native iPhone keyboard, safe areas and Sync still require
  physical-device acceptance; a desktop viewport narrowed to phone width does not replace this suite.

`--layout-only` is for diagnosing layout regressions, never a substitute for the full phone suite.
`--match <regex>` selects named phone scenarios for debugging; include their fixture setup when
the scenario depends on earlier steps. Delivery still requires the full suite.

What each scenario is for, and which test holds it: `SCENARIOS.md`.
The Russian scenario matrix and ZFG loop are in `SCENARIOS.ru.md`.

Every scenario must pass before delivery, in standalone and actual companion configurations.
Model, audit, stress, calendar and phone suites are required too. Report counts from the run.
On failure the vault stays open and screenshots go to
`test/shots/`. What the test learned the hard way:

- input reaches a window only while it is in front — every click/key calls `Page.bringToFront`;
- the first click on a fresh window only activates it (macOS) — the test spends one on an empty spot;
- an old window of the same vault that is still closing takes a new one down — wait until it is gone;
- the list re-renders a moment after a file changes (Obsidian re-reads it): read positions only
  after the list has held still, and wait for the exact row state you expect;
- settings open in a window of their own (Obsidian 1.13) — read them through `app.setting.activeTab`.

Phone layout/touch and offline persistence are tested in mobile emulation. Actual iPhone keyboard,
two-device Sync, native Mac hotkeys and Watch alarms need physical-device acceptance.
See `AUDIT.md`, `SCENARIOS.md` and `CALENDAR_INTEGRATION.md`.

## Release

```sh
npm version 0.2.0          # bumps package.json, manifest.json, versions.json; tag without "v"
git push && git push origin 0.2.0
```

The GitHub Action publishes a release with `main.js`, `manifest.json`, `styles.css` and a zip;
BRAT users get it on their next update check. Commits use the GitHub noreply email.
