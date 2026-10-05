#!/usr/bin/env python3
"""One-way task-note -> Apple Calendar notifications. Dry-run unless --execute.

Only tasks with an explicit scheduled time are mirrored. Dates without a time stay
in Obsidian. Credentials stay outside the vault. Managed events have an ownership
marker and stable UID; manual calendar events are never candidates for deletion.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import tempfile
import unicodedata
import contextlib
import fcntl
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

import yaml

UTC = dt.timezone.utc
EVENT_DURATION_MINUTES = 30
CALENDAR_CONTRACT = "focus-view-at-start-v1"
SILENT_TRIGGER = dt.datetime(1976, 4, 1, 0, 55, 45, tzinfo=UTC)
OWNER = "X-FOCUS-TASKS-UID"
FRONT = re.compile(r"^\ufeff?---\r?\n(.*?)\r?\n---(?:\r?\n|$)", re.S)


@dataclass(frozen=True)
class Reminder:
    uid: str
    path: str
    title: str
    at: dt.datetime
    waiting: bool
    vault: str
    scheduled: str = ""

    def __post_init__(self):
        # RFC 5545 DATE-TIME has whole seconds. Align the identity/readback with that precision.
        object.__setattr__(self, "at", self.at.replace(microsecond=0))

    @property
    def event_uid(self):
        return "focus-task-" + hashlib.sha256(self.uid.encode()).hexdigest()[:32] + "@focus-tasks"

    @property
    def fingerprint(self):
        content = [self.uid, self.path, self.title, self.at.isoformat(), self.waiting, self.vault, self.scheduled, EVENT_DURATION_MINUTES, CALENDAR_CONTRACT, focus_url(self)]
        return hashlib.sha256(json.dumps(content, ensure_ascii=False).encode()).hexdigest()


@dataclass
class Snapshot:
    desired: dict[str, Reminder] = field(default_factory=dict)
    seen: set[str] = field(default_factory=set)
    blocked_paths: set[str] = field(default_factory=set)
    duplicates: set[str] = field(default_factory=set)
    errors: list[str] = field(default_factory=list)
    files: int = 0


def scan(vault: Path, folder="Задачи", timezone="Europe/Moscow", exclude=("Архив",)) -> Snapshot:
    vault = vault.resolve()
    zone = ZoneInfo(timezone)
    root = (vault / folder).resolve()
    if not root.is_relative_to(vault.resolve()) or not root.is_dir():
        raise ValueError("task folder missing or outside vault; refusing reconciliation")
    out = Snapshot()
    for path in sorted(root.rglob("*.md")):
        if any(path.relative_to(root).parts[:-1] and path.relative_to(root).parts[0] == item for item in exclude):
            continue
        rel = str(path.relative_to(vault))
        if path.is_symlink():
            out.blocked_paths.add(rel)
            out.errors.append("symlink")
            continue
        out.files += 1
        try:
            text = path.read_text(encoding="utf-8")
            match = FRONT.match(text)
            fm = yaml.safe_load(match[1]) if match else None
            if not isinstance(fm, dict):
                raise ValueError("frontmatter missing")
            uid = str(fm.get("uid") or "")
            if uid:
                if uid in out.seen:
                    out.duplicates.add(uid)
                out.seen.add(uid)
            kind = str(fm.get("type", "")).strip().lower()
            if kind not in ("task", "задача") or not uid:
                continue
            status = str(fm.get("status", "open")).strip().lower()
            tags = fm.get("tags") or []
            if not isinstance(tags, list):
                tags = [tags]
            if status in ("done", "cancelled", "someday") or any(str(t).lstrip("#").lower() == "archived" for t in tags):
                continue
            raw = str(fm.get("scheduled") or "")
            if not re.search(r"[T ]\d{2}:\d{2}", raw):
                continue
            at = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if at.tzinfo is None:
                local = at
                at = at.replace(tzinfo=zone)
                if at.astimezone(UTC).astimezone(zone).replace(tzinfo=None) != local:
                    raise ValueError("nonexistent local time")
                if at.replace(fold=0).utcoffset() != at.replace(fold=1).utcoffset():
                    raise ValueError("ambiguous local time needs an explicit offset")
            scheduled = dt.datetime.fromisoformat(raw.replace("Z", "+00:00")).strftime("%Y-%m-%dT%H:%M")
            title = str(fm.get("title") or "").strip() or path.stem
            out.desired[uid] = Reminder(uid, rel, title, at.astimezone(UTC), status == "waiting", vault.name, scheduled)
        except (OSError, UnicodeError, yaml.YAMLError, ValueError, TypeError):
            out.blocked_paths.add(rel)
            out.errors.append("unreadable-task")
    for uid in out.duplicates:
        out.desired.pop(uid, None)
    return out


def focus_url(reminder: Reminder) -> str:
    # Pass the permanent task UID; neither a rename nor a project move changes the destination.
    return "obsidian://focus-tasks?" + urlencode({"vault": unicodedata.normalize("NFC", reminder.vault), "uid": reminder.uid}, quote_via=quote)


note_url = focus_url  # Compatibility for callers of the previous bridge helper.


def event_ical(reminder: Reminder) -> bytes:
    from icalendar import Calendar, Event, Alarm
    ev = Event()
    ev.add("uid", reminder.event_uid)
    ev.add("dtstamp", dt.datetime.now(UTC))
    ev.add(OWNER, reminder.uid)
    ev.add("X-FOCUS-TASKS-FINGERPRINT", reminder.fingerprint)
    ev.add("summary", reminder.title)
    ev.add("dtstart", reminder.at)
    ev.add("dtend", reminder.at + dt.timedelta(minutes=EVENT_DURATION_MINUTES))
    ev.add("transp", "TRANSPARENT")
    link = focus_url(reminder)
    ev.add("url", link)
    ev.add("description", "Открыть задачу в Фокусе: " + link + "\nСсылка находит задачу по постоянному UID. Дату и время меняй в Фокусе.")
    # Apple's explicit NONE placeholder disables the device's default alert for this event.
    # The separate DISPLAY alarm is the sole notification, at DTSTART. Both need a UID in iCloud.
    quiet = Alarm()
    quiet.add("uid", reminder.event_uid.replace("@", "-default@"))
    quiet.add("X-WR-ALARMUID", reminder.event_uid.replace("@", "-default@"))
    quiet.add("X-APPLE-DEFAULT-ALARM", "TRUE")
    quiet.add("action", "NONE")
    quiet.add("trigger", SILENT_TRIGGER)
    ev.add_component(quiet)
    alert = Alarm()
    alert.add("uid", reminder.event_uid.replace("@", "-alarm@"))
    alert.add("X-WR-ALARMUID", reminder.event_uid.replace("@", "-alarm@"))
    alert.add("action", "DISPLAY")
    alert.add("description", reminder.title)
    alert.add("trigger", dt.timedelta(0))
    ev.add_component(alert)
    cal = Calendar()
    cal.add("prodid", "-//Focus Tasks//Apple Calendar bridge//RU")
    cal.add("version", "2.0")
    cal.add_component(ev)
    return cal.to_ical()


class OwnershipConflict(RuntimeError):
    pass


class ICloud:
    def __init__(self, calendar):
        self.calendar = calendar

    def existing(self, reminder):
        url = self.calendar.url.join(quote(reminder.event_uid, safe="") + ".ics")
        response = self.calendar.client.request(str(url))
        if response.status == 404:
            return None
        if response.status != 200:
            raise RuntimeError("calendar GET failed")
        from icalendar import Calendar
        events = Calendar.from_ical(response.raw).walk("VEVENT")
        if len(events) != 1 or str(events[0].get(OWNER, "")) != reminder.uid:
            raise OwnershipConflict("resource is not owned by Focus Tasks")
        etag = response.headers.get("ETag") or response.headers.get("etag")
        if not etag:
            raise RuntimeError("calendar resource has no ETag")
        return {"url": str(url), "etag": etag, "event": events[0]}

    def verify(self, reminder):
        obj = self.existing(reminder)
        if obj is None:
            return False
        ev = obj["event"]
        alarms = ev.walk("VALARM")
        active = [a for a in alarms if str(a.get("action", "")).upper() != "NONE"]
        silent_default = any(str(a.get("action", "")).upper() == "NONE"
            and str(a.get("X-APPLE-DEFAULT-ALARM", "")).upper() == "TRUE"
            and a.decoded("trigger") == SILENT_TRIGGER for a in alarms)
        return (str(ev.get("uid")) == reminder.event_uid
            and str(ev.get("X-FOCUS-TASKS-FINGERPRINT", "")) == reminder.fingerprint
            and ev.decoded("dtstart") == reminder.at
            and ev.decoded("dtend") == reminder.at + dt.timedelta(minutes=EVENT_DURATION_MINUTES)
            and str(ev.get("summary", "")) == reminder.title
            and str(ev.get("url", "")) == focus_url(reminder)
            and silent_default and len(active) == 1
            and str(active[0].get("action", "")).upper() == "DISPLAY"
            and str(active[0].get("uid", "")) == reminder.event_uid.replace("@", "-alarm@")
            and active[0].decoded("trigger") == dt.timedelta(0)
            and str(active[0]["trigger"].params.get("RELATED", "START")).upper() == "START"
            and not active[0].get("repeat"))

    def upsert(self, reminder):
        old = self.existing(reminder)
        url = self.calendar.url.join(quote(reminder.event_uid, safe="") + ".ics")
        # Conditional writes close the GET/PUT race: another writer cannot replace the resource
        # between ownership verification and saving, even with a coincidentally identical URL.
        headers = {"Content-Type": "text/calendar; charset=utf-8"}
        headers.update({"If-Match": old["etag"]} if old else {"If-None-Match": "*"})
        response = self.calendar.client.put(str(url), event_ical(reminder), headers=headers)
        if response.status in (409, 412):
            raise OwnershipConflict("resource changed during write")
        if response.status not in (200, 201, 204):
            raise RuntimeError("calendar PUT failed")
        # iCloud has dropped alarms before: acknowledgement requires the object to survive a GET.
        if not self.verify(reminder):
            raise RuntimeError("calendar read-back failed")

    def delete(self, reminder):
        old = self.existing(reminder)
        if old is not None:
            response = self.calendar.client.request(old["url"], "DELETE", headers={"If-Match": old["etag"]})
            if response.status in (409, 412):
                raise OwnershipConflict("resource changed during delete")
            if response.status not in (200, 204, 404):
                raise RuntimeError("calendar DELETE failed")


def reconcile(snapshot, state, transport, now=None, grace=120, verify_every=600):
    """Failures remain pending. Missing files get a Sync grace period; malformed notes protect events."""
    now = now or dt.datetime.now(UTC)
    saved = state.setdefault("tasks", {})
    errors = []
    for uid in snapshot.duplicates:
        if uid in saved:
            saved[uid]["error"] = "DuplicateUID"
    for uid, reminder in snapshot.desired.items():
        prior = saved.get(uid, {})
        try:
            if prior.get("fingerprint") == reminder.fingerprint:
                prior.pop("missingSince", None)
                checked = dt.datetime.fromisoformat(prior.get("checkedAt", "1970-01-01T00:00:00+00:00"))
                if prior.get("status") == "synced" and ((not prior.get("error") and (now - checked).total_seconds() < verify_every) or transport.verify(reminder)):
                    if prior.get("error") or (now - checked).total_seconds() >= verify_every:
                        prior["checkedAt"] = now.isoformat()
                    prior.pop("error", None)
                    continue
            # A timestamp always owns an event, even if Sync delivered it late. Acknowledgement
            # means the event exists in iCloud; it never claims a physical notification was seen.
            transport.upsert(reminder)
            saved[uid] = {"file": reminder.path, "at": reminder.at.isoformat(), "scheduled": reminder.scheduled, "status": "synced", "fingerprint": reminder.fingerprint, "waiting": reminder.waiting, "title": reminder.title, "vault": reminder.vault, "checkedAt": now.isoformat()}
        except Exception as e:
            errors.append(type(e).__name__)
            saved.setdefault(uid, {"file": reminder.path, "status": "pending"})["error"] = type(e).__name__
    for uid, prior in list(saved.items()):
        if uid in snapshot.desired or uid in snapshot.duplicates or prior["file"] in snapshot.blocked_paths:
            continue
        if uid not in snapshot.seen:
            if snapshot.errors:
                continue  # an unreadable renamed note may be the missing UID: do not guess deletion
            since = prior.setdefault("missingSince", now.isoformat())
            if (now - dt.datetime.fromisoformat(since)).total_seconds() < grace:
                continue
        try:
            if prior.get("status") == "synced":
                old = Reminder(uid, prior["file"], prior.get("title", ""), dt.datetime.fromisoformat(prior["at"]), prior.get("waiting", False), prior.get("vault", ""))
                transport.delete(old)
            del saved[uid]
        except Exception as e:
            errors.append(type(e).__name__)
    state.update(enabled=True, connected=True, contract=CALENDAR_CONTRACT, updatedAt=now.isoformat(), errors=errors + snapshot.errors)
    return state


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".calendar-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(state, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def publish_status(path, state):
    """Markdown receipts sync to iPhone even when Sync excludes arbitrary JSON files.

    This is a derived acknowledgement, not the bridge's deletion/ownership ledger.
    No credentials or CalDAV URLs are copied into the vault.
    """
    fields = ("file", "title", "scheduled", "waiting", "status", "checkedAt", "error")
    public = {"schema": 2, "contract": state.get("contract"), "enabled": state.get("enabled", False),
              "connected": state.get("connected", False), "errors": state.get("errors", []),
              "tasks": {uid: {key: item[key] for key in fields if key in item}
                        for uid, item in state.get("tasks", {}).items()}}
    text = '---\ntype: focus-tasks-calendar-status\n---\n\n```json\n' + json.dumps(public, ensure_ascii=False, sort_keys=True, indent=2) + '\n```\n'
    path = path.with_suffix(".md")
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".calendar-receipt-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def connect(calendar_name, env_file=None):
    if env_file:
        for line in Path(env_file).read_text().splitlines():
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            key, value = line.split("=", 1)
            if key.strip() in ("CALDAV_USERNAME", "CALDAV_PASSWORD"):
                os.environ.setdefault(key.strip(), value.strip())
    import caldav
    user, password = os.getenv("CALDAV_USERNAME"), os.getenv("CALDAV_PASSWORD")
    if not user or not password:
        raise RuntimeError("CalDAV credentials missing")
    client = caldav.DAVClient(url="https://caldav.icloud.com/", username=user, password=password, timeout=30)
    matches = [c for c in client.principal().calendars() if c.get_display_name() == calendar_name]
    if len(matches) != 1:
        raise RuntimeError("calendar name missing or ambiguous")
    return ICloud(matches[0])


@contextlib.contextmanager
def lease(binding):
    """Local single writer. Lock files live outside the synced vault."""
    folder = Path.home() / ".cache/focus-tasks"
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / (binding + ".lock")).open("w") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--folder", default="Задачи")
    parser.add_argument("--calendar", default="Focus Tasks")
    parser.add_argument("--timezone", default="Europe/Moscow")
    parser.add_argument("--exclude", action="append", default=["Архив"], help="Excluded direct subfolders of the task folder")
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    snapshot = scan(args.vault, args.folder, args.timezone, args.exclude)
    result = {"taskFiles": snapshot.files, "reminders": len(snapshot.desired), "invalid": len(snapshot.errors), "duplicateUids": len(snapshot.duplicates), "execute": args.execute}
    if args.execute:
        state_path = args.vault / "Internals/FocusTasks/calendar-status.json"
        binding = hashlib.sha256((str(args.vault.resolve()) + "\n" + args.calendar).encode()).hexdigest()
        with lease(binding):
            state = json.loads(state_path.read_text()) if state_path.exists() else {"tasks": {}, "binding": binding}
            if state.get("binding") != binding:
                raise RuntimeError("state belongs to another vault or calendar")
            try:
                reconcile(snapshot, state, connect(args.calendar, args.env_file))
            except Exception as exc:
                # A discovery/auth/network failure is visible immediately, without
                # replacing the previous task acknowledgement or exposing account URLs.
                state.update(enabled=True, connected=False, updatedAt=dt.datetime.now(UTC).isoformat(), errors=[type(exc).__name__])
                save_state(state_path, state)
                publish_status(state_path, state)
                raise
            save_state(state_path, state)
            publish_status(state_path, state)
            result["errors"] = len(state["errors"])
    print(json.dumps(result))  # no task text, account identifiers or credential values in stdout
    return 1 if result.get("errors") or result["invalid"] or result["duplicateUids"] else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"error": type(exc).__name__}))
        raise SystemExit(1)  # CalDAV exception text can contain account URLs: never print it
