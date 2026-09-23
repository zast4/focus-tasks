# Changelog

## 0.2.1

The plugin says, in the list and in its settings, that it is still being built: a stable version is
on the way, and Telegram ([@zastashkov](https://t.me/zastashkov)) is where to ask when it lands.
Nothing else changed — the work going on meanwhile is not published yet, on purpose.

## 0.2.0

**Breaking: a task is a note now.** In 0.1.0 a task was a checkbox line inside an area's note. Every
task is now a note of its own in the tasks folder, with a `uid` that never changes, and the fields in
its frontmatter. Checkbox lines are not read any more — your areas and projects stay where they are,
and the list tells you how many lines it found and where the migration is. Nothing is deleted.

To move your tasks, from the plugin folder:

```
node tools/migrate-to-notes.mjs --vault "<your vault>" --folder Tasks --out Задачи   # dry run
node tools/migrate-to-notes.mjs --vault "<your vault>" --folder Tasks --out Задачи --apply
```

`--wishes` also takes the «### TODO» blocks of ordinary notes; they become tasks with
`status: someday`. To stay on the old model, pin `0.1.0` in BRAT (*Choose version*).

### Why

A checkbox line has no identity: editing the note from a phone, or a script writing into it, could
lose an edit or double a task. A note has a `uid`, so it survives being renamed, moved, or written by
something else.

### New

- **TaskNotes in one click.** *Settings → Focus Tasks → TaskNotes* installs the companion plugin,
  turns it on and points it at these tasks (property `type` = `задача`, the tasks folder from these
  settings). That last step is what people miss by hand — without it TaskNotes finds nothing.
  Installed, it brings recurrence, reminders, time tracking, its calendar and its Bases views to the
  very same notes.
- **A description that grows into a plan becomes a project** — «Make it a project» in a task's menu:
  the body becomes the project's note and a checklist in it becomes the first steps.
- **Undo (⌘Z)** for the last thirty changes: a tick, a date, a rename, a drag, a new row, a deleted
  task, project or area. A note changed underneath is never clobbered.
- **Multiple selection**: Shift-click takes the range, ⌘/Ctrl-click one row; the grip of a selected
  row drags them all, and the date, the menu or ⌘1–4 date them together.
- **A project finished today keeps its place** until the day is out, marked «done N», and its «+»
  adds the next step.
- The date picker takes typed dates («tomorrow», «+3», «25.12.27»), and a link in a task's text
  becomes readable words in its file name.

### Fixed

- The list holds its place when a box is ticked, in the pane and in a note in Live Preview.
- A task whose project moved to another area is drawn where it is counted, instead of disappearing.
- The phone: the grip is always visible and big enough, a finger drag no longer opens the sidebar,
  and nothing runs off the side of the screen.
- Selection is grey now, and rows have room to breathe.

## 0.1.0

The first release: areas, projects and checkbox tasks in one focus list, dates in the
[Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) emoji format, inline editing, drag
and drop, «Show upcoming», linked notes.
