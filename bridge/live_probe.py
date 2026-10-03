"""Explicit disposable iCloud integration test. Only its newly created calendar is touched."""
import argparse
import datetime as dt
import json
import uuid
import unicodedata
from urllib.parse import parse_qs, urlparse

from apple_calendar import ICloud, Reminder, connect


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--source-calendar", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if not args.execute:
        print(json.dumps({"execute": False, "plan": "create disposable calendar, create/update/read/delete one event, delete calendar"}))
        return
    source = connect(args.source_calendar, args.env_file)
    name = "Focus Tasks TEST " + uuid.uuid4().hex[:12]
    calendar = source.calendar.client.principal().make_calendar(name=name)
    checks = []
    try:
        bridge = ICloud(calendar)
        uid = "probe-" + uuid.uuid4().hex
        at = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)).replace(second=0, microsecond=0)
        one = Reminder(uid, unicodedata.normalize("NFD", "Задачи/Календарь й.md"), "Focus Tasks calendar test", at, False, "Test Vault")
        bridge.upsert(one)
        assert bridge.verify(one)
        checks.append("create+alarm-readback")
        link = str(bridge.existing(one)["event"]["url"])
        assert parse_qs(urlparse(link).query) == {"vault": [one.vault], "file": ["Задачи/Календарь й.md"]}
        checks.append("unicode-task-link-readback")
        two = Reminder(uid, one.path, one.title, at + dt.timedelta(hours=1), True, one.vault)
        bridge.upsert(two)
        assert bridge.verify(two)
        checks.append("reschedule+waiting+same-uid")
        assert len(calendar.events()) == 1
        checks.append("no-duplicates")
        bridge.delete(two)
        assert bridge.existing(two) is None
        checks.append("delete")
    finally:
        calendar.delete()
        checks.append("temporary-calendar-cleaned")
    print(json.dumps({"passed": checks}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": type(exc).__name__}))
        raise SystemExit(1)
