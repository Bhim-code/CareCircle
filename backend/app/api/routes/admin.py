"""Issue 11: endpoints for the admin panel.

- Supervisor: sees every client (patient) and caregiver of THEIR OWN company, and
  their data. The only change they can make is switching their own company's
  caregivers on or off. Anything from another company is a 404.
- Admin: global. Sees every company, turns accounts on or off, creates companies
  and puts people into them.
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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.api.deps import CurrentUser, current_user
from app.core.errors import ApiError
from app.db.models import (
    AccessLog,
    CareLink,
    EntryPhoto,
    HealthDocument,
    Medicine,
    Organization,
    RecordEntry,
    Role,
    UserProfile,
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
    CaregiverDetailOut,
    CaregiverPatientOut,
    CompanyIn,
    CompanyOut,
    CompanyRef,
    OverviewOut,
    Page,
    PatientDetailOut,
    RemindersToday,
)
from app.schemas.common import PersonOut, PersonWithEmailOut
from app.schemas.entries import EntryOut, Kind
from app.services import access, photos, stats
from app.services.permissions import has_permission
from app.services.reminders import local_day_bounds

router = APIRouter(prefix="/admin", tags=["admin panel"])

PageNo = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=200, alias="pageSize")]


def staff(me: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> CurrentUser:
    """Admin or supervisor with 'panel.access'. Anyone else is refused, and it is logged."""
    if me.role not in ("admin", "supervisor") or not has_permission(db, me.user, "panel.access"):
        access.log_access(db, me.user, None, "admin.denied", outcome="denied")
        db.commit()
        raise ApiError(403)
    return me


def need(code: str):
    """Dependency: staff who also hold this permission (set per role in the panel)."""

    def check(me: CurrentUser = Depends(staff), db: Session = Depends(get_db)) -> CurrentUser:
        if not has_permission(db, me.user, code):
            access.log_access(db, me.user, None, f"denied:{code}"[:60], outcome="denied")
            db.commit()
            raise ApiError(403, f"You need the '{code}' permission for this.", code="missing_permission")
        return me

    return check


def admin(me: CurrentUser = Depends(staff), db: Session = Depends(get_db)) -> CurrentUser:
    """Admins only (creating companies). Supervisors can only switch their caregivers on/off."""
    if me.role != "admin":
        access.log_access(db, me.user, None, "admin.change.denied", outcome="denied")
        db.commit()
        raise ApiError(403, "Only an admin can do this.")
    return me


# --- company scope -------------------------------------------------------------

def _company(me: CurrentUser) -> uuid.UUID | None:
    """The company a viewer is limited to. None means every company (admin only)."""
    if me.role == "admin":
        return None
    if me.user.organization_id is None:  # cannot happen (database rule), but never fall open
        raise ApiError(403, "Your account is not attached to a company.")
    return me.user.organization_id


def _scope(query, me: CurrentUser, column=User.organization_id):
    company = _company(me)
    return query if company is None else query.where(column == company)


def _company_patient_ids(me: CurrentUser):
    """Subquery: ids of the patients this viewer may see."""
    return _scope(select(User.id).where(User.role == "patient"), me)


def _in_scope(me: CurrentUser, user: User) -> bool:
    company = _company(me)
    return company is None or user.organization_id == company


def _users_out(db: Session, users: list[User]) -> list[AdminUserOut]:
    org_ids = {u.organization_id for u in users if u.organization_id}
    names = dict(db.execute(select(Organization.id, Organization.name)
                            .where(Organization.id.in_(org_ids))).all()) if org_ids else {}
    role_names = dict(db.execute(select(Role.id, Role.name)).all())
    ids = [u.id for u in users]
    photo_keys = dict(db.execute(select(UserProfile.user_id, UserProfile.photo_key).where(
        UserProfile.user_id.in_(ids), UserProfile.photo_key.is_not(None))).all()) if ids else {}
    out = []
    for u in users:
        item = AdminUserOut.model_validate(u)
        if u.organization_id:
            item.company = CompanyRef(id=u.organization_id, name=names[u.organization_id])
        item.role_name = role_names.get(u.role_id)
        key = photo_keys.get(u.id)
        item.photo_uri = photos.signed_profile_uri(u.id, key) if key else None
        out.append(item)
    return out


def _zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        raise ApiError(422, fields={"timezone": "Unknown time zone."}) from None


def _patient(db: Session, patient_id: uuid.UUID, me: CurrentUser, action: str) -> User:
    """Load a patient the viewer may see, and log the view. Another company's: 404 + logged."""
    patient = db.get(User, patient_id)
    if patient is None or patient.role != "patient":
        raise ApiError(404)
    if not _in_scope(me, patient):
        access.log_access(db, me.user, patient.id, action, outcome="denied")
        db.commit()
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
    """Totals only, no one's details, so this is not written to the access log.
    A supervisor's numbers cover their own company only."""
    tz = _zone(timezone)
    company = _company(me)
    start, end = local_day_bounds(datetime.now(tz).date(), tz)
    counts = dict(db.execute(_scope(select(User.role, func.count()).where(User.is_active.is_(True)), me)
                             .group_by(User.role)).all())
    week_ago = datetime.now(UTC) - timedelta(days=7)
    patients = _company_patient_ids(me)
    org = db.get(Organization, company) if company else None
    return OverviewOut(
        company=CompanyRef(id=org.id, name=org.name) if org else None,
        patients=counts.get("patient", 0),
        caregivers=counts.get("caregiver", 0),
        active_links=db.scalar(select(func.count()).where(
            CareLink.status == "active", CareLink.patient_id.in_(patients))) or 0,
        reminders_today=RemindersToday(**stats.reminder_counts(db, start, end, organization_id=company)),
        adherence_last_7_days=stats.adherence(db, 7, organization_id=company),
        entries_last_7_days=db.scalar(select(func.count()).where(
            RecordEntry.recorded_at >= week_ago, RecordEntry.patient_id.in_(patients))) or 0,
    )


@router.get("/users", response_model=Page[AdminUserOut])
def list_users(role: str | None = None, q: Annotated[str | None, Query(max_length=100)] = None,
               active: bool | None = None, page: PageNo = 1, page_size: PageSize = 25,
               me: CurrentUser = Depends(need("people.view")), db: Session = Depends(get_db)) -> Page[AdminUserOut]:
    """Search by name or email. Filter by role and active state.
    A supervisor sees only the people in their own company."""
    query = _scope(select(User), me)
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
    return Page(items=_users_out(db, list(rows)), total=total, page=page, page_size=page_size)


# --- one caregiver -----------------------------------------------------------

@router.get("/caregivers/{caregiver_id}", response_model=CaregiverDetailOut)
def caregiver_detail(caregiver_id: uuid.UUID, me: CurrentUser = Depends(need("people.view")),
                     db: Session = Depends(get_db)) -> CaregiverDetailOut:
    """A caregiver of the viewer's company, and the clients they look after."""
    caregiver = db.get(User, caregiver_id)
    if caregiver is None or caregiver.role != "caregiver":
        raise ApiError(404)
    if not _in_scope(me, caregiver):
        access.log_access(db, me.user, caregiver.id, "caregiver.view", outcome="denied")
        db.commit()
        raise ApiError(404)
    access.log_access(db, me.user, caregiver.id, "caregiver.view")
    db.commit()
    company = _company(me)
    linked = db.execute(select(User, CareLink.accepted_at).join(CareLink, CareLink.patient_id == User.id)
                        .where(CareLink.caregiver_id == caregiver.id, CareLink.status == "active")
                        .order_by(User.name)).all()
    visible = [(p, since) for p, since in linked if company is None or p.organization_id == company]
    week_ago = datetime.now(UTC) - timedelta(days=7)
    return CaregiverDetailOut(
        caregiver=_users_out(db, [caregiver])[0],
        patients=[CaregiverPatientOut(id=p.id, name=p.name, email=p.email, linked_since=since,
                                      adherence_last_7_days=stats.adherence(db, 7, p.id))
                  for p, since in visible],
        other_company_patients=len(linked) - len(visible),
        entries_written_last_7_days=db.scalar(select(func.count()).where(
            RecordEntry.recorded_by == caregiver.id, RecordEntry.recorded_at >= week_ago,
            RecordEntry.patient_id.in_(_company_patient_ids(me)))) or 0,
    )


# --- companies ---------------------------------------------------------------

def _companies_out(db: Session, orgs: list[Organization]) -> list[CompanyOut]:
    counts = {(org_id, role): n for org_id, role, n in db.execute(
        select(User.organization_id, User.role, func.count())
        .where(User.organization_id.in_([o.id for o in orgs]), User.is_active.is_(True))
        .group_by(User.organization_id, User.role))}
    return [CompanyOut(id=o.id, name=o.name, created_at=o.created_at,
                       patients=counts.get((o.id, "patient"), 0),
                       caregivers=counts.get((o.id, "caregiver"), 0),
                       supervisors=counts.get((o.id, "supervisor"), 0)) for o in orgs]


@router.get("/organizations", response_model=list[CompanyOut])
def list_companies(me: CurrentUser = Depends(staff), db: Session = Depends(get_db)) -> list[CompanyOut]:
    """Admin: every company. Supervisor: only their own."""
    query = _scope(select(Organization), me, Organization.id).order_by(Organization.name)
    return _companies_out(db, list(db.scalars(query)))


@router.post("/organizations", response_model=CompanyOut, status_code=201)
def create_company(body: CompanyIn, me: CurrentUser = Depends(admin),
                   db: Session = Depends(get_db)) -> CompanyOut:
    org = Organization(name=body.name)
    db.add(org)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "A company with this name already exists.",
                       fields={"name": "Choose another name."}) from None
    db.refresh(org)
    return _companies_out(db, [org])[0]


# --- one patient -------------------------------------------------------------

@router.get("/patients/{patient_id}", response_model=PatientDetailOut)
def patient_detail(patient_id: uuid.UUID, me: CurrentUser = Depends(need("records.view")),
                   db: Session = Depends(get_db)) -> PatientDetailOut:
    patient = _patient(db, patient_id, me, "patient.view")
    caregivers = db.scalars(select(User).join(CareLink, CareLink.caregiver_id == User.id).where(
        CareLink.patient_id == patient.id, CareLink.status == "active").order_by(User.name))
    medicines = db.scalars(select(Medicine).where(Medicine.patient_id == patient.id)
                           .order_by(Medicine.created_at))
    return PatientDetailOut(
        patient=_users_out(db, [patient])[0],
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
                      me: CurrentUser = Depends(need("records.view")), db: Session = Depends(get_db)):
    """Newest first, at most 2000. Dates are UTC days."""
    _patient(db, patient_id, me, "reminders.view")
    return _reminder_rows(db, patient_id, from_date, to_date)


@router.get("/patients/{patient_id}/documents", response_model=list[AdminDocumentOut])
def patient_documents(patient_id: uuid.UUID, me: CurrentUser = Depends(need("records.view")),
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
                    me: CurrentUser = Depends(need("records.view")), db: Session = Depends(get_db)):
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
                   me: CurrentUser = Depends(need("records.export")), db: Session = Depends(get_db)):
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
                     me: CurrentUser = Depends(need("records.export")), db: Session = Depends(get_db)):
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
               me: CurrentUser = Depends(need("audit.view")), db: Session = Depends(get_db)) -> Page[AccessLogOut]:
    """A supervisor sees lines about their company's people, or made by their company's people."""
    viewer, patient = aliased(User), aliased(User)
    query = (select(AccessLog, viewer, patient).join(viewer, viewer.id == AccessLog.viewer_id)
             .outerjoin(patient, patient.id == AccessLog.patient_id))
    company = _company(me)
    if company is not None:
        query = query.where(or_(patient.organization_id == company, viewer.organization_id == company))
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
