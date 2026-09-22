# How the list is used, and what proves it works

The plugin exists to run one system: **ZFG** — a short focus of what is due today, an «отложка» of what
has no date, and areas as the only top-level containers. Everything below is written as a day in that
system, followed by the test that holds it. Three suites:

| suite | what it drives | run |
| --- | --- | --- |
| `test/model.mjs` | the data layer against a fake vault (no Obsidian) | `node test/model.mjs` |
| `test/e2e.mjs` | a real Obsidian window, real mouse and keyboard | `node test/e2e.mjs` |
| `test/mobile.mjs` | the same, in Obsidian's mobile emulation, with touch | `node test/mobile.mjs` |

`bash ~/ai-hub/scripts/ticktick/tests/run.sh` covers the scripts that read and write the same notes.

## The day

**Morning: what is due.** The focus lists only areas with a task dated today or earlier; four or five
areas at a time is the ZFG norm, and the list must not pad that with anything else. An area with
nothing due is not in the focus at all — it waits under «All».
→ *model: «morning: only the areas with something due today are in the focus», «an area with nothing
due today is out of the focus and in «All»»*

**Adding during the day.** A task arrives from the phone, from the bot or from «+» on an area. It
lands in that area with today's date (in the upcoming block, without one) and the note is written at
once, so the next device sees it.
→ *model: «two tasks with the same text get their own notes»; e2e: «a click on «Empty» types a task»,
«+ on a project makes steps that point at it»; mobile: ««+» on an area adds a task with the on-screen
keyboard»*

**Moving work.** Tomorrow, a date from the picker, or no date at all — the last one is what sends a
task to the отложка. Several selected rows take one date together.
→ *model: «moving a task to tomorrow takes it out of today», «sending a task to someday clears its
date»; e2e: «⌘2 tomorrow, ⌘4 no date», «the grip of a selected row drags them all; ⌘1–4 date them
all»; mobile: «the date picker fits the screen and sets a date by tap»*

**Stuck work.** A task keeps the date it was first given: its age in the focus is the signal. Two days
late or more, the row says how many days, not only in red.
→ *model: «a task stuck for two weeks is still in the focus, dated in the past»*

**Evening: what got done.** Everything checked off today stays in its area under «Completed», steps of
projects included, each row naming the project it came from. Tomorrow they are gone from the list —
the dates they carry are what the weekly throughput counts.
→ *model: «evening: everything checked off today is counted in its area, and gone tomorrow», «a step
of a project checked off today keeps its area in the focus»; e2e: «the box completes the task: status,
the day, and the area's «Completed» brings it back»*

**A project.** A project is a note; its steps are tasks pointing at it. Only a dated step puts a
project in the focus; a project whose steps are all future lives under «Show upcoming»; a project
whose steps are all done today leaves the focus, and its area stays for what was done.
→ *model: «a project with only future steps goes to the upcoming block», «a project whose steps are
all done today leaves the focus but its area stays»*

**A task that grew.** A task is a service note, not a place to keep a plan: when it has one, it becomes
a project. Its text becomes the project's name, its description the project's note, a checklist in that
description its steps. A task that was in the focus stays there as the project's first step; an undated
one leaves no twin row behind.
→ *model: «a task with a description becomes a project and stays in the focus as its first step», «a
task whose description was a checklist becomes a project with those steps», «an undated task that
becomes a project leaves no twin row behind»; e2e: ««Make it a project»»*

**Weekly review.** The scripts read the same notes: focus rows with ids, what was completed and when,
the areas. Nothing in the plugin may change the shape they read.
→ *scripts: `tests/test_obsidian_tasks.py` (27 tests), and the whole suite, 155*

## What must never happen

**A task disappears.** Every open task is either in its area, in the upcoming block, in «All», or — if
it has no area and no project — in «Without an area» at the bottom. There is no fifth place.
→ *model: «fuzz: whatever is in the vault, every open task is somewhere on screen» (40 random vaults),
«a task with neither an area nor a project is not lost silently»*

**The focus fills up with what is not due.** Nothing dated in the future may appear above the fold.
→ *model: «fuzz: the focus never shows a task that is not due yet» (30 random vaults)*

**A write loses what another writer put there.** The plugin's own fields are written into the
frontmatter; everything else in the note — TaskNotes' recurrence and time entries, the body, unknown
keys — survives. A decision to complete or reopen is taken from the note as it is on disk.
→ *model: «writing a field keeps everything else in the note, lists included», «the checkbox decides
from the note on disk, not from what the screen remembers», «a task renamed by another device is still
written to»*

**A repeating task is ended by one tick.** When a note has `recurrence`, only TaskNotes knows how to
close a single occurrence; without it the tick is refused rather than writing `status: done`.
→ *model: «a repeating task is not finished as a whole when nothing can complete the occurrence»*

**Something is deleted with no way back.** A task, a project or an area goes to the trash with one
«Undo» that restores every note it touched — and refuses to overwrite anything written there since.
→ *model: «a deleted task comes back with the same uid», «deleting an area takes its tasks, and undo
brings everything back», «undo does not wipe what was written in the meantime»*

**The order a user arranged is lost.** The dragged order lives in `data.json` by `uid`, so renames and
edits keep it; a note renamed from outside keeps its place and its fold state.
→ *model: «a dragged order is kept by uid and survives a rename», «renaming a project note from
outside keeps its place and its fold», «the saved order does not grow duplicates»*

**A phone cannot do what a mouse can.** Every target is at least 24 px, the grip is always visible, a
tap opens the menu, a finger drags without opening Obsidian's sidebar, and nothing runs off the side
of the screen.
→ *mobile: all 13 steps*

## Deliberately not there

- **Repeats, reminders, time tracking.** TaskNotes does them on the same notes; the schema is its own
  so that it can. The plugin stays the ZFG view on top.
- **An inbox.** A task belongs to an area; «Without an area» is a repair queue, not a place to keep
  work.
- **Bulk «move everything overdue to today».** The age of a task in the focus is the ZFG signal that
  it is stuck; a button that erases that signal every morning is the opposite of the system.
- **Sorting modes.** The order is manual, then the nearest date, then the name.
