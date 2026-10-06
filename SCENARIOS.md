# Scenarios and ZFG invariants

[Русские сценарии и рабочий цикл ZFG](SCENARIOS.ru.md).

Focus is currently relevant work. `scheduled` is the day to start or look again;
`due` is a deadline and does not substitute for that day. Ordinary dated work is
relevant for its whole day. Waiting with an hour returns at that precise moment.
Four or five areas is a ZFG working norm, never a cap that hides additional work.

## Scenario matrix

Ideas open locally through a shared backlog/📔 switch on areas and projects. Containers share project-row geometry with 📔;
entries share task-row editing, checkboxes, dates, duplicate-above, drag order and Undo. Dates never
promote entries. Explicit promotion preserves identity and description and one Undo returns them.
Body search reveals hidden lists. Confirmed list deletion and Undo include all owned entries.
Conversion verifies backups, preserves nested descriptions and history, and refuses changed sources.
Desktop and 320/390/430px touch views with 26px text run the same native UI and operator scenarios.

M = `test/model.mjs`; A = `test/audit.mjs`; E = `test/e2e.mjs`;
P = `test/mobile.mjs`; S = `test/stress.mjs`; C = `bridge/test_calendar.py`.

| Situation | Expected visible/persisted result | Coverage |
| --- | --- | --- |
| Open Focus in the morning | Only relevant areas/steps; undated and future work remains retrievable | M, E |
| Capture inside a focus area/project | Local note with a fresh uid and today's day | M, E, P |
| Capture in an upcoming pile | An undated note in that same area/project | M, E, P |
| Add inside a project note | Steps view, undated local addition, closed history folded | M, E |
| Open an area's own note | All its projects and tasks, undated local addition, local closed history | A, E |
| Link a custom note to an area/project | Name opens that note; menu can open the task container | M, E |
| Make an existing note an area | Preserve prose/properties; add the local view once; Undo restores the original | A, E |
| Enter while editing | Save text and open the next row at the same level/date | M, E, P |
| Escape while editing | Save nonempty edits; restore wiped text; leave the row selected | E, P |
| A date shortcut removes an edited row from its list | Save text and move the row immediately, preserving the next editing position | E |
| Date/selection shortcuts without an editor or selection | Pass to Obsidian, including Cmd+1..9 tab switching | E; native Mac acceptance |
| Cmd+D while editing/selecting | New open note per task with fresh identity; copies inserted above sources; first copy immediately editing; one Undo | A, E |
| Duplicate previously waiting/done/cancelled work | Copy is open, original is unchanged; recorded execution history is not copied; a hidden future copy is revealed for editing | A, E |
| Change day on a timed task | Preserve its existing hour from disk | A, E |
| Remove its hour or day | Explicit hour removal retains day; clearing day clears both | A, E |
| Invalid day/hour in a card | No silent fallback; invalid input remains available to correct | E |
| Scroll another pane | Do not commit a date card attached to this pane | E |
| Save/rename fails | Keep text/card usable; persist no false successful transition | A, E |
| Mark done, then reopen | Persist status and completion day; display day's history; reopen only explicitly | M, E, P |
| Another device has already completed an unchecked row | Stale check must not reopen it or replace its completion date | A, M |
| Last project step is completed | Project has a place to add the next step; explicit user action closes the project | M, E |
| Project's own scheduled date changes | Date belongs to project; step dates are preserved | M, E |
| Project and first step have different dates | Row brightness follows the project date used for focus and its label; without it, the first step's date applies. Rendering preserves step dates | E, P |
| Waiting before/at/after return | Separate shelf before; relevant in Focus at/after; never auto-completed | M, E, C |
| Take Waiting back early | Current open work; obsolete future Calendar reminder removed | M, E, C |
| Find folded/undated/future/waiting work | Reveal the containing area/project/pile and select the result | M, E |
| Select range/group, change date, drag, delete | Operate on intended task identities; project row selection means project | M, E |
| Drag within an area/project | Persist ordering of the intended visible list | M, E, P |
| Drag across containers | Update area/project and appropriate scheduled day; keep Waiting return | M, E |
| Move a whole project to another area | All child area references and container links move; one Undo restores them | A, M, E |
| Rename task/project | Preserve uid, file identity, full title and incoming links; Undo reverses the rename | A, M, E |
| Make a task into a project | Preserve description; checklist becomes steps; date goes to the first relevant step | M, E |
| Delete task/project/area | Scope matches command; children with replacement/moved identities survive; Undo is available | A, M, E |
| Undo after an external edit/delete/create/order change | Preserve the external work; report skipped/conflicted restoration | A, M |
| Slow/partial/concurrent writes | Separate gestures are serialized; partial owned writes stay undoable | A, M, S |
| Malformed YAML, CRLF, BOM, nested/custom properties | Read safely or refuse; preserve description bytes and unknown field values | A, M |
| UID removed/replaced externally | Refuse a stale destructive/update action rather than change identity | A, M |
| Optional TaskNotes recurring checkbox | Complete one instance through its real API; preserve series/uid/area; Undo must not touch companion edits or earlier unrelated work | A, M, E with TaskNotes |
| Desktop row date, clock, Waiting, deadline, calendar badge, marker and grip | One first-line centre, uniform SVG size and separate action cells; 620/1000 px, text 14/18/26 px; pane, area/project notes and user theme with Tasks | E; geometry rejects shipped baseline |
| One area/project/file name collides with another | No overwrite, lost identity or accidental project resolution | M, A |
| Midnight, dated completion, exact Waiting hour, explicit timezone offset | Current relevance and displayed local day/hour agree | M, A, E; actual sleep/wake acceptance |
| All, upcoming toggles, collapse/expand, Focus reset | All remains complete; Focus hides upcoming/rest work; folding is per device | M, E, P |
| Embedded view, Live Preview, links, pane close/reload | Same task state; ordinary navigation; no orphan editor, picker or shortcut scope | E |
| Russian/English settings, folder, companion/build switching | Valid settings; real companion configuration; clear running build identity | M, E |
| Phone at 320/390/430 px, 18/22/26 px text | Shared checkbox/title columns, no visible or reserved grip column; project context above action; wrapping metadata; no nested step indent, overflow or overlapping targets; embedded Focus, pane, area and project notes, including temporary reorder mode | P |
| Long-press task text, then choose Reorder | One menu, no edit or completion; temporary grips and reachable Done; a quick swipe scrolls, a second finger cancels a pending hold | P |
| Drag in mobile reorder mode, cancel, refresh, edit or leave the note | Cancel keeps notes and ordering; refresh ends pending holds but retains the active mode; Done, editing, navigation or backgrounding restores the normal layout; no stale drag or listeners | P |
| Phone with user theme and long inline text | Same columns during editing and expansion; date/status controls respond to touch; finishing edits preserves task properties | P |
| Phone offline capture and reload | Note exists locally immediately and survives reload | P; actual iPhone/Sync acceptance |
| Tick a task halfway down the list | Desktop preserves the top visible row; phone preserves the next action, including a step becoming the project's collapsed action; drift at most 3 px | E, P |
| Open an undated backlog task's calendar | Today is suggested but Escape makes no write; typing replaces the selected suggestion | E |
| Timed task before and after cloud acknowledgement | Pending until current UID/path/title/clock/Waiting status is confirmed; no green badge after edits or failure | M, E, C |
| Timed project step with a project date on narrow phones | Step clock and confirmation badge remain visible, aligned and inside 320/390/430px at 18/26px text | E, P |
| Group time edit, clear time, complete | Existing event IDs update; old receipts turn pending; clearing time removes badges and owned events | M, E, C |
| Timed backlog task becomes relevant | Scheduled day enters Focus; its automatic one-hour event alerts at the chosen hour | A, E, C |
| Open the date/clock or Waiting card on a phone | Shared date/clock/Save layout; 320/390/430px fit, 44px Save, calendar taps keep the keyboard closed | P |
| Save an ordinary task with empty time | Day-only value, no implicit midnight event; an explicit 00:00 remains a real clock | E, P, C |
| Change the day of open or Waiting tasks with different hours | Each hour survives; setting/clearing a group clock is one undoable transaction | E |
| Timed Waiting becomes relevant | Same event identity, exact return moment, no completion automation | M, E, C |
| Calendar rename/reschedule/complete/cancel/clear | Update/delete only the owned event without duplicates | C, disposable iCloud probe |
| Existing reminder after format update | Same event uid, one-hour display with empty description, disabled default plus sole at-start alert, Focus link, no busy time | C, live iCloud readback |
| Follow a Calendar UID link after rename or project move | Focus selects the exact task; folded area, future pile and project steps open, including a single step and a project dated later than its step; no new note tab | M, E, P; native owner-vault probe |
| Follow a UID link to Waiting on a phone | Waiting opens and the exact task is selected without a note tab | P |
| Follow a link immediately after saving Waiting while metadata is delayed | Wait for the index to match the saved note before choosing the shelf; no stale-status navigation | M, P |
| Missing, duplicate, closed UID; unfinished edit or drag; consecutive links and cold start | Notice instead of arbitrary selection; editing preserved; wait for layout; process links in order | M, E |
| Existing event has the old plain Focus URL | Update its URL once in place; event identity and reminder policy survive, without duplicates | C |
| Calendar offline, missing file, malformed note, duplicate uid | Retry/protect; Sync grace; a past timestamp still has an event, without claiming retrospective notification delivery | C |
| Remote Calendar replacement/write/delete race | ETag condition refuses overwriting/deleting a foreign event | C |
| Large vault/random histories | Every active note is discoverable; uid, body and custom properties survive | S |
| Bot reads the same notes | Waiting status/hour and start-day semantics agree with the plugin | host scripts tests |

## The weekly ZFG loop

Capture into an area or project. Put relevant work in Focus by scheduled day. Review
undated backlog regularly; pull current work into focus or give it a future date.
Waiting names a day/moment for another look. Date age remains the stuck-work signal.
Complete a task yourself; decide yourself whether an empty project is finished.

Calendar records notification time; Timery records time actually spent. Those are
separate from task completion. An alarm is not proof that work was done.

## Boundaries

Run desktop, desktop with Tasks, desktop with TaskNotes, and mobile sequentially:
mobile emulation is app-wide. Model/audit/calendar tests can run independently.
See `AUDIT.md` for reproduced failures and limits, `CALENDAR_INTEGRATION.md` for the
cloud state machine and physical-device acceptance. No recurrence engine, new Inbox,
tags, automatic completion or second time tracker is added by this audit.

## Local backlog and ideas / Отложка и замыслы на месте

- Area and project headers share one clock/📔 group; the active segment closes on repeat.
- Project ideas appear directly as rows. Areas also show their linked project collections.
- Area notes expose 📔; project notes share local supplement state. All has no new entry.
- Empty scopes create nothing until addition. Binding is UID-based; foreign replacements never inherit it.
- Rename, move, promotion, deletion and Undo preserve membership and descriptions.
- Geometry checks cover 320/390/430px, 18/26px text, 44px phone targets, scoped notes and both themes.
- Checks: `test/supplements.mjs`, `test/supplements-ui.mjs`, complete desktop and phone suites.
