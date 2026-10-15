"""Issue 5: medicines and reminders. Patients only, and only their own."""

import uuid
from datetime import date, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, patient_only
from app.core.errors import ApiError
from app.core.security import utcnow
from app.db.models import Medicine, Reminder
from app.db.session import get_db
from app.schemas.medicines import MedicineIn, MedicineOut, ReminderOut
from app.services.reminders import generate_for_patient, local_day_bounds, local_today

router = APIRouter(tags=["medicines and reminders"])

# How far ahead GET /reminders will fill in a day on demand.
_MAX_DAYS_AHEAD = 14
# A dose can be confirmed from this long before its time.
_EARLY_CONFIRM = timedelta(minutes=60)


@router.get("/medicines", response_model=list[MedicineOut])
def list_medicines(me: CurrentUser = Depends(patient_only),
                   db: Session = Depends(get_db)) -> list[Medicine]:
    return list(db.scalars(select(Medicine).where(Medicine.patient_id == me.id)
                           .order_by(Medicine.created_at)))


@router.post("/medicines", response_model=MedicineOut, status_code=201)
def add_medicine(body: MedicineIn, me: CurrentUser = Depends(patient_only),
                 db: Session = Depends(get_db)) -> Medicine:
    """Adds the medicine and creates today's and tomorrow's reminders straight away."""
    medicine = Medicine(patient_id=me.id, name=body.name, times=body.times,
                        start_date=body.start_date, end_date=body.end_date)
    db.add(medicine)
    db.flush()
    db.refresh(medicine)  # load created_at from the database
    today = local_today(ZoneInfo(me.user.timezone))
    generate_for_patient(db, me.user, [today, today + timedelta(days=1)], medicine.id)
    db.commit()
    return medicine


@router.delete("/medicines/{medicine_id}", status_code=204)
def stop_medicine(medicine_id: uuid.UUID, me: CurrentUser = Depends(patient_only),
                  db: Session = Depends(get_db)) -> Response:
    """Addition to the contract: stop a medicine. Past reminders stay as history;
    future unconfirmed ones are removed."""
    medicine = db.scalar(select(Medicine).where(Medicine.id == medicine_id,
                                                Medicine.patient_id == me.id))
    if medicine is None:
        raise ApiError(404)
    today = local_today(ZoneInfo(me.user.timezone))
    if medicine.start_date >= today:
        db.delete(medicine)  # never started: remove it and its reminders entirely
    else:
        medicine.end_date = today - timedelta(days=1)  # no new reminders from today on
        db.execute(delete(Reminder).where(Reminder.medicine_id == medicine.id,
                                          Reminder.scheduled_at > utcnow(),
                                          Reminder.acknowledged_at.is_(None)))
    db.commit()
    return Response(status_code=204)


@router.get("/reminders", response_model=list[ReminderOut])
def reminders_for_day(
    day: date,
    timezone: Annotated[str | None, Query(max_length=64, description=(
        "Optional: the phone's time zone, e.g. America/St_Johns. Defaults to the account's."))] = None,
    me: CurrentUser = Depends(patient_only),
    db: Session = Depends(get_db),
) -> list[ReminderOut]:
    """The signed-in patient's reminders for one local day, earliest first."""
    try:
        tz = ZoneInfo(timezone or me.user.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise ApiError(422, fields={"timezone": "Unknown time zone."}) from None

    if day <= local_today(tz) + timedelta(days=_MAX_DAYS_AHEAD):
        if generate_for_patient(db, me.user, [day - timedelta(days=1), day, day + timedelta(days=1)]):
            db.commit()

    start, end = local_day_bounds(day, tz)
    rows = db.execute(
        select(Reminder, Medicine.name)
        .join(Medicine, Medicine.id == Reminder.medicine_id)
        .where(Reminder.patient_id == me.id, Reminder.scheduled_at >= start, Reminder.scheduled_at < end)
        .order_by(Reminder.scheduled_at, Medicine.name)
    )
    return [ReminderOut(id=r.id, medicine_name=name, scheduled_at=r.scheduled_at,
                        acknowledged=r.acknowledged_at is not None) for r, name in rows]


@router.post("/reminders/{reminder_id}/acknowledge", status_code=204)
def acknowledge(reminder_id: uuid.UUID, me: CurrentUser = Depends(patient_only),
                db: Session = Depends(get_db)) -> Response:
    """"I took it". Only the patient can do this, never the server. 404 if not theirs.

    Pressing it again is harmless: the first time is kept.
    """
    reminder = db.scalar(select(Reminder).where(Reminder.id == reminder_id,
                                                Reminder.patient_id == me.id).with_for_update())
    if reminder is None:
        raise ApiError(404)
    now = utcnow()
    if reminder.scheduled_at - now > _EARLY_CONFIRM:
        raise ApiError(422, "This dose is not due yet.", code="not_due",
                       fields={"scheduledAt": "You can confirm up to 60 minutes early."})
    if reminder.acknowledged_at is None:
        reminder.acknowledged_at = now
        db.commit()
    return Response(status_code=204)
