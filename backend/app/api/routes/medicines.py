"""Issue 5: medicines and reminders. Patients only, and only their own."""

import uuid
from datetime import date, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, patient_only, patient_or_caregiver
from app.core.errors import ApiError
from app.core.security import utcnow
from app.db.models import Medicine, Reminder, User
from app.db.session import get_db
from app.schemas.medicines import MedicineIn, MedicineOut, ReminderOut
from app.services import access
from app.services.reminders import generate_for_patient, local_day_bounds, local_today
from app.services.stats import reminder_status

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
    """Addition to the contract: stop a medicine from now on. Past and confirmed
    doses stay as history; future unconfirmed ones are removed. Stopping twice is harmless."""
    medicine = db.scalar(select(Medicine).where(Medicine.id == medicine_id,
                                                Medicine.patient_id == me.id).with_for_update())
    if medicine is None:
        raise ApiError(404)
    now = utcnow()
    if medicine.stopped_at is None:
        medicine.stopped_at = now
    db.execute(delete(Reminder).where(Reminder.medicine_id == medicine.id,
                                      Reminder.scheduled_at > now,
                                      Reminder.acknowledged_at.is_(None),
                                      Reminder.skipped_at.is_(None)))
    db.commit()
    return Response(status_code=204)


@router.get("/reminders", response_model=list[ReminderOut])
def reminders_for_day(
    day: date,
    timezone: Annotated[str | None, Query(max_length=64, description=(
        "Optional: the phone's time zone, e.g. America/St_Johns. Defaults to the patient's."))] = None,
    patient_id: Annotated[uuid.UUID | None, Query(alias="patientId", description=(
        "Caregivers: one linked patient. Left out: every linked patient."))] = None,
    me: CurrentUser = Depends(patient_or_caregiver),
    db: Session = Depends(get_db),
) -> list[ReminderOut]:
    """A patient's reminders for one local day, earliest first. A patient gets their own;
    a caregiver gets their linked patients' (all, or one with ?patientId=)."""
    if timezone is not None:
        try:
            ZoneInfo(timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise ApiError(422, fields={"timezone": "Unknown time zone."}) from None

    readable = access.readable_patient_ids(db, me.user)
    if patient_id is not None:
        if patient_id not in readable:
            raise ApiError(404)
        readable = [patient_id]
    patients = list(db.scalars(select(User).where(User.id.in_(readable)))) if readable else []

    out: list[ReminderOut] = []
    now = utcnow()
    for patient in patients:
        tz = ZoneInfo(timezone or patient.timezone)
        if day <= local_today(tz) + timedelta(days=_MAX_DAYS_AHEAD):
            if generate_for_patient(db, patient, [day - timedelta(days=1), day, day + timedelta(days=1)]):
                db.flush()
        start, end = local_day_bounds(day, tz)
        rows = db.execute(
            select(Reminder, Medicine.name)
            .join(Medicine, Medicine.id == Reminder.medicine_id)
            .where(Reminder.patient_id == patient.id, Reminder.scheduled_at >= start,
                   Reminder.scheduled_at < end)
        )
        out += [ReminderOut(id=r.id, medicine_name=name, scheduled_at=r.scheduled_at,
                            acknowledged=r.acknowledged_at is not None, skipped=r.skipped_at is not None,
                            status=reminder_status(r.scheduled_at, r.acknowledged_at, now, r.skipped_at),
                            patient_id=patient.id, patient_name=patient.name) for r, name in rows]
        if me.role == "caregiver":
            access.log_access(db, me.user, patient.id, "reminders.list")
    db.commit()
    out.sort(key=lambda r: (r.scheduled_at, r.patient_name, r.medicine_name))
    return out


def _own_reminder(db: Session, me: CurrentUser, reminder_id: uuid.UUID) -> Reminder:
    reminder = db.scalar(select(Reminder).where(Reminder.id == reminder_id,
                                                Reminder.patient_id == me.id).with_for_update())
    if reminder is None:
        raise ApiError(404)
    if reminder.scheduled_at - utcnow() > _EARLY_CONFIRM:
        raise ApiError(422, "This dose is not due yet.", code="not_due",
                       fields={"scheduledAt": "You can confirm or skip up to 60 minutes early."})
    return reminder


@router.post("/reminders/{reminder_id}/acknowledge", status_code=204)
def acknowledge(reminder_id: uuid.UUID, me: CurrentUser = Depends(patient_only),
                db: Session = Depends(get_db)) -> Response:
    """"I took it". Only the patient can do this, never the server. 404 if not theirs.

    Pressing it again is harmless: the first time is kept. Taking a dose that was skipped
    is allowed (the patient changed their mind) and clears the skip.
    """
    reminder = _own_reminder(db, me, reminder_id)
    if reminder.acknowledged_at is None:
        reminder.acknowledged_at = utcnow()
        reminder.skipped_at = None
        db.commit()
    return Response(status_code=204)


@router.post("/reminders/{reminder_id}/skip", status_code=204)
def skip(reminder_id: uuid.UUID, me: CurrentUser = Depends(patient_only),
         db: Session = Depends(get_db)) -> Response:
    """"Skip" on the alarm: the patient chose not to take this dose. Only the patient can do
    this. Skipped doses are never reported as missed and send no missed-dose alert.

    Skipping again is harmless (the first time is kept). A dose already taken cannot be
    skipped (409 already_taken).
    """
    reminder = _own_reminder(db, me, reminder_id)
    if reminder.acknowledged_at is not None:
        raise ApiError(409, "This dose is already marked as taken.", code="already_taken")
    if reminder.skipped_at is None:
        reminder.skipped_at = utcnow()
        db.commit()
    return Response(status_code=204)
