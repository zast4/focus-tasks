# Reliability audit, 2026-10-02 to 2026-10-03

This audit targets every shipped plugin feature, the task-note contract, external
writers, the ZFG workflow, phone capture and Apple Calendar notifications. Changes
were developed on `next` against stable baseline `6691679`. The user authorized
stable delivery and Calendar activation on 2026-10-03.

## Evidence and acceptance

- Baseline: 146 model checks, 73 desktop scenarios and 15 mobile scenarios passed.
  The scripts had a date-dependent test failure and a genuine Waiting status mismatch.
- New deterministic regressions reproduce data-loss and inconsistent-state cases;
  no passing result is inferred from reading code alone.
- Stress: 300 seeded histories, 200 gestures each, 60,000 total. Identity, descriptions,
  foreign properties and visibility of every active task survive the histories.
- A 10,000-task model collected in 548 ms; 20 cached reads took 0.1 ms in that run.
  This measures the data layer, not DOM rendering or iPhone speed.
- Real desktop runs use a disposable Obsidian vault. `--with-tasks` and
  `--with-tasknotes` now install and enable the actual requested companion, rather than
  silently ignoring the flags. Mobile tests use Obsidian's mobile mode and touch input.
- iCloud was tested with a temporary calendar: create, alarm read-back, reschedule,
  Waiting, stable UID, absence of duplicates, delete, and cleanup passed.
- Final: 146 model checks; 42 deterministic regression/inventory/repair/delivery tests;
  37 Calendar tests; 85 desktop scenarios in each of standalone, actual Tasks and
  actual TaskNotes configurations; 18 mobile scenarios. Every final run passed.
  The host's shared task scripts passed 173 checks. The private review log records
  the working-vault inventory and host installation state.

Acceptance means these defined scenarios pass and known failures have fixes. It does
not mean that an unobserved future bug is impossible. Native Mac hotkey dispatch,
actual iPhone keyboard/gestures, two-client Sync races and Watch notification delivery
still need the short physical-device acceptance described below.

## Failures fixed

1. Undo included notes created by an unrelated writer during a gesture and could
   delete them. It now records only owned successful creations/renames, including
   their exact input bytes rather than a later read containing another writer's edits.
2. A slow write could join unrelated gestures after a 1.5-second timeout. An explicit
   transaction token and serialized queue replace the timeout.
3. Partial failures could lose their Undo record. Already completed writes remain undoable.
4. Undo could resurrect externally deleted tasks, overwrite another writer's order,
   or mistake a failed creation for its own file. Conflict checks refuse these cases,
   including a task only planned for a group gesture but never actually touched.
5. A post-gesture read could include a phone edit in the Undo target. Atomic vault
   callbacks record exact owned bytes; interleaved writers cause a refusal to restore.
6. Renaming/undoing could break incoming links. Reverse renames use Obsidian's file
   manager; conflicting source/destination paths are handled as one identity. An edit
   between saving the title and renaming the file is preserved too.
7. A failed rename lost the typed title or closed its editor. Text is persisted before
   renaming; the editor remains available for retry after a failure.
8. Duplicate/deletion could act on a different UID that had replaced a selected path.
   Disk identity is checked, including deletion of project children. Loss of a known
   UID no longer silently allocates another identity under a stale row.
9. Clicking an old unchecked box could reopen work already completed elsewhere.
   Checking expresses intent to complete; a stale click never reverses unseen completion.
10. A project move did not include child area changes in Undo. Child files now travel
    with the same transaction. Project renaming and linking are undoable too.
11. The test YAML subset hid real parser failures. Harnesses now use real YAML. Exact
    frontmatter fences, CRLF/BOM, nested properties and description bytes are covered.
12. Quotes in an area name changed its identity. YAML quoting preserves the exact value.
13. A timed row retained a stale hour after clearing it. Live and persisted values now
    match; changing a day preserves the existing hour, removing it is explicit.
14. Invalid date text could silently fall back to the previous date. Invalid input
    stays invalid; failed card saves retain the entered value for retry.
15. Duplicate could have a live `open` state but retain persisted Waiting/cancelled.
    New copies are open work, with fresh identity and no copied execution history.
16. The bot interpreted `in-progress` as Waiting and used deadlines as start dates.
    Bot and plugin now use `waiting`, `scheduled` and the same return hour.
17. Existing calendar scripts lacked a reproducible CalDAV environment. A pinned,
    isolated environment and disabled host job are prepared.
18. Midnight refresh depended on the presence of Waiting tasks. The Focus day now
    updates independently, and a Waiting hour returns without a file edit/manual refresh.
19. Scrolling an unrelated note could commit an open date card. Only the anchor's
    containing scroller closes/commits that card now.
20. Connection discovery failures left the old Calendar status looking healthy.
    The error is persisted immediately, preserving previous task acknowledgements.
21. A launchctl override could keep a job running despite a disabled plist.
    Preparing the job now explicitly stops/disables its own label.
22. Unsafe post-hoc snapshots of delegated companion changes are no longer claimed
    as owned Undo writes. A recurrence Undo barrier prevents undoing an unrelated prior gesture.
23. A reminder/Waiting card could accept an explicit hour already passed today.
    Those cards now refuse past moments; ordinary date editing still permits backdating.
24. Rescheduling a confirmed future Calendar reminder into the past left its old alarm.
    The old owned event is removed and the new moment is marked missed; failure retries.
25. Filesystem Unicode NFD names differed from Obsidian's NFC index. Calendar links
    now use the indexed Unicode form, verified with a real iCloud round trip.
26. The independent inventory relied on Date.parse, which silently rolls impossible
    days forward. It now checks actual days and hours in all three date properties.
27. The first real launchd run exposed a lost venv: resolving its Python symlink
    selected the base interpreter without the bridge dependencies. The installer
    preserves the executable path. A real isolated-venv launch test failed before
    the fix and passed after it; the actual host job then synced a working reminder.

## Usage and implications

Private inventory and usage counts belong to the host review log, not this public
repository. `tools/audit-vault.mjs` independently checks task files, identities,
dates and optional-plugin metadata without printing titles. The archive repair tool
quotes only an invalid title line, backs up first, and refuses open/unarchived tasks.

The supported workflows include Mac work, phone capture and adding inside notes:

- Phone project context goes above the action, so names no longer compete for width.
- Area notes gain a local view of all their projects/tasks; local additions are undated.
- Offline capture must write a note before depending on network delivery.
- TaskNotes is optional interoperability, not a runtime dependency of Focus Tasks.
  Without recurrence or its additional views/tracking, it can be disabled. The standalone
  configuration and the optional installed configuration are tested separately.
  Completion of a recurring instance is delegated to the actual installed TaskNotes API;
  undo that occurrence in TaskNotes. Focus Undo does not reverse companion-owned changes.
- A large undated backlog must stay retrievable through All, area/project pages and Find.

## ZFG contract

Focus is work currently relevant: open tasks with `scheduled <= today`, plus Waiting
whose return moment arrived. A scheduled date is the day to start/look again. A deadline
is a separate `due` field. Neither a reminder nor the clock automatically completes work.
Four or five areas is the working ZFG norm; it is not a hard limit or a reason to hide work.

Undated open work is backlog. Future dated work has a planned return and remains under
the upcoming pile. Waiting remains retrievable before its return. "Focus" resets All
and closes upcoming/rest areas; Find can reveal a hidden task and its container. Projects
are explicitly closed by the user, not automatically by completion of their last step.

Date changes from an editor that remove the row from its current list save the text and
move it immediately. Editing itself protects the caret against unrelated rerenders.
Errors keep the current editor/card usable rather than claiming a successful transition.

## Comparison decisions

| Product / primary source | Useful rule | Result in this system |
| --- | --- | --- |
| [Things 3: scheduling](https://culturedcode.com/things/support/articles/2803579/) | Start date, deadline and reminder time have distinct meanings | `scheduled` drives focus, `due` remains separate, explicit hour drives notification |
| [TickTick](https://ticktick.com/features) | Low-friction capture, reminders and clear lists | Keep row input and keyboard control; check movement and persistence as user-visible actions |
| [Todoist: reminders](https://www.todoist.com/help/todoist/features/introduction-to-reminders-9PezfU) | A notification is a concrete time, with delivery behavior of its own | A date alone does not silently manufacture a midnight notification |
| [Apple Calendar: Reminders](https://support.apple.com/guide/calendar/use-reminders-icl873b9a527/mac) | Scheduled native Reminders can appear in Calendar | Distinguish a Calendar event with an alarm from a native Reminders checkbox |
| [Notion: reminders](https://www.notion.com/help/reminders) | Date/time editing should expose when a reminder is set | Timed task card and explicit removal of its hour |
| [TaskNotes: specification](https://tasknotes.dev/developers/specification/) | File state and explicit date semantics support interoperability | Preserve canonical task fields and unknown properties; keep TaskNotes optional |
| [Task Genius](https://taskgenius.md/) | Broad task views and configuration exist | The value here is the chosen ZFG workflow and usable capture; feature count is not the acceptance criterion |

These are design comparisons from primary documentation, not equivalent hands-on
benchmarking of every competitor. No new Inbox, recurrence engine, tags, time tracker
or automatic task completion is introduced into the user's workflow.

## Physical-device acceptance

1. Mac: edit/select with Cmd+1..5 and Cmd+D; without either context Cmd+1..9 switch tabs.
2. iPhone: create an undated task inside an area and project while offline, close/reopen
   Obsidian, then restore connectivity and bring Obsidian foreground. See the same UID
   and text on Mac, with no duplicated capture.
3. With the calendar bridge enabled, create an explicit reminder ahead, see its cloud
   acknowledgement, close Obsidian and verify the Watch alert. Move its time, take Waiting
   back early and complete the task: the owned Calendar event changes/disappears.

Obsidian Sync has no multi-file transaction. The plugin protects detected conflicts and
keeps partial operations undoable, but cannot turn a disconnected second device into a
synchronized database. Offline reminders cannot reach iCloud before the note reaches the host.
