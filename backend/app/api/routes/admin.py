"""Issue 11: endpoints for the admin panel.

- Supervisor: read everything, change nothing.
- Admin: read everything, and turn accounts on or off.
- Every look at one patient's data writes a line to the access log
  (who, which patient, what, when). Refused attempts are logged too.
"""

import csv
import io
import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from app.api.deps import CurrentUser, current_user
from app.core.errors import ApiError
from app.db.models import (
    AccessLog,
    CareLink,
    EntryPhoto,
    HealthDocument,
    Medicine,
    RecordEntry,
    Reminder,
    User,
)
from app.db.session import get_db
from app.schemas.admin import (
    AccessLogOut,
    AdminDocumentOut,
    AdminMedicineOut,
    AdminReminderOut,
    AdminUserOut,
    OverviewOut,
    Page,
    PatientDetailOut,
    RemindersToday,
    UserUpdateIn,
)
from app.schemas.common import PersonOut, PersonWithEmailOut
from app.schemas.entries import EntryOut, Kind
from app.services import access, photos, stats
from app.services.auth import end_all_sessions
from app.services.reminders import local_day_bounds

router = APIRouter(prefix="/admin", tags=["admin panel"])

PageNo = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=200, alias="pageSize")]


def staff(me: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> CurrentUser:
    """Admin or supervisor. Anyone else signed in is refused, and the attempt is logged."""
    if me.role not in ("admin", "supervisor"):
        access.log_access(db, me.user, None, "admin.denied", outcome="denied")
        db.commit()
        raise ApiError(403)
    return me


def admin(me: CurrentUser = Depends(staff), db: Session = Depends(get_db)) -> CurrentUser:
    """Changes are for admins only. Supervisors are read only."""
    if me.role != "admin":
        access.log_access(db, me.user, None, "admin.change.denied", outcome="denied")
        db.commit()
        raise ApiError(403, "Supervisors have read-only access.")
    return me


def _zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        raise ApiError(422, fields={"timezone": "Unknown time zone."}) from None


def _patient(db: Session, patient_id: uuid.UUID, me: CurrentUser, action: str) -> User:
    patient = db.get(User, patient_id)
    if patient is None or patient.role != "patient":
        raise ApiError(404)
    access.log_access(db, me.user, patient.id, action)
    db.commit()
    return patient


def _day_range(start: date | None, end: date | None) -> tuple[datetime | None, datetime | None]:
    lo = datetime.combine(start, time.min, tzinfo=UTC) if start else None
    hi = datetime.combine(end + timedelta(days=1), time.min, tzinfo=UTC) if end else None
    return lo, hi


# --- overview and people -----------------------------------------------------

@router.get("/overview", response_model=OverviewOut)
def overview(timezone: Annotated[str | None, Query(max_length=64)] = None,
             me: CurrentUser = Depends(staff), db: Session = Depends(get_db)) -> OverviewOut:
    """Totals only, no one's details, so this is not written to the access log."""
    tz = _zone(timezone)
    start, end = local_day_bounds(datetime.now(tz).date(), tz)
    counts = dict(db.execute(select(User.role, func.count()).where(User.is_active.is_(True))
                             .group_by(User.role)).all())
    week_ago = datetime.now(UTC) - timedelta(days=7)
    return OverviewOut(
        patients=counts.get("patient", 0),
        caregivers=counts.get("caregiver", 0),
        active_links=db.scalar(select(func.count()).where(CareLink.status == "active")) or 0,
        reminders_today=RemindersToday(**stats.reminder_counts(db, start, end)),
        adherence_last_7_days=stats.adherence(db, 7),
        entries_last_7_days=db.scalar(select(func.count()).where(RecordEntry.recorded_at >= week_ago)) or 0,
    )


@router.get("/users", response_model=Page[AdminUserOut])
def list_users(role: str | None = None, q: Annotated[str | None, Query(max_length=100)] = None,
               active: bool | None = None, page: PageNo = 1, page_size: PageSize = 25,
               me: CurrentUser = Depends(staff), db: Session = Depends(get_db)) -> Page[AdminUserOut]:
    """Search by name or email. Filter by role and active state."""
    query = select(User)
    if role:
        query = query.where(User.role == role)
    if active is not None:
        query = query.where(User.is_active.is_(active))
    if q:
        pattern = "%" + q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.where(or_(func.lower(User.name).like(pattern, escape="\\"),
                                User.email.like(pattern, escape="\\")))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(query.order_by(User.name, User.email).offset((page - 1) * page_size).limit(page_size))
    access.log_access(db, me.user, None, "users.list")
    db.commit()
    return Page(items=[AdminUserOut.model_validate(u) for u in rows], total=total, page=page,
                page_size=page_size)


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(user_id: uuid.UUID, body: UserUpdateIn, me: CurrentUser = Depends(admin),
                db: Session = Depends(get_db)) -> AdminUserOut:
    """Admin only: turn an account off (signs it out everywhere at once) or back on."""
    user = db.get(User, user_id)
    if user is None:
        raise ApiError(404)
    if user.id == me.id and not body.is_active:
        raise ApiError(422, "You cannot turn off your own account.", fields={"isActive": "Not for yourself."})
    user.is_active = body.is_active
    if not body.is_active:
        end_all_sessions(db, user.id)
    access.log_access(db, me.user, user.id, "user.activate" if body.is_active else "user.deactivate")
    db.commit()
    return AdminUserOut.model_validate(user)


# --- one patient -------------------------------------------------------------

@router.get("/patients/{patient_id}", response_model=PatientDetailOut)
def patient_detail(patient_id: uuid.UUID, me: CurrentUser = Depends(staff),
                   db: Session = Depends(get_db)) -> PatientDetailOut:
    patient = _patient(db, patient_id, me, "patient.view")
    caregivers = db.scalars(select(User).join(CareLink, CareLink.caregiver_id == User.id).where(
        CareLink.patient_id == patient.id, CareLink.status == "active").order_by(User.name))
    medicines = db.scalars(select(Medicine).where(Medicine.patient_id == patient.id)
                           .order_by(Medicine.created_at))
    return PatientDetailOut(
        patient=AdminUserOut.model_validate(patient),
        caregivers=[PersonWithEmailOut.model_validate(c) for c in caregivers],
        medicines=[AdminMedicineOut.model_validate(m) for m in medicines],
        adherence_last_7_days=stats.adherence(db, 7, patient.id),
        entries_total=db.scalar(select(func.count()).where(RecordEntry.patient_id == patient.id)) or 0,
        documents_total=db.scalar(select(func.count()).where(HealthDocument.patient_id == patient.id)) or 0,
    )


def _reminder_rows(db: Session, patient_id: uuid.UUID, start: date | None, end: date | None):
    lo, hi = _day_range(start, end)
    query = (select(Reminder, Medicine.name).join(Medicine, Medicine.id == Reminder.medicine_id)
             .where(Reminder.patient_id == patient_id).order_by(Reminder.scheduled_at.desc()))
    if lo:
        query = query.where(Reminder.scheduled_at >= lo)
    if hi:
        query = query.where(Reminder.scheduled_at < hi)
    return [AdminReminderOut(id=r.id, medicine_name=name, scheduled_at=r.scheduled_at,
                             acknowledged_at=r.acknowledged_at,
                             status=stats.reminder_status(r.scheduled_at, r.acknowledged_at))
            for r, name in db.execute(query.limit(2000))]


@router.get("/patients/{patient_id}/reminders", response_model=list[AdminReminderOut])
def patient_reminders(patient_id: uuid.UUID,
                      from_date: Annotated[date | None, Query(alias="from")] = None,
                      to_date: Annotated[date | None, Query(alias="to")] = None,
                      me: CurrentUser = Depends(staff), db: Session = Depends(get_db)):
    """Newest first, at most 2000. Dates are UTC days."""
    _patient(db, patient_id, me, "reminders.view")
    return _reminder_rows(db, patient_id, from_date, to_date)


@router.get("/patients/{patient_id}/documents", response_model=list[AdminDocumentOut])
def patient_documents(patient_id: uuid.UUID, me: CurrentUser = Depends(staff),
                      db: Session = Depends(get_db)):
    _patient(db, patient_id, me, "documents.view")
    return list(db.scalars(select(HealthDocument).where(HealthDocument.patient_id == patient_id)
                           .order_by(HealthDocument.recorded_on.desc().nulls_last())))


def _entry_rows(db: Session, patient_id: uuid.UUID, kind: str | None, start: date | None,
                end: date | None) -> list[EntryOut]:
    author, editor = aliased(User), aliased(User)
    lo, hi = _day_range(start, end)
    query = (select(RecordEntry, author, editor, EntryPhoto)
             .join(author, author.id == RecordEntry.recorded_by)
             .outerjoin(editor, editor.id == RecordEntry.edited_by)
             .outerjoin(EntryPhoto, EntryPhoto.entry_id == RecordEntry.id)
             .where(RecordEntry.patient_id == patient_id).order_by(RecordEntry.occurred_at.desc()))
    if kind:
        query = query.where(RecordEntry.kind == kind)
    if lo:
        query = query.where(RecordEntry.occurred_at >= lo)
    if hi:
        query = query.where(RecordEntry.occurred_at < hi)
    out = []
    for e, a, ed, p in db.execute(query.limit(2000)):
        out.append(EntryOut(
            id=e.id, patient_id=e.patient_id, kind=e.kind, client_name=e.client_name, title=e.title,
            notes=e.notes, occurred_at=e.occurred_at, witness_name=e.witness_name, location=e.location,
            severity=e.severity, action_taken=e.action_taken, mood=e.mood, medicine_name=e.medicine_name,
            photo_uri=photos.signed_uri(p.id) if p else None, recorded_at=e.recorded_at,
            recorded_by=PersonOut.model_validate(a), edited_at=e.edited_at,
            edited_by=PersonOut.model_validate(ed) if ed else None))
    return out


@router.get("/patients/{patient_id}/entries", response_model=list[EntryOut])
def patient_entries(patient_id: uuid.UUID, kind: Kind | None = None,
                    from_date: Annotated[date | None, Query(alias="from")] = None,
                    to_date: Annotated[date | None, Query(alias="to")] = None,
                    me: CurrentUser = Depends(staff), db: Session = Depends(get_db)):
    """Written records, newest first, at most 2000. Filter by kind and UTC dates."""
    _patient(db, patient_id, me, "entries.view")
    return _entry_rows(db, patient_id, kind, from_date, to_date)


# --- CSV export --------------------------------------------------------------

def _safe(value) -> str:
    """Stop spreadsheet formula injection: a cell starting with = + - @ is treated as text."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def _csv(filename: str, header: list[str], rows: list[list]) -> StreamingResponse:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    writer.writerows([[_safe(v) for v in row] for row in rows])
    return StreamingResponse(
        iter(["﻿" + buffer.getvalue()]),  # BOM so Excel opens it as UTF-8
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/patients/{patient_id}/entries.csv", response_class=StreamingResponse,
            responses={200: {"content": {"text/csv": {}}}})
def export_entries(patient_id: uuid.UUID, kind: Kind | None = None,
                   from_date: Annotated[date | None, Query(alias="from")] = None,
                   to_date: Annotated[date | None, Query(alias="to")] = None,
                   me: CurrentUser = Depends(staff), db: Session = Depends(get_db)):
    _patient(db, patient_id, me, "entries.export")
    rows = _entry_rows(db, patient_id, kind, from_date, to_date)
    header = ["occurredAt", "kind", "title", "clientName", "notes", "severity", "mood", "medicineName",
              "location", "witnessName", "actionTaken", "recordedAt", "recordedBy", "recordedByRole",
              "editedAt", "editedBy"]
    data = [[r.occurred_at.isoformat(), r.kind, r.title, r.client_name, r.notes, r.severity, r.mood,
             r.medicine_name, r.location, r.witness_name, r.action_taken, r.recorded_at.isoformat(),
             r.recorded_by.name, r.recorded_by.role, r.edited_at.isoformat() if r.edited_at else "",
             r.edited_by.name if r.edited_by else ""] for r in rows]
    return _csv(f"records-{patient_id}.csv", header, data)


@router.get("/patients/{patient_id}/reminders.csv", response_class=StreamingResponse,
            responses={200: {"content": {"text/csv": {}}}})
def export_reminders(patient_id: uuid.UUID,
                     from_date: Annotated[date | None, Query(alias="from")] = None,
                     to_date: Annotated[date | None, Query(alias="to")] = None,
                     me: CurrentUser = Depends(staff), db: Session = Depends(get_db)):
    _patient(db, patient_id, me, "reminders.export")
    rows = _reminder_rows(db, patient_id, from_date, to_date)
    data = [[r.scheduled_at.isoformat(), r.medicine_name, r.status,
             r.acknowledged_at.isoformat() if r.acknowledged_at else ""] for r in rows]
    return _csv(f"reminders-{patient_id}.csv", ["scheduledAt", "medicine", "status", "confirmedAt"], data)


# --- access log --------------------------------------------------------------

@router.get("/access-log", response_model=Page[AccessLogOut])
def access_log(patient_id: Annotated[uuid.UUID | None, Query(alias="patientId")] = None,
               viewer_id: Annotated[uuid.UUID | None, Query(alias="viewerId")] = None,
               outcome: str | None = None, page: PageNo = 1, page_size: PageSize = 50,
               me: CurrentUser = Depends(staff), db: Session = Depends(get_db)) -> Page[AccessLogOut]:
    viewer, patient = aliased(User), aliased(User)
    query = (select(AccessLog, viewer, patient).join(viewer, viewer.id == AccessLog.viewer_id)
             .outerjoin(patient, patient.id == AccessLog.patient_id))
    if patient_id:
        query = query.where(AccessLog.patient_id == patient_id)
    if viewer_id:
        query = query.where(AccessLog.viewer_id == viewer_id)
    if outcome:
        query = query.where(AccessLog.outcome == outcome)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(AccessLog.at.desc(), AccessLog.id.desc())
                      .offset((page - 1) * page_size).limit(page_size))
    items = [AccessLogOut(id=log.id, at=log.at, viewer=PersonWithEmailOut.model_validate(v),
                          patient=PersonWithEmailOut.model_validate(p) if p else None,
                          action=log.action, outcome=log.outcome) for log, v, p in rows]
    return Page(items=items, total=total, page=page, page_size=page_size)
