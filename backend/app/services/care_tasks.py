"""Daily care tasks: which task falls on which day, and how it went.

Everything is worked out in the CLIENT's time zone:
- A task is on a day if the day is within its dates, on one of its weekdays, and the
  task existed then: it counts only from the moment it was added and until the moment
  it was removed or rescheduled. So adding a 09:00 task at 15:00 never makes today's
  09:00 "missed". An "any time" task counts on a day if it was added before the day
  ended and not removed during it. A task already marked on a day always shows that day.
- Status of a task on a day:
    done      marked done before its deadline
    late      marked done after its deadline
    skipped   marked "not done" with a reason (patient refused, in hospital, ...)
    missed    not marked, and its deadline has passed
    due       its time has come, the deadline has not passed
    upcoming  later today, or a future day
  Deadline = its time + grace minutes (default 60); for "any time" tasks, the end of the day.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.security import utcnow
from app.db.models import CareTask, TaskCompletion, User
from app.services.reminders import local_day_bounds

# How far back a completion may be recorded (late paperwork is fine, rewriting history isn't).
RECORD_WINDOW_DAYS = 7
UNDO_WINDOW = timedelta(hours=24)


def due_at(task: CareTask, day: date, tz: ZoneInfo) -> datetime | None:
    if task.time_of_day is None:
        return None
    return datetime.combine(day, task.time_of_day, tzinfo=tz)


def deadline(task: CareTask, day: date, tz: ZoneInfo) -> datetime:
    due = due_at(task, day, tz)
    if due is None:
        return local_day_bounds(day, tz)[1]
    return due + timedelta(minutes=task.grace_minutes)


def scheduled_on(task: CareTask, day: date, tz: ZoneInfo) -> bool:
    if day < task.start_date or (task.end_date and day > task.end_date):
        return False
    if day.isoweekday() not in task.days:
        return False
    start, end = local_day_bounds(day, tz)
    moment = due_at(task, day, tz)
    if moment is None:  # any time that day: added before the day ended, not removed during it
        return task.created_at < end and (task.ended_at is None or task.ended_at >= end)
    return task.created_at <= moment and (task.ended_at is None or task.ended_at > moment)


def status_of(task: CareTask, day: date, tz: ZoneInfo, completion: TaskCompletion | None,
              now: datetime) -> str:
    if completion is not None:
        if completion.status == "skipped":
            return "skipped"
        return "late" if completion.done_at > deadline(task, day, tz) else "done"
    if now >= deadline(task, day, tz):
        return "missed"
    due = due_at(task, day, tz)
    if due is not None and now >= due:
        return "due"
    return "upcoming"


@dataclass
class Occurrence:
    task: CareTask
    day: date
    status: str
    due: datetime | None
    completion: TaskCompletion | None


@dataclass
class PatientDay:
    patient: User
    day: date
    occurrences: list[Occurrence]
    extras: list[TaskCompletion]


def day_for(db: Session, patients: list[User], day: date, now: datetime | None = None) -> list[PatientDay]:
    """Each patient's planned tasks for that (local) day with their status, plus extra work."""
    now = now or utcnow()
    if not patients:
        return []
    ids = [p.id for p in patients]
    tasks = db.scalars(select(CareTask).where(
        CareTask.patient_id.in_(ids), CareTask.start_date <= day,
        or_(CareTask.end_date.is_(None), CareTask.end_date >= day))).all()
    completions = db.scalars(select(TaskCompletion).where(
        TaskCompletion.patient_id.in_(ids), TaskCompletion.day == day)).all()
    by_task = {c.task_id: c for c in completions if c.task_id}
    out = []
    for patient in patients:
        tz = ZoneInfo(patient.timezone)
        # Planned that day, or already marked that day (a mark stays visible even if the
        # task was removed or rescheduled afterwards).
        occurrences = [
            Occurrence(t, day, status_of(t, day, tz, by_task.get(t.id), now), due_at(t, day, tz), by_task.get(t.id))
            for t in tasks if t.patient_id == patient.id and (scheduled_on(t, day, tz) or t.id in by_task)
        ]
        occurrences.sort(key=lambda o: (o.task.time_of_day is None, o.task.time_of_day or time.min, o.task.title))
        extras = sorted((c for c in completions if c.task_id is None and c.patient_id == patient.id),
                        key=lambda c: c.done_at)
        out.append(PatientDay(patient, day, occurrences, extras))
    return out


def local_today(patient: User, now: datetime | None = None) -> date:
    return (now or utcnow()).astimezone(ZoneInfo(patient.timezone)).date()


def check_day_can_be_recorded(patient: User, day: date, now: datetime | None = None) -> None:
    today = local_today(patient, now)
    if day > today:
        raise ApiError(422, "You cannot record a future day.", fields={"day": "Not in the future."})
    if day < today - timedelta(days=RECORD_WINDOW_DAYS):
        raise ApiError(422, f"Only the last {RECORD_WINDOW_DAYS} days can be recorded.",
                       fields={"day": f"Within {RECORD_WINDOW_DAYS} days."})


def complete(db: Session, actor: User, task: CareTask, patient: User, day: date, status: str,
             reason: str | None, note: str | None) -> TaskCompletion:
    check_day_can_be_recorded(patient, day)
    if not scheduled_on(task, day, ZoneInfo(patient.timezone)):
        raise ApiError(422, "This task is not planned for that day.", fields={"day": "Not planned that day."})
    if status == "skipped" and not (reason or "").strip():
        raise ApiError(422, "Say why it was not done.", fields={"reason": "A reason is required."})
    if db.scalar(select(TaskCompletion.id).where(TaskCompletion.task_id == task.id, TaskCompletion.day == day)):
        raise ApiError(409, "This task is already marked for that day.", code="already_marked")
    completion = TaskCompletion(patient_id=patient.id, task_id=task.id, day=day, status=status,
                                reason=(reason or "").strip() or None if status == "skipped" else None,
                                note=note, done_by=actor.id, done_at=utcnow())
    db.add(completion)
    return completion


def undo(db: Session, actor: User, task_id: uuid.UUID, day: date) -> None:
    completion = db.scalar(select(TaskCompletion).where(TaskCompletion.task_id == task_id,
                                                        TaskCompletion.day == day))
    if completion is None:
        raise ApiError(404)
    if completion.done_by != actor.id:
        raise ApiError(403, "Only the person who marked it can undo it.")
    if utcnow() - completion.done_at > UNDO_WINDOW:
        raise ApiError(422, "It can only be undone within 24 hours.", code="too_late")
    db.delete(completion)
