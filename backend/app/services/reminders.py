"""Turning medicines into reminder rows.

A medicine says "08:00 and 20:00 every day from 1 Oct" in the patient's own time
zone. A reminder is one of those doses as an exact UTC moment. Rows are created
idempotently (the database ignores duplicates), so the job can run as often as
we like and the API can also fill in a day on demand.

Reminders are never created for a moment before the medicine was added, so
adding a medicine at 3 pm never produces a "missed" 8 am dose or a false alert.
"""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.db.models import Medicine, Reminder, User


def local_day_bounds(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """The UTC start and end of one calendar day in a time zone (23 or 25 hours across DST)."""
    start = datetime.combine(day, time.min, tzinfo=tz)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)
    return start.astimezone(UTC), end.astimezone(UTC)


def local_today(tz: ZoneInfo) -> date:
    return utcnow().astimezone(tz).date()


def _moments(medicine: Medicine, day: date, tz: ZoneInfo) -> list[datetime]:
    if day < medicine.start_date or (medicine.end_date and day > medicine.end_date):
        return []
    moments = []
    for hhmm in medicine.times:
        hour, minute = (int(part) for part in hhmm.split(":"))
        local = datetime.combine(day, time(hour, minute), tzinfo=tz)
        moments.append(local.astimezone(UTC))
    return moments


def generate_for_patient(db: Session, patient: User, days: list[date],
                         medicine_id: uuid.UUID | None = None) -> int:
    """Create missing reminder rows for these local days. Returns how many were new."""
    tz = ZoneInfo(patient.timezone)
    query = select(Medicine).where(Medicine.patient_id == patient.id)
    if medicine_id:
        query = query.where(Medicine.id == medicine_id)
    rows = []
    for medicine in db.scalars(query):
        for day in days:
            for moment in _moments(medicine, day, tz):
                if moment >= medicine.created_at:
                    rows.append({"patient_id": patient.id, "medicine_id": medicine.id,
                                 "scheduled_at": moment})
    if not rows:
        return 0
    result = db.execute(insert(Reminder).values(rows).on_conflict_do_nothing(
        constraint="reminders_once_per_time").returning(Reminder.id))
    return len(result.all())


def generate_upcoming(db: Session, now: datetime | None = None) -> int:
    """The job: for every active patient, make sure today and tomorrow (their time) exist."""
    now = now or utcnow()
    created = 0
    patients = db.scalars(select(User).where(
        User.role == "patient", User.is_active.is_(True),
        User.id.in_(select(Medicine.patient_id).where(
            or_(Medicine.end_date.is_(None), Medicine.end_date >= (now - timedelta(days=1)).date())))))
    for patient in patients:
        today = now.astimezone(ZoneInfo(patient.timezone)).date()
        created += generate_for_patient(db, patient, [today, today + timedelta(days=1)])
    db.commit()
    return created
