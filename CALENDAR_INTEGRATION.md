# Apple Calendar notifications

The task note owns the date and time. The Mac-host bridge mirrors it into one short,
transparent Calendar event with a notification at its start. This is a Calendar event;
it is not a native Apple Reminders item with its own checkbox.

## The two cases

1. An undated backlog task gets a scheduled day and a reminder hour. On its day the task
   joins the focus; at the chosen hour Calendar notifies the user.
2. A waiting task gets the day and optional hour to look again. Before that moment it
   stays in Waiting; at that moment it becomes relevant in Focus. An explicit hour also
   creates the Calendar notification. Coming back early removes the future notification.

The reminder and Waiting cards reject an explicit time that has already passed today.
Waiting with today's day and no hour can return immediately. Ordinary date edits can
still backdate work; first delivery of a past timed note is recorded as missed.

The menu offers "Remind in Apple Calendar". The ordinary date card still saves a picked
day immediately. Its extra reminder action opens the hour/minute card. Existing timed
tasks open with their hour filled. Changing a day preserves the hour. Emptying the
clock removes the notification while retaining the day; clearing the date removes both.

Dates without a time do not produce events or guessed midnight notifications. The two
return semantics are deliberate: ordinary tasks are relevant for the whole scheduled
day; Waiting is reviewed at its exact scheduled moment. Completion remains the user's
action, and Calendar never completes or reopens a task.

## Persistence and reconciliation

- Only canonical `uid`, `type`, `status`, `scheduled`, `title` and the file path are read.
  No Calendar token, password, URL or app-specific password goes into a task or plugin settings.
- The event UID is a stable hash of the task UID. Rename, move, reschedule and Waiting
  reuse the same event. Duplicate creates a new task/event identity.
- A DISPLAY alarm has its own UID (required for the tested iCloud round trip).
- Updating/deleting verifies ownership and uses ETag conditions. A foreign event is
  never overwritten, including a replacement between GET and PUT/DELETE.
- After saving, GET verifies the event time, identity, fingerprint and actual alarm.
  State is acknowledged only after this succeeds. This proves server persistence,
  not delivery on a particular Watch or phone.
- Completion, cancellation, clearing the time/date or archiving removes only the owned
  event. Disappearing files receive a 120-second grace for Sync renames. Malformed notes,
  duplicate UIDs and incomplete scans prevent speculative removal.
- Network errors remain pending for retry. A task first received after its reminder
  time is recorded as `missed`, never falsely marked as notified. Moving it to a future
  time allows another attempt. Remote events are rechecked at least every ten minutes.
  Moving a previously synced future reminder into the past removes the old owned alarm.
  Failed removal keeps its prior acknowledgement and retries; it is not reported done.
- `Internals/FocusTasks/calendar-status.json` exposes the last acknowledgement and
  errors to both devices. A local file lock permits one writer; state is bound to the
  chosen vault/calendar. Default `Архив` subfolder is excluded explicitly.
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
