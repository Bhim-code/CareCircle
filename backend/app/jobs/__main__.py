"""Run the background jobs.

    python -m app.jobs              # keep running: the normal way (a second terminal or service)
    python -m app.jobs once alerts  # run one job now: reminders | alerts | due | cleanup

Schedule while running:
    every minute     due-dose push notifications, missed-dose alerts
    every 30 minutes create today's and tomorrow's reminders
    every day        cleanup
"""

import argparse
import logging
import signal
import sys
import time

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_engine
from app.jobs import tasks

logger = logging.getLogger("carecircle.jobs")

JOBS = {
    "reminders": (tasks.generate_reminders, 30 * 60),
    "due": (tasks.send_due_notifications, 60),
    "alerts": (tasks.send_missed_dose_alerts, 60),
    "cleanup": (tasks.cleanup, 24 * 60 * 60),
}


def run_once(name: str) -> int:
    job, _ = JOBS[name]
    with Session(get_engine()) as db:
        return job(db)


def run_forever() -> None:
    stopping = False

    def stop(*_: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    last_run = {name: 0.0 for name in JOBS}
    logger.info("Background jobs started. Press Ctrl+C to stop.")
    while not stopping:
        for name, (_, every) in JOBS.items():
            if time.monotonic() - last_run[name] >= every:
                try:
                    result = run_once(name)
                    logger.info("job %s done (%s)", name, result)
                except Exception as exc:  # noqa: BLE001 - keep the loop alive
                    logger.error("job %s failed: %s", name, type(exc).__name__)
                last_run[name] = time.monotonic()
        for _ in range(10):
            if stopping:
                break
            time.sleep(1)
    logger.info("Background jobs stopped.")


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=get_settings().log_level, format="%(asctime)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(prog="python -m app.jobs")
    sub = parser.add_subparsers(dest="command")
    once = sub.add_parser("once", help="Run one job now")
    once.add_argument("job", choices=sorted(JOBS))
    args = parser.parse_args(argv)
    if args.command == "once":
        print(f"{args.job}: {run_once(args.job)}")
    else:
        run_forever()


if __name__ == "__main__":
    main(sys.argv[1:])
