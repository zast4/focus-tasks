# Focus Tasks scenario contract

The checks run in a disposable vault or an in-memory vault. The owner's notes are read only.
This is a bounded test plan, not a claim that every possible interaction has been proved correct.

## ZFG and the three categories

- Focus contains currently actionable tasks. The global view groups them by area and project.
- Backlog contains ordinary tasks without a current day, including future tasks. Opening it does not close Focus or Ideas.
- Ideas are private entries in lists or loose entries belonging directly to an area. A list can belong to an area and optionally to a project. Its entries do not enter Focus, Waiting, Calendar or canonical task statistics until explicitly activated. Setting a private entry's date is not activation.
- A project has one header when its Focus, Backlog and Ideas are shown together. The compact checkbox and text represent its first step; the drag/selection handle represents the project itself.
- Waiting is a dated return. Pending entries have their own block and count. A returned entry participates in Focus. Removing its return date returns it to the ordinary open queue.
- Today's completed tasks stay discoverable in the completed block; historical completions remain in Logbook. Cancelled and someday entries are not actionable.
- Area and project notes reuse the same rows and actions. An area's embedded view is flat; the global view retains the area hierarchy.

Checks: `model.mjs`, `supplements.mjs`, `intent-lists.mjs`, `intents-ui.mjs`, `supplements-ui.mjs`, `e2e.mjs`.

Local Markdown views are located inside the active leaf and must have a real visible rectangle. Obsidian may keep a hidden editor copy of the same block; finding the first matching node does not prove that a control is reachable. Mobile header geometry includes the aggregate count button, so a count cannot cover the Plus button. A one-entry idea list never shows a zero extra-step counter. The warm Ideas marker does not change the checkbox column. Native touch checks also require the actual hit target. Area category controls replace the counter in place; expanded project controls sit beside their direct counter. Neither uses a floating panel, frame or background.

## Visibility configurations

Run each of these on a Focus area, a Backlog-only area, a project, an empty project, an area note and a project note:

| Configuration | Required result |
| --- | --- |
| Only Focus | Focus rows stay present; Backlog and Ideas stay closed. |
| Focus + Backlog | Focus stays unchanged; compact Backlog project previews appear below it, no repeated task or add button in filled categories. |
| Focus + Ideas | Private entries stay private; canonical Focus rows remain. |
| Focus + Backlog + Ideas | Independent overview buckets and private Ideas coexist; each task appears once. Explicit project categories share one local header. |
| Legacy hidden Focus preference | Focus remains visible; there is no project Focus toggle. |
| Backlog + Ideas closed | Focus remains visible; controls stay reachable without empty expanded bodies. |
| Collapsed area, saved categories enabled | Dim controls mean not currently displayed. Clicking reveals the requested category. |
| All on/off | The area view respects defaults and project overrides. All does not add a global Ideas button. |
| Click Focus title | Focus areas unfold, All/Backlog close, Waiting/completed groups fold, scroll resets. |
| Category with count zero | Direct +N remains available; expanded projects offer Backlog/Ideas even at zero, or Ideas only when Backlog is primary. Empty displayed categories expose creation. Backlog-only area headers omit Focus. |

Numbers count unique entries, not compact project headers. Pending Waiting is separate.
Desktop hidden controls have zero layout size; there are no invisible placeholders or action tracks.
Each area shows one aggregate count. Desktop hover/focus and phone tap replace it with inline controls. Focus is read-only. Project +N responds to a direct click, opens only that project's tasks and shows Backlog and Ideas, including zero counts. A Backlog-primary project shows only Ideas. Collapse restores compact previews. Empty categories create tasks today/undated or ideas in a bound private list. Enter in populated Backlog continues its undated list without an add helper. Hover leaves the project caption stationary. Legacy project dates cannot create a Focus header. The displayed project date follows the first active task, respects manual order, and changes with that task; direct project and mixed-selection date actions preserve the project note.

Checks: shared supplement UI matrix and row/mobile layout checks at multiple widths and 14/18/26 px text, with screenshots.

## Idea containers and activation

| Action | Required result |
| --- | --- |
| Open Ideas in any area | A default virtual "Ideas" row is present even when empty; this creates no file and cannot complete the area. |
| Add a loose idea | One private UID note in the area, with no list/project link and no Calendar event. |
| Add in project Ideas | One entry in that project's private list; canonical task counts do not change. |
| Complete an exhausted list | The user ticks the list checkbox; contents and UID remain in its private Done shelf. |
| Complete a list with active entries | Refused, including externally reopened entries not yet reflected by the cache. |
| Reopen a completed list | Same list and entries; one Undo restores the completed state. |
| Add/drop into a completed list | Reopen the list within the same Undo transaction as the addition/drop. |
| Project menu: Make an idea list | Existing project note becomes a list; its steps become private entries with the same UID/status/clock/body/custom YAML. |
| Drag project into Ideas | Uses the same conversion as the menu; no project nested inside a list. |
| Project with an existing idea collection | Retain that collection and its entries as a separate area list, remove the former project binding. |
| Loose idea enters/leaves a list | Same identity and description; membership changes, canonical queues do not. |
| Explicitly activate an idea | Same UID becomes a canonical task. A bound list restores the canonical project; loose ideas stay directly in the area. |
| Duplicate a completed entry | Reopen its real container in the same Undo; copies get fresh UID and no duplicate migration item key. |
| Undo conversion | Restore all affected notes and ordering in one action; never overwrite external edits. |
| Search a closed list or loose idea | Reveal the correct private view, without reopening/activating the entity. |

Checks: `idea-entities.mjs`, `list-completion.mjs`, `mixed-histories.mjs`, and native desktop/touch UI checks.

## Selection and editing configurations

| State | Date / clock | Duplicate | Keyboard ownership |
| --- | --- | --- | --- |
| No selected row, no editor | App shortcuts remain available. | App owns the key. | Cmd+1-9 switches tabs; Esc is not swallowed. |
| One loose task selected | Changes only that task. | Copy above source, fresh UID, immediately editing. | Date shortcuts belong to Focus while its leaf is active. |
| Several tasks selected | One group action and one Undo; an untouched mixed clock is preserved per task. | One copy per distinct task; no repeated source UID. | Shift range, Cmd toggle, arrows and Esc maintain selection. |
| A compact project selected | No independent project date; shortcuts preserve its note and stay in the Focus pane. | Project is not copied as a task. | Enter edits the shown step; project identity remains distinct. |
| Project and task selected | Only the task gets the day/hour; project and other steps remain unchanged. | Only selected tasks are copied. | No action leaks to unrelated notes. |
| Task and private idea selected | Same row actions; domain and owning list stay intact. | Copies remain in their original domain. | Ideas do not become canonical implicitly. |
| Inline editor | Text and date save without overwriting other fields. | Save current text, copy above, transfer editor. | Enter saves/adds; Esc cancels or saves as specified; Cmd+Enter opens note. |
| Date/Waiting card open | Invalid input and failed writes retain input and keep the card usable. | Card owns its input. | Calendar keys do not affect background rows. |
| Search/menu/modal/note leaf active | The active surface owns keyboard input. | No background mutation. | Switching away disables Focus's list shortcuts. |

Checks: `selection-matrix.mjs` (six entity configurations x three date actions), `state-transitions.mjs`, desktop/mobile E2E keyboard and card scenarios.

A second project step opens the project before any input is saved. The draft and original step share the same list and text column. Check Plus and Enter in the global view, area note, project note and Backlog, including touch. No note exists until save; cancelling the next empty draft adds nothing.

Checks: `project-draft-ui.mjs`.

## Note identity, sync and failure scenarios

1. Another writer changes the day/hour or Waiting status, then an old row is dragged. Read current fields atomically; preserve an existing hour. A deliberate Focus drop changes the day while retaining that hour.
2. Another writer changes membership before or during rename. Rename the task/project without restoring former membership. Refresh the edited row from current file contents.
3. A deleted, retyped, completed or replaced project/list/task is still shown as a drop target. Refuse it without changing source bytes or creating order keys. A moved live project uses its current area.
4. Deleting a task or container after a concurrent identity/body change refuses the destructive write. Earlier successful writes in a partial group remain Undoable.
5. An imported task has no UID. Its first successful mutation assigns one; reordering follows that identity. A different UID at the same path is never treated as the original task.
6. An idea is explicitly activated, including a done/cancelled/Waiting idea. It becomes open, keeps its UID/body/custom fields, records its source list, and can be restored with one Undo.
7. Writing, renaming, duplicating or deleting fails midway. Show failure; preserve drafts; record only owned writes; never undo unrelated external changes.
8. Undo encounters a foreign edit, an occupied path or a changed order. Refuse conflicts instead of overwriting external data. Multiple delete notices each retain their own snapshot.
9. Duplicate titles and project names, links by path/alias, missing files, junk YAML, invalid dates, recurrence delegated to optional TaskNotes, and files outside configured folders retain their defined handling.

Checks: data model, failure/concurrency regression suites, state transitions, migration/archive tests, seeded histories.
Filesystem deletion/rename is not a distributed transaction: a truly simultaneous outside write between the last read and native file operation remains a platform boundary.

## Calendar contract

- A canonical task with an explicit valid hour owns one one-hour event. Date-only tasks and private ideas own no reminder.
- The only alarm is at the event's start. The plugin URL lives in the event URL field and identifies the task by permanent UID.
- Rename, day/hour changes and grouped edits update the same event. Clearing the hour, completion, deletion or conversion to an idea removes it.
- A known UID retyped into a non-task is an explicit withdrawal, not an temporarily missing note. A genuinely missing file gets the sync grace period.
- The Calendar badge reflects a matching successful receipt, not just a local request. Old receipts cannot claim success for a changed hour.
- Duplicate UID, malformed snapshots, symlinks, failed/ambiguous cloud responses, no-op reconciles and retry/restart are checked against a fake CalDAV server. No test creates owner events.
- UID deep links reveal the correct task in the plugin after rename/move/folding, including duplicate titles. A missing/ambiguous identity is reported safely.

Checks: `bridge/test_calendar.py` and native badge/UID-link E2E. Delivery to Apple Watch requires the real device and iCloud; it cannot be certified by desktop emulation.

## Stress and release gate

- Run the model and every data regression suite on the final source.
- Run 100,000 seeded canonical gestures, plus 3,000 mixed-domain actions, checking raw files and independently specified invariants after each action.
- Include 10,000-task scale tests, calendar transport failures, and guarded vault auditing.
- Run full native desktop E2E, Blue Topaz + Tasks E2E, optional installed TaskNotes compatibility, and touch/mobile E2E sequentially.
- Take a fresh hash snapshot of owner notes/settings before delivery. Ship assets only, reload, compare runtime assets and all protected bytes, restart the existing calendar bridge, check status, then advance shipped.

Converted project descriptions retain their original text, including plugin fences. A Focus block inside a Focus description must never recursively mount another renderer or steal keyboard scopes. Native conversion followed by Cmd+Z checks this boundary.

A refresh between pointerdown and click must retain the pressed target and deliver one action. Test this with a forced refresh on desktop and touch. Refresh still cancels a pending mobile long press before queuing the redraw.

During partial Sync a private entry whose list is temporarily missing remains in its area default Ideas group. Its UID, raw list binding and bytes remain untouched; restoration of the list restores its place. Converted project note blocks remain scoped to their own idea list.

- Category regressions: stable project captions at normal, 340px and 220px widths; a read-only area Focus indicator and stationary pressed targets through rapid Backlog toggles and at the tail after a pause; one category tooltip and contiguous targets; Backlog-only project headers survive local closure; idea lamps survive Select All, replacement and saving with the same UID; loose ideas use the default Ideas row. Run on desktop and touch.

- The area default Ideas group follows the other lists while empty, including after its last idea is completed. Adding or reopening an idea restores its populated position. Check the ordering with real creation and completion controls on desktop and touch.

- Project categories override their area defaults: click through local Backlog/Ideas combinations with Focus fixed, including all legacy area preference combinations. Closing the last local Backlog or Ideas category retains the project header and its controls for reopening, without stray carets or task checkboxes. The area's Focus and Backlog preferences do not change. An area category choice clears this local header preference in its own area; renames preserve it and deleting a project clears it. Run on desktop and touch.
