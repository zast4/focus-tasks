"""Prepare/enable a single Mac-host calendar bridge. Dry-run unless --execute.

No credentials go into the plist or vault. --execute without --enable prepares a
disabled job. It does not start now or at the next login.
"""
import argparse
import hashlib
import json
import os
import plistlib
import subprocess
from pathlib import Path


def job(vault, interpreter, calendar, env_file, enabled=False, interval=60):
    label = "com.focus-tasks.calendar." + hashlib.sha256(str(vault.resolve()).encode()).hexdigest()[:12]
    bridge = Path(__file__).with_name("apple_calendar.py").resolve()
    log = Path.home() / "Library/Logs/focus-tasks-calendar.log"
    # Resolving a venv's Python symlink selects the base interpreter and loses
    # its site-packages. launchd must use the original executable path.
    args = [str(interpreter.absolute()), str(bridge), "--vault", str(vault.resolve()), "--calendar", calendar, "--env-file", str(env_file.resolve()), "--execute"]
    return {"Label": label, "ProgramArguments": args, "StartInterval": interval,
        "RunAtLoad": True, "Disabled": not enabled, "StandardOutPath": str(log),
        "StandardErrorPath": str(log), "ProcessType": "Background", "LowPriorityIO": True,
        "EnvironmentVariables": {"PYTHONUNBUFFERED": "1"}}, label


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--vault", type=Path, required=True)
    p.add_argument("--python", type=Path, required=True)
    p.add_argument("--env-file", type=Path, required=True)
    p.add_argument("--calendar", default="Focus Tasks")
    p.add_argument("--create-calendar", action="store_true")
    p.add_argument("--execute", action="store_true")
    p.add_argument("--enable", action="store_true")
    args = p.parse_args()
    if not args.python.is_file() or not args.env_file.is_file() or not args.vault.is_dir():
        raise ValueError("required local paths missing")
    data, label = job(args.vault, args.python, args.calendar, args.env_file, args.enable)
    target = Path.home() / "Library/LaunchAgents" / (label + ".plist")
    if args.execute:
        if args.enable:
            from apple_calendar import connect
            try:
                connect(args.calendar, args.env_file)
            except RuntimeError:
                if not args.create_calendar:
                    raise
                # Only create if absence is verified. Ambiguous calendars are never guessed.
                import caldav
                client=caldav.DAVClient(url="https://caldav.icloud.com/", username=os.environ["CALDAV_USERNAME"], password=os.environ["CALDAV_PASSWORD"], timeout=30)
                principal=client.principal()
                if any(c.get_display_name()==args.calendar for c in principal.calendars()):
                    raise RuntimeError("calendar name ambiguous")
                principal.make_calendar(name=args.calendar)
                connect(args.calendar,args.env_file)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(plistlib.dumps(data))
        (Path.home()/"Library/Logs").mkdir(parents=True, exist_ok=True)
        domain="gui/"+str(os.getuid())
        subprocess.run(["launchctl","bootout",domain+"/"+label],capture_output=True)
        if args.enable:
            subprocess.run(["launchctl","enable",domain+"/"+label],check=True,capture_output=True)
            subprocess.run(["launchctl","bootstrap",domain,str(target)],check=True,capture_output=True)
        else:
            # A launchctl override can keep an older job running despite Disabled in
            # its new plist. Preparing a disabled job must actually leave it stopped.
            subprocess.run(["launchctl","disable",domain+"/"+label],check=True,capture_output=True)
    print(json.dumps({"execute":args.execute,"enabled":bool(args.execute and args.enable),"label":label,"intervalSeconds":data["StartInterval"]}))


if __name__=="__main__":
    try: main()
    except Exception as exc:
        print(json.dumps({"error":type(exc).__name__}))
        raise SystemExit(1)
