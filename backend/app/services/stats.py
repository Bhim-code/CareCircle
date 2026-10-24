"""Numbers for the admin overview and patient pages, always counted from the database."""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import utcnow
from app.db.models import Reminder


def missed_after() -> timedelta:
    return timedelta(minutes=get_settings().missed_dose_after_minutes)


def reminder_status(scheduled_at: datetime, acknowledged_at: datetime | None,
                    now: datetime | None = None) -> str:
    """Same rule as the app: due for 60 minutes from the scheduled time, then missed."""
    now = now or utcnow()
    if acknowledged_at is not None:
        return "taken"
    if now < scheduled_at:
        return "upcoming"
    if now < scheduled_at + missed_after():
        return "due"
    return "missed"


def reminder_counts(db: Session, start: datetime, end: datetime,
                    patient_id: uuid.UUID | None = None) -> dict[str, int]:
    now = utcnow()
    taken = Reminder.acknowledged_at.is_not(None)
    open_ = Reminder.acknowledged_at.is_(None)
    query = select(
        func.count(),
        func.count().filter(taken),
        func.count().filter(and_(open_, Reminder.scheduled_at + missed_after() <= now)),
        func.count().filter(and_(open_, Reminder.scheduled_at <= now,
                                 Reminder.scheduled_at + missed_after() > now)),
        func.count().filter(and_(open_, Reminder.scheduled_at > now)),
    ).where(Reminder.scheduled_at >= start, Reminder.scheduled_at < end)
    if patient_id:
        query = query.where(Reminder.patient_id == patient_id)
    total, taken_n, missed, due, upcoming = db.execute(query).one()
    return {"total": total, "taken": taken_n, "missed": missed, "due": due, "upcoming": upcoming}


def adherence(db: Session, days: int = 7, patient_id: uuid.UUID | None = None) -> float | None:
    """Confirmed doses / doses whose confirmation window has closed, over the last N days."""
    now = utcnow()
    closed = Reminder.scheduled_at + missed_after() <= now
    query = select(
        func.count(),
        func.sum(case((Reminder.acknowledged_at.is_not(None), 1), else_=0)),
    ).where(Reminder.scheduled_at >= now - timedelta(days=days), closed)
    if patient_id:
        query = query.where(Reminder.patient_id == patient_id)
    total, taken = db.execute(query).one()
    return round((taken or 0) / total, 3) if total else None
