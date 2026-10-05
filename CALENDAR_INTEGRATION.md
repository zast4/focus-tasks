# Apple Calendar notifications

The task note owns the date and time. The Mac-host bridge mirrors it into one hour-long,
transparent Calendar event with one active notification at its start. An Apple NONE
default placeholder suppresses the native default for this event; a UID-bearing DISPLAY
alarm triggers at DTSTART. Other calendars retain their default preferences.
The task link lives only in the event URL field; the event description is empty.
This is a Calendar event;
it is not a native Apple Reminders item with its own checkbox.

## The two cases

1. An undated backlog task gets a scheduled day and a reminder hour. On its day the task
   joins the focus; Calendar alerts at the chosen hour.
2. A waiting task gets the day and optional hour to look again. Before that moment it
   stays in Waiting; at that moment it becomes relevant in Focus. An explicit hour also
   automatically creates the Calendar event with its at-start notification. Coming back early removes the future notification.

Waiting rejects a return time that has already passed today; a date without an hour can
return immediately. An ordinary task with a time always has an event, including a past
timestamp received through Sync. A past event cannot deliver a notification retrospectively.

The task date and Waiting share the
date/hour/minute card with an explicit Save button (or Enter). Picking a day leaves the
card open for an optional hour. An undated task starts with today suggested, without
writing until the card is applied. Existing timed tasks open with their hour filled. Changing a day preserves the hour. Emptying the
clock removes the notification while retaining the day; clearing the date removes both.

Dates without a time do not produce events or guessed midnight notifications. Obsidian
links open `obsidian://focus-tasks?vault=...&uid=...`. The plugin activates its Focus view,
unfolds the task's area, future pile or Waiting section and project steps, then scrolls to and
selects the task without opening a task note. A permanent UID keeps the link valid after a
rename or move; existing events receive the new link in place. Missing, duplicate or inactive
UIDs produce a notice instead of choosing another task. An unfinished edit or drag is preserved;
finish it and retry the link. Event titles still match task titles exactly. Query values
percent-encode spaces as `%20` and plus signs as `%2B`. A link without `uid` opens plain Focus. The two
return semantics are deliberate: ordinary tasks are relevant for the whole scheduled
day; Waiting is reviewed at its exact scheduled moment. Completion remains the user's
action, and Calendar never completes or reopens a task.

## Persistence and reconciliation

- Only canonical `uid`, `type`, `status`, `scheduled`, `title` and the file path are read.
  No Calendar token, password, URL or app-specific password goes into a task or plugin settings.
- The event UID is a stable hash of the task UID. Rename, move, reschedule and Waiting
  reuse the same event. Duplicate creates a new task/event identity.
- The bridge writes the disabled-default placeholder and exactly one active at-start alarm.
  Both alarms have stable UIDs; only DISPLAY is a notification.
- Updating/deleting verifies ownership and uses ETag conditions. A foreign event is
  never overwritten, including a replacement between GET and PUT/DELETE.
- After saving, GET verifies the event time, duration, identity, fingerprint, Focus URL, empty event description, exact task title, disabled native default and sole active at-start alarm.
  State is acknowledged only after this succeeds. This proves server persistence,
  not delivery on a particular Watch or phone.
- Completion, cancellation, clearing the time/date or archiving removes only the owned
  event. Disappearing files receive a 120-second grace for Sync renames. Malformed notes,
  duplicate UIDs and incomplete scans prevent speculative removal.
- Network errors remain pending for retry. Existing ownership records survive failure, while
  a failed confirmation is visible as an error. Remote events are rechecked every ten minutes.
- The private ownership ledger is `Internals/FocusTasks/calendar-status.json`; derived receipts
  are in `Internals/FocusTasks/calendar-status.md` so they reach iPhone through normal Markdown
  sync even when arbitrary JSON files are excluded. Credentials and CalDAV URLs never enter
  receipts. Heartbeat-only changes do not rewrite the Markdown file.
- The calendar check badge requires the current contract, task UID, path, title, scheduled
  date/time, Waiting status and successful GET acknowledgement. Changing a clock invalidates
  the old badge until the event update is confirmed. Date-only/closed tasks have no badge.
  A local file lock permits one writer; state is bound to the chosen vault/calendar. Default `Архив` subfolder is excluded explicitly.
- Naive times use the configured timezone, Europe/Moscow by default. Explicit offsets
  are converted to UTC. A nonexistent or ambiguous DST hour needs an explicit offset.

## Prepare on a Mac host

Install the pinned Python dependencies into an environment outside the vault:

```sh
python3 -m venv ~/.venvs/focus-tasks-calendar
~/.venvs/focus-tasks-calendar/bin/pip install -r bridge/requirements.txt
```

Store `CALDAV_USERNAME` and the Apple app-specific `CALDAV_PASSWORD` in an external
env file readable only by its owner. On this user's AI Hub these accesses already
exist, and `scripts/setup-calendar.sh` prepares `.venv-calendar` reproducibly.

```sh
# No network writes or task edits. Reports counts only.
python bridge/apple_calendar.py --vault /path/to/Vault

# Prepare a disabled job. It does not start now or at the next login.
python bridge/install_macos.py --vault /path/to/Vault --python /path/to/venv/bin/python \
  --env-file /path/outside/vault/calendar.env --calendar 'Focus Tasks' --execute

# Activate after acceptance. Creates the named calendar only if verified absent.
python bridge/install_macos.py --vault /path/to/Vault --python /path/to/venv/bin/python \
  --env-file /path/outside/vault/calendar.env --calendar 'Focus Tasks' \
  --create-calendar --execute --enable
```

The prepared host job polls every 60 seconds. The calendar is separate from Timelog
and from other people's calendars. Phone/Mac alert preferences remain the user's;
this user receives Calendar alerts on Apple Watch.

The Python executable path is kept inside its venv, including symlinks. Resolving
that symlink to the base interpreter would drop the installed dependencies.

Creation, rescheduling and removal are eventual: the next successful poll acknowledges
them. An action immediately before an alarm can arrive too late to prevent that alarm.
The displayed cloud status reports persistence, not proof of notification delivery.

## Offline and acceptance

A task saved on an offline iPhone is a local note immediately. The host cannot create
its Calendar event until Obsidian Sync delivers the note, which requires Obsidian to
run in the foreground on iOS. Once the event exists in iCloud, its notification works
without Obsidian being open. Offline capture is not a promise of offline alarm delivery.

The automatic suite tests both cases, retries, misses, cancellation, rename gaps,
duplicate identities, ownership races, DST and exact ICS fields. `bridge/live_probe.py`
tests create/update/GET/delete against iCloud in a newly created disposable calendar
and removes that calendar in `finally`. It needs an explicit `--execute`.

Final device acceptance: prepare a reminder a few minutes ahead, see its acknowledgement
and event, close Obsidian, verify the Watch notification, then reschedule and complete
the task and verify that the original event changes/disappears. Native Reminders would
require a separate EventKit implementation and device permissions.
