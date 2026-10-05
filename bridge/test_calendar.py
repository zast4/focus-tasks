"""No network, real YAML and ICS. Failure injection covers reconciliation and ownership."""
import copy
import datetime as dt
import tempfile
import unittest
import contextlib
import hashlib
import io
import json
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace

from icalendar import Calendar
from caldav.lib.url import URL

from apple_calendar import ICloud, OWNER, OwnershipConflict, Reminder, Snapshot, event_ical, reconcile, save_state, scan, main, publish_status, CALENDAR_CONTRACT, SILENT_TRIGGER
from install_macos import job

NOW = dt.datetime(2030, 1, 2, 12, tzinfo=dt.timezone.utc)


def reminder(uid="one", at=None, waiting=False, path="Задачи/One.md"):
    return Reminder(uid, path, "A task with commas, ; and\nnewlines", at or NOW + dt.timedelta(days=2), waiting, "Test Vault")


class MemoryCalendar:
    def __init__(self):
        self.items, self.calls = {}, []
        self.fail = False

    def upsert(self, r):
        if self.fail:
            raise ConnectionError("secret URL must not escape")
        self.calls.append(("upsert", r.uid))
        self.items[r.uid] = r

    def verify(self, r):
        if self.fail:
            raise ConnectionError("connection")
        return self.items.get(r.uid) == r

    def delete(self, r):
        if self.fail:
            raise ConnectionError("connection")
        self.calls.append(("delete", r.uid))
        self.items.pop(r.uid, None)


class ReconcileTests(unittest.TestCase):
    def setUp(self):
        self.remote = MemoryCalendar()
        self.state = {"tasks": {}}
        self.r = reminder()
        self.snapshot = Snapshot(desired={self.r.uid: self.r}, seen={self.r.uid})

    def run_at(self, snapshot=None, now=NOW):
        return reconcile(snapshot or self.snapshot, self.state, self.remote, now=now)

    def test_repeated_poll_is_idempotent(self):
        for _ in range(50):
            self.run_at()
        self.assertEqual(self.remote.calls, [("upsert", "one")])

    def test_old_one_minute_event_is_updated_once_with_the_same_identity(self):
        self.run_at()
        old_content=[self.r.uid,self.r.path,self.r.title,self.r.at.isoformat(),self.r.waiting,self.r.vault]
        self.state['tasks'][self.r.uid]['fingerprint']=hashlib.sha256(json.dumps(old_content,ensure_ascii=False).encode()).hexdigest()
        event_uid=self.r.event_uid
        for _ in range(3):self.run_at()
        self.assertEqual(self.remote.calls, [('upsert','one'),('upsert','one')])
        self.assertEqual(self.remote.items['one'].event_uid,event_uid)
        self.assertEqual(self.state['tasks']['one']['fingerprint'],self.r.fingerprint)

    def test_reschedule_updates_same_uid(self):
        self.run_at()
        r = reminder(at=NOW + dt.timedelta(days=4))
        self.run_at(Snapshot(desired={r.uid: r}, seen={r.uid}))
        self.assertEqual(len(self.remote.items), 1)
        self.assertEqual(self.remote.items["one"].at, r.at)

    def test_waiting_uses_same_event_identity(self):
        self.run_at()
        r = reminder(waiting=True)
        self.run_at(Snapshot(desired={r.uid: r}, seen={r.uid}))
        self.assertEqual(r.event_uid, self.r.event_uid)
        self.assertTrue(self.remote.items["one"].waiting)

    def test_done_or_time_removed_deletes_owned_event(self):
        self.run_at()
        self.run_at(Snapshot(seen={"one"}))
        self.assertEqual(self.remote.items, {})
        self.assertEqual(self.state["tasks"], {})

    def test_sync_gap_is_not_a_deletion(self):
        self.run_at()
        self.run_at(Snapshot(), now=NOW + dt.timedelta(seconds=10))
        self.run_at(now=NOW + dt.timedelta(seconds=30))
        self.assertIn("one", self.remote.items)
        self.assertNotIn("missingSince", self.state["tasks"]["one"])

    def test_missing_file_deleted_after_grace(self):
        self.run_at()
        self.run_at(Snapshot())
        self.run_at(Snapshot(), now=NOW + dt.timedelta(seconds=121))
        self.assertEqual(self.remote.items, {})

    def test_corrupt_renamed_note_blocks_missing_cleanup(self):
        self.run_at()
        s = Snapshot(errors=["unreadable-task"], blocked_paths={"Задачи/Renamed.md"})
        self.run_at(s)
        self.run_at(s, now=NOW + dt.timedelta(days=1))
        self.assertIn("one", self.remote.items)

    def test_duplicate_identity_is_quarantined(self):
        self.run_at()
        self.run_at(Snapshot(seen={"one"}, duplicates={"one"}))
        self.assertIn("one", self.remote.items)

    def test_offline_failure_is_retried_and_not_acknowledged(self):
        self.remote.fail = True
        self.run_at()
        self.assertEqual(self.state["tasks"]["one"]["status"], "pending")
        self.assertEqual(self.state["tasks"]["one"]["error"], "ConnectionError")
        self.assertNotIn("checkedAt", self.state["tasks"]["one"])
        self.assertEqual(self.state["errors"], ["ConnectionError"])
        self.remote.fail = False
        self.run_at()
        self.assertEqual(self.state["tasks"]["one"]["status"], "synced")

    def test_failed_delete_keeps_state_for_retry(self):
        self.run_at()
        self.remote.fail = True
        self.run_at(Snapshot(seen={"one"}))
        self.assertIn("one", self.state["tasks"])
        self.remote.fail = False
        self.run_at(Snapshot(seen={"one"}))
        self.assertEqual(self.state["tasks"], {})

    def test_late_arrival_still_creates_the_event_without_claiming_notification_delivery(self):
        self.r = reminder(at=NOW - dt.timedelta(hours=1))
        self.snapshot = Snapshot(desired={"one": self.r}, seen={"one"})
        for _ in range(10):
            self.run_at()
        self.assertEqual(self.state["tasks"]["one"]["status"], "synced")
        self.assertEqual(self.remote.calls, [("upsert", "one")])
        self.assertEqual(self.remote.items["one"].at, self.r.at)
        self.snapshot.desired["one"] = reminder(at=NOW + dt.timedelta(hours=1))
        self.run_at()
        self.assertEqual(len(self.remote.calls), 2)

    def test_remote_deleted_event_recreated_at_verification(self):
        self.run_at()
        self.remote.items.clear()
        self.run_at(now=NOW + dt.timedelta(minutes=11))
        self.assertEqual(len(self.remote.calls), 2)

    def test_rescheduling_into_the_past_updates_the_same_event(self):
        self.run_at()
        event_uid = self.r.event_uid
        self.snapshot.desired['one'] = reminder(at=NOW-dt.timedelta(minutes=1))
        self.run_at()
        self.assertEqual(self.state['tasks']['one']['status'], 'synced')
        self.assertEqual(self.remote.items['one'], self.snapshot.desired['one'])
        self.assertEqual(self.remote.items['one'].event_uid, event_uid)
        self.assertEqual(self.remote.calls, [('upsert', 'one'), ('upsert', 'one')])

    def test_failed_update_keeps_ownership_but_has_no_current_success_until_retry(self):
        self.run_at()
        previous = self.state['tasks']['one']['fingerprint']
        self.snapshot.desired['one'] = reminder(at=NOW-dt.timedelta(minutes=1))
        self.remote.fail = True
        self.run_at()
        self.assertEqual(self.state['tasks']['one']['fingerprint'], previous)
        self.assertEqual(self.state['tasks']['one']['error'], 'ConnectionError')
        self.remote.fail = False
        self.run_at()
        self.assertEqual(self.state['tasks']['one']['fingerprint'], self.snapshot.desired['one'].fingerprint)
        self.assertNotIn('error', self.state['tasks']['one'])

    def test_offline_during_periodic_verification_keeps_last_acknowledgement(self):
        self.run_at()
        self.remote.fail = True
        self.run_at(now=NOW + dt.timedelta(minutes=11))
        self.assertEqual(self.state["tasks"]["one"]["checkedAt"], NOW.isoformat())
        self.assertEqual(self.state["errors"], ["ConnectionError"])


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name)
        (self.vault / "Задачи").mkdir()

    def write(self, name="One", extra="", newline="\n", uid="one"):
        text = f'---\ntype: задача\nuid: {uid}\nstatus: open\nscheduled: 2030-01-04T16:30\n{extra}---\nDescription untouched\n'
        (self.vault / "Задачи" / (name + ".md")).write_bytes(text.replace("\n", newline).encode())

    def test_real_yaml_crlf_and_body_untouched(self):
        self.write(extra='unknown:\n  nested: [a, b]\n', newline="\r\n")
        before = (self.vault / "Задачи/One.md").read_bytes()
        out = scan(self.vault)
        self.assertEqual(out.desired["one"].at.hour, 13)
        self.assertEqual(out.errors, [])
        self.assertEqual((self.vault / "Задачи/One.md").read_bytes(), before)

    def test_duplicate_uids_never_create_events(self):
        self.write()
        self.write("Copy")
        out = scan(self.vault)
        self.assertEqual(out.desired, {})
        self.assertEqual(out.duplicates, {"one"})

    def test_bad_yaml_protects_previous_path(self):
        self.write(extra="invalid: [\n")
        self.assertIn("Задачи/One.md", scan(self.vault).blocked_paths)

    def test_missing_folder_is_not_an_empty_snapshot(self):
        with self.assertRaises(ValueError):
            scan(self.vault, "Missing")

    def test_folder_cannot_escape_vault(self):
        with self.assertRaises(ValueError):
            scan(self.vault, "../")

    def test_day_without_clock_does_not_make_a_calendar_event(self):
        self.write()
        p = self.vault / "Задачи/One.md"
        p.write_text(p.read_text().replace("2030-01-04T16:30", "2030-01-04"))
        self.assertEqual(scan(self.vault).desired, {})

    def test_timezone_offset_is_preserved(self):
        self.write()
        p = self.vault / "Задачи/One.md"
        p.write_text(p.read_text().replace("2030-01-04T16:30", "2030-01-04T16:30-05:00"))
        self.assertEqual(scan(self.vault).desired["one"].at.hour, 21)

    def test_archived_folder_is_explicitly_out_of_bridge_scope(self):
        p=self.vault/'Задачи/Архив';p.mkdir();(p/'Broken.md').write_text('---\ninvalid: [\n---\n')
        self.assertEqual(scan(self.vault).errors,[])

    def test_dst_gap_and_ambiguous_hour_require_an_explicit_offset(self):
        for raw in ('2030-03-10T02:30','2030-11-03T01:30'):
            self.write();p=self.vault/'Задачи/One.md';p.write_text(p.read_text().replace('2030-01-04T16:30',raw))
            out=scan(self.vault,timezone='America/New_York');self.assertEqual(out.desired,{});self.assertTrue(out.errors)

    def test_completion_cancellation_and_archiving_suppress_event(self):
        for extra in ("status: done\n", "status: cancelled\n", "status: someday\n", "tags: [archived]\n"):
            # Duplicate YAML keys are not produced here.
            self.write()
            p = self.vault / "Задачи/One.md"
            p.write_text(p.read_text().replace("status: open\n", "" if extra.startswith("status:") else "status: open\n").replace("---\nDescription", extra + "---\nDescription"))
            self.assertEqual(scan(self.vault).desired, {})


class IcsTests(unittest.TestCase):
    def test_launch_job_runs_inside_the_requested_venv(self):
        import os
        import subprocess
        import sys
        with tempfile.TemporaryDirectory() as folder:
            venv = Path(folder) / 'venv'
            subprocess.run([sys.executable, '-m', 'venv', '--without-pip', '--symlinks', str(venv)], check=True, capture_output=True)
            python = venv / 'bin/python'
            site = Path(subprocess.check_output([str(python), '-c', 'import sysconfig;print(sysconfig.get_path("purelib"))'], text=True).strip())
            (site / 'focus_launch_probe.py').write_text('value = 1\n')
            data, _ = job(Path(folder), python, 'Focus Tasks', Path(folder) / 'external.env', True)
            env = {k: v for k, v in os.environ.items() if k not in ('VIRTUAL_ENV', 'PYTHONHOME', 'PYTHONPATH')}
            run = subprocess.run([data['ProgramArguments'][0], '-c', 'import sys,focus_launch_probe;print(sys.prefix)'], env=env, capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(Path(run.stdout.strip()).resolve(), venv.resolve())

    def test_prepared_job_is_disabled_and_keeps_credentials_out_of_arguments(self):
        data,label=job(Path('/tmp/Vault with spaces'),Path('/tmp/python'),"Focus Tasks",Path('/tmp/external.env'))
        self.assertTrue(data['Disabled'])
        self.assertTrue(data['RunAtLoad'])
        self.assertIn(str(Path('/tmp/Vault with spaces').resolve()),data['ProgramArguments'])
        self.assertNotIn('CALDAV_PASSWORD',str(data))
        self.assertEqual(job(Path('/tmp/Vault with spaces'),Path('/tmp/python'),"Focus Tasks",Path('/tmp/external.env'),True)[1],label)

    def test_event_has_one_at_start_alert_disabled_default_and_opens_focus(self):
        for waiting in (False, True):
            r = reminder(waiting=waiting)
            ev = Calendar.from_ical(event_ical(r)).walk("VEVENT")[0]
            self.assertEqual(str(ev["uid"]), r.event_uid)
            self.assertEqual(str(ev[OWNER]), r.uid)
            self.assertEqual(ev.decoded("dtstart"), r.at)
            self.assertEqual(ev.decoded("dtend") - ev.decoded("dtstart"), dt.timedelta(hours=1))
            self.assertNotIn("description", ev)
            self.assertEqual(str(ev["transp"]), "TRANSPARENT")
            self.assertIn("obsidian://focus-tasks?", str(ev["url"]))
            self.assertEqual(str(ev['summary']), r.title)
            alarms = ev.walk('VALARM')
            self.assertTrue(all(str(a.get('uid', '')) for a in alarms))
            active = [a for a in alarms if str(a.get('action', '')) != 'NONE']
            self.assertEqual(len(active), 1)
            self.assertEqual(str(active[0]['action']), 'DISPLAY')
            self.assertEqual(active[0].decoded('trigger'), dt.timedelta(0))
            quiet = [a for a in alarms if str(a.get('action', '')) == 'NONE']
            self.assertEqual(len(quiet), 1)
            self.assertEqual(quiet[0].decoded('trigger'), SILENT_TRIGGER)
            self.assertEqual(str(quiet[0]['X-APPLE-DEFAULT-ALARM']), 'TRUE')

    def test_calendar_link_uses_obsidian_unicode_paths(self):
        import dataclasses
        import unicodedata
        from urllib.parse import urlparse, parse_qs
        r = reminder()
        r = dataclasses.replace(r, vault=unicodedata.normalize("NFD", "Хранилище й"),
                                path=unicodedata.normalize("NFD", "Задачи/Проверить й.md"))
        ev = Calendar.from_ical(event_ical(r)).walk("VEVENT")[0]
        query = parse_qs(urlparse(str(ev["url"])).query)
        self.assertEqual(query, {"vault": ["Хранилище й"], "uid": [r.uid]})

    def test_calendar_uri_matches_obsidians_percent_decoder_for_spaces_and_plus(self):
        import dataclasses
        from urllib.parse import urlsplit,unquote
        r=dataclasses.replace(reminder(),vault='Vault space + plus',path='Задачи/Тест + пробел 50%.md')
        url=str(Calendar.from_ical(event_ical(r)).walk('VEVENT')[0]['url'])
        decoded=dict((unquote(k),unquote(v)) for k,v in (part.split('=',1) for part in urlsplit(url).query.split('&')))
        self.assertEqual(decoded,{'vault':r.vault,'uid':r.uid})
        self.assertNotIn('+',url)

    def test_task_link_survives_renames_and_moves_and_encodes_opaque_uids(self):
        import dataclasses
        from urllib.parse import urlsplit, parse_qs
        r = dataclasses.replace(reminder(), uid='id + /?&й')
        renamed = dataclasses.replace(r, title='New task title', path='Задачи/New filename.md')
        self.assertEqual(str(Calendar.from_ical(event_ical(r)).walk('VEVENT')[0]['url']),
                         str(Calendar.from_ical(event_ical(renamed)).walk('VEVENT')[0]['url']))
        query = parse_qs(urlsplit(str(Calendar.from_ical(event_ical(r)).walk('VEVENT')[0]['url'])).query)
        self.assertEqual(query['uid'], [r.uid])
        self.assertEqual(r.event_uid, renamed.event_uid)

    def test_plain_focus_link_migrates_in_place_once_without_duplicate_events(self):
        r = reminder()
        snapshot, remote, state = Snapshot(desired={r.uid:r}, seen={r.uid}), MemoryCalendar(), {'tasks':{}}
        reconcile(snapshot,state,remote,now=NOW)
        legacy=[r.uid,r.path,r.title,r.at.isoformat(),r.waiting,r.vault,r.scheduled,30,CALENDAR_CONTRACT]
        state['tasks'][r.uid]['fingerprint']=hashlib.sha256(json.dumps(legacy,ensure_ascii=False).encode()).hexdigest()
        remote.calls.clear()
        reconcile(snapshot,state,remote,now=NOW+dt.timedelta(seconds=1))
        self.assertEqual(remote.calls,[('upsert',r.uid)])
        self.assertEqual(len(remote.items),1)
        self.assertEqual(remote.items[r.uid].event_uid,r.event_uid)
        reconcile(snapshot,state,remote,now=NOW+dt.timedelta(seconds=2))
        self.assertEqual(remote.calls,[('upsert',r.uid)])

    def test_readback_rejects_any_extra_active_default_alert(self):
        from icalendar import Alarm
        r = reminder()
        ev = Calendar.from_ical(event_ical(r)).walk('VEVENT')[0]
        remote = object.__new__(ICloud)
        with patch.object(ICloud, 'existing', return_value={'event': ev}):
            self.assertTrue(remote.verify(r))
            native = Alarm(); native.add('uid', 'native-client-default'); native.add('action', 'DISPLAY')
            native.add('trigger', -dt.timedelta(minutes=30)); native.add('X-APPLE-DEFAULT-ALARM', 'TRUE')
            ev.add_component(native)
            self.assertFalse(remote.verify(r))

    def test_cloud_acknowledgement_rejects_old_event_duration(self):
        r=reminder()
        ev=Calendar.from_ical(event_ical(r)).walk('VEVENT')[0]
        remote=object.__new__(ICloud)
        with patch.object(ICloud,'existing',return_value={'event':ev}):
            self.assertTrue(remote.verify(r))
            ev.pop('dtend')
            ev.add('dtend',r.at+dt.timedelta(minutes=1))
            self.assertFalse(remote.verify(r))

    def test_state_is_complete_atomic_json(self):
        with tempfile.TemporaryDirectory() as folder:
            state = {"tasks": {"one": {"status": "synced"}}}
            p = Path(folder) / "status.json"
            save_state(p, state)
            import json
            self.assertEqual(json.loads(p.read_text()), state)
            self.assertEqual(len(list(Path(folder).iterdir())), 1)


class CalendarReceiptTests(unittest.TestCase):
    def test_reverting_a_clock_after_uncertain_write_rechecks_cloud_before_acknowledging(self):
        import dataclasses
        class UncertainCalendar(MemoryCalendar):
            uncertain = False
            def upsert(self, r):
                super().upsert(r)
                if self.uncertain: raise ConnectionError('response lost after PUT')
        remote, state, original = UncertainCalendar(), {'tasks': {}}, reminder()
        snapshot = Snapshot(desired={'one': original}, seen={'one'})
        reconcile(snapshot, state, remote, now=NOW)
        snapshot.desired['one'] = dataclasses.replace(original, at=original.at+dt.timedelta(hours=1))
        remote.uncertain = True
        reconcile(snapshot, state, remote, now=NOW)
        self.assertNotEqual(remote.items['one'], original)
        self.assertIn('error', state['tasks']['one'])
        snapshot.desired['one'] = original
        remote.uncertain = False
        reconcile(snapshot, state, remote, now=NOW)
        self.assertEqual(remote.items['one'], original)
        self.assertEqual(state['tasks']['one']['status'], 'synced')
        self.assertNotIn('error', state['tasks']['one'])

    def test_fractional_seconds_cannot_make_a_successful_cloud_write_look_failed(self):
        r = reminder(at=NOW.replace(microsecond=123456))
        ev = Calendar.from_ical(event_ical(r)).walk('VEVENT')[0]
        self.assertEqual(ev.decoded('dtstart'), r.at)
        self.assertEqual(r.at.microsecond, 0)
        remote = object.__new__(ICloud)
        with patch.object(ICloud, 'existing', return_value={'event': ev}):
            self.assertTrue(remote.verify(r))

    def test_group_rescheduling_updates_each_existing_event_and_confirms_each_clock(self):
        import dataclasses
        remote, state = MemoryCalendar(), {'tasks': {}}
        first = dataclasses.replace(reminder('one'), scheduled='2030-01-04T08:10')
        second = dataclasses.replace(reminder('two', waiting=True), scheduled='2030-01-04T17:25')
        snapshot = Snapshot(desired={'one': first, 'two': second}, seen={'one', 'two'})
        reconcile(snapshot, state, remote, now=NOW)
        identities = [r.event_uid for r in remote.items.values()]
        for uid, r in list(snapshot.desired.items()):
            snapshot.desired[uid] = dataclasses.replace(r, at=r.at + dt.timedelta(hours=1), scheduled='2030-01-04T16:30')
        for _ in range(5): reconcile(snapshot, state, remote, now=NOW)
        self.assertEqual([r.event_uid for r in remote.items.values()], identities)
        self.assertEqual(len(remote.calls), 4)
        for entry in state['tasks'].values():
            self.assertEqual(entry['scheduled'], '2030-01-04T16:30')
            self.assertEqual(entry['status'], 'synced')
        snapshot.desired.clear()
        reconcile(snapshot, state, remote, now=NOW)
        self.assertEqual(remote.items, {})
        self.assertEqual(state['tasks'], {})

    def test_markdown_receipt_contains_only_acknowledgements_and_does_not_churn_on_heartbeat(self):
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / 'calendar-status.json'
            state = {'enabled': True, 'connected': True, 'contract': CALENDAR_CONTRACT, 'binding': 'private-binding',
                     'updatedAt': NOW.isoformat(), 'errors': [], 'tasks': {'one': {
                         'file': 'Задачи/Call.md', 'title': 'Call', 'scheduled': '2030-01-04T00:00',
                         'status': 'synced', 'waiting': False, 'checkedAt': NOW.isoformat(), 'caldavUrl': 'private-account-url'}}}
            publish_status(p, state)
            md = p.with_suffix('.md')
            text, timestamp = md.read_text(), md.stat().st_mtime_ns
            receipt = json.loads(text.split('```json\n')[1].split('\n```')[0])
            self.assertEqual(receipt['schema'], 2)
            self.assertEqual(receipt['tasks']['one']['scheduled'], '2030-01-04T00:00')
            self.assertNotIn('private-account-url', text)
            self.assertNotIn('private-binding', text)
            state['updatedAt'] = (NOW + dt.timedelta(minutes=1)).isoformat()
            publish_status(p, state)
            self.assertEqual(md.stat().st_mtime_ns, timestamp)
            self.assertEqual(len(list(Path(folder).iterdir())), 1)

    def test_readback_requires_the_at_start_alarm_and_disabled_default(self):
        r = reminder()
        remote = object.__new__(ICloud)
        for fault in ['no-active', 'no-quiet', 'before-start', 'related-end', 'repeat']:
            ev = Calendar.from_ical(event_ical(r)).walk('VEVENT')[0]
            active = next(a for a in ev.walk('VALARM') if str(a['action']) == 'DISPLAY')
            quiet = next(a for a in ev.walk('VALARM') if str(a['action']) == 'NONE')
            if fault == 'no-active': ev.subcomponents.remove(active)
            elif fault == 'no-quiet': ev.subcomponents.remove(quiet)
            elif fault == 'before-start': active.pop('trigger'); active.add('trigger', -dt.timedelta(minutes=30))
            elif fault == 'related-end': active['trigger'].params['RELATED'] = 'END'
            elif fault == 'repeat': active.add('repeat', 2); active.add('duration', dt.timedelta(minutes=1))
            with patch.object(ICloud, 'existing', return_value={'event': ev}):
                self.assertFalse(remote.verify(r), fault)

    def test_an_old_missed_record_is_migrated_to_a_real_event(self):
        r, remote = reminder(at=NOW-dt.timedelta(hours=1)), MemoryCalendar()
        state = {'tasks': {'one': {'file': r.path, 'at': r.at.isoformat(), 'fingerprint': r.fingerprint, 'status': 'missed'}}}
        reconcile(Snapshot(desired={'one': r}, seen={'one'}), state, remote, now=NOW)
        self.assertEqual(state['tasks']['one']['status'], 'synced')
        self.assertEqual(len(remote.items), 1)


class HostFailureTests(unittest.TestCase):
    def test_connect_failure_is_visible_without_losing_last_acknowledgement(self):
        with tempfile.TemporaryDirectory() as folder:
            vault = Path(folder)
            (vault / 'Задачи').mkdir()
            binding = hashlib.sha256((str(vault.resolve()) + '\nFocus Tasks').encode()).hexdigest()
            state_path = vault / 'Internals/FocusTasks/calendar-status.json'
            previous = {'binding': binding, 'tasks': {'one': {'status': 'synced', 'checkedAt': NOW.isoformat()}}}
            save_state(state_path, previous)
            with patch('sys.argv', ['bridge', '--vault', str(vault), '--execute']), \
                 patch('apple_calendar.lease', return_value=contextlib.nullcontext()), \
                 patch('apple_calendar.connect', side_effect=ConnectionError('private account URL')):
                with self.assertRaises(ConnectionError):
                    main()
            state = json.loads(state_path.read_text())
            self.assertEqual(state['tasks'], previous['tasks'])
            self.assertEqual(state['errors'], ['ConnectionError'])
            self.assertTrue(state['enabled'])
            self.assertFalse(state['connected'])
            self.assertFalse(json.loads(state_path.with_suffix('.md').read_text().split('```json\n')[1].split('\n```')[0])['connected'])
            self.assertNotIn('private account URL', state_path.read_text())

    def test_preparing_disabled_job_stops_an_old_launchctl_override(self):
        from install_macos import main as install_main
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            interpreter, env = home / 'python', home / 'calendar.env'
            interpreter.touch(); env.write_text('CALDAV_PASSWORD=test-only-password-never-plist')
            argv = ['install', '--vault', str(home), '--python', str(interpreter), '--env-file', str(env), '--execute']
            with patch('sys.argv', argv), patch('install_macos.Path.home', return_value=home), \
                 patch('install_macos.subprocess.run') as call, contextlib.redirect_stdout(io.StringIO()):
                install_main()
            actions = [x.args[0][1] for x in call.call_args_list]
            self.assertEqual(actions, ['bootout', 'disable'])
            self.assertNotIn('bootstrap', actions)
            self.assertNotIn('test-only-password-never-plist', next((home / 'Library/LaunchAgents').glob('*.plist')).read_text())


class HttpClient:
    def __init__(self):
        self.raw, self.etag, self.race, self.drop_link = None, '"1"', False, False
        self.headers = []

    def request(self, url, method="GET", body="", headers=None):
        if method == "DELETE":
            self.headers.append(headers)
            if self.race:
                return SimpleNamespace(status=412)
            self.raw = None
            return SimpleNamespace(status=204)
        return SimpleNamespace(status=200 if self.raw else 404, raw=self.raw, headers={"ETag": self.etag})

    def put(self, url, body, headers=None):
        self.headers.append(headers)
        if self.race:
            return SimpleNamespace(status=412)
        self.raw = body
        if self.drop_link:
            cal = Calendar.from_ical(body)
            cal.walk("VEVENT")[0].pop('url')
            self.raw = cal.to_ical()
        return SimpleNamespace(status=201)


class OwnershipTests(unittest.TestCase):
    def setUp(self):
        self.client = HttpClient()
        self.transport = ICloud(SimpleNamespace(client=self.client, url=URL("https://example.invalid/test/")))
        self.r = reminder()

    def test_create_update_delete_use_conditional_requests(self):
        self.transport.upsert(self.r)
        self.assertEqual(self.client.headers[-1]["If-None-Match"], "*")
        self.transport.upsert(self.r)
        self.assertEqual(self.client.headers[-1]["If-Match"], '"1"')
        self.transport.delete(self.r)
        self.assertEqual(self.client.headers[-1]["If-Match"], '"1"')

    def test_half_hour_event_with_instructions_updates_once_in_place(self):
        snapshot = Snapshot(desired={self.r.uid: self.r}, seen={self.r.uid})
        state = {'tasks': {}}
        reconcile(snapshot, state, self.transport, now=NOW)
        with patch('apple_calendar.EVENT_DURATION_MINUTES', 30):
            old = Calendar.from_ical(event_ical(self.r))
            old_fingerprint = self.r.fingerprint
        old.walk('VEVENT')[0].add('description', 'Открыть задачу в Фокусе: old instructions')
        self.client.raw = old.to_ical()
        state['tasks'][self.r.uid]['fingerprint'] = old_fingerprint
        self.assertFalse(self.transport.verify(self.r))
        for seconds in (1, 2, 3):
            reconcile(snapshot, state, self.transport, now=NOW + dt.timedelta(seconds=seconds))
        self.assertEqual(len(self.client.headers), 2, 'one initial create and one migration')
        self.assertEqual(self.client.headers[-1]['If-Match'], '"1"')
        current = Calendar.from_ical(self.client.raw).walk('VEVENT')[0]
        self.assertEqual(str(current['uid']), self.r.event_uid)
        self.assertEqual(str(current[OWNER]), self.r.uid)
        self.assertEqual(current.decoded('dtend') - current.decoded('dtstart'), dt.timedelta(hours=1))
        self.assertNotIn('description', current)
        self.assertTrue(self.transport.verify(self.r))

    def test_retained_event_instructions_are_not_acknowledged(self):
        event = Calendar.from_ical(event_ical(self.r))
        event.walk('VEVENT')[0].add('description', 'stale event instructions')
        self.client.raw = event.to_ical()
        self.assertFalse(self.transport.verify(self.r))

    def test_foreign_event_never_overwritten_or_deleted(self):
        self.client.raw = event_ical(reminder(uid="someone-else"))
        for fn in (self.transport.upsert, self.transport.delete):
            with self.assertRaises(OwnershipConflict):
                fn(self.r)
        self.assertEqual(self.client.headers, [])

    def test_create_race_refused(self):
        self.client.race = True
        with self.assertRaises(OwnershipConflict):
            self.transport.upsert(self.r)

    def test_update_and_delete_race_refused(self):
        self.client.raw = event_ical(self.r)
        self.client.race = True
        for fn in (self.transport.upsert, self.transport.delete):
            with self.assertRaises(OwnershipConflict):
                fn(self.r)

    def test_missing_link_readback_is_not_success(self):
        self.client.drop_link = True
        with self.assertRaises(RuntimeError):
            self.transport.upsert(self.r)


if __name__ == "__main__":
    unittest.main()
