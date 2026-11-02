"""Daily care tasks.

App (caregivers, and patients read-only by default):
  GET    /tasks?day=&patientId=          today's (or a day's) tasks with status, plus extra work
  POST   /tasks/{id}/complete            mark done, or skipped with a reason
  DELETE /tasks/{id}/complete?day=       undo your own mark within 24 hours
  POST   /tasks/extra                    log extra work that was not planned
Admin panel (supervisors):
  GET/POST /admin/patients/{id}/tasks    the client's care plan
  PATCH/DELETE /admin/tasks/{id}         change (a new schedule starts a new version) / remove
  GET    /admin/today?day=               every client's day in one table
  POST/DELETE /admin/tasks/{id}/complete supervisors can mark tasks too
"""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, patient_or_caregiver
from app.api.routes.admin import _in_scope, _scope, need
from app.core.errors import ApiError
from app.core.security import utcnow
from app.db.models import CareTask, TaskCompletion, User
from app.db.session import get_db
from app.schemas.common import PersonOut
from app.schemas.tasks import (
    CareTaskAppIn,
    CareTaskIn,
    _parse_time,
    CareTaskOut,
    CareTaskUpdateIn,
    CompleteIn,
    CompletionOut,
    DayCounts,
    ExtraIn,
    ExtraOut,
    OccurrenceOut,
    PatientDayOut,
)
from app.services import access
from app.services import care_tasks as ct
from app.services.permissions import has_permission, record_change

router = APIRouter(tags=["care tasks"])
admin_router = APIRouter(prefix="/admin", tags=["care tasks (admin panel)"])


# --- shaping -------------------------------------------------------------------------

def task_out(task: CareTask, creator: User | None = None) -> CareTaskOut:
    return CareTaskOut(id=task.id, patient_id=task.patient_id, title=task.title, instructions=task.instructions,
                       time=task.time_of_day.strftime("%H:%M") if task.time_of_day else None,
                       days=list(task.days), start_date=task.start_date, end_date=task.end_date,
                       grace_minutes=task.grace_minutes, created_at=task.created_at, ended_at=task.ended_at,
                       replaced_by=task.replaced_by,
                       created_by=PersonOut.model_validate(creator) if creator else None)


def tasks_out(db: Session, tasks: list[CareTask]) -> list[CareTaskOut]:
    ids = {t.created_by for t in tasks if t.created_by}
    people = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}
    return [task_out(t, people.get(t.created_by)) for t in tasks]


def _plan_query(patient_ids: list[uuid.UUID], include_ended: bool):
    query = select(CareTask).where(CareTask.patient_id.in_(patient_ids))
    if not include_ended:
        query = query.where(CareTask.ended_at.is_(None))
    return query.order_by(CareTask.time_of_day.nulls_last(), CareTask.title)


# --- changing a plan (shared by the admin panel and the app) ----------------------------

def plan_add(db: Session, actor: User, patient: User, body: CareTaskIn) -> CareTask:
    task = CareTask(patient_id=patient.id, title=body.title, instructions=body.instructions,
                    time_of_day=body.parsed_time(), days=body.days,
                    start_date=body.start_date or ct.local_today(patient), end_date=body.end_date,
                    grace_minutes=body.grace_minutes, created_by=actor.id, created_at=utcnow())
    if task.end_date and task.end_date < task.start_date:
        raise ApiError(422, fields={"endDate": "Cannot be before the start."})
    db.add(task)
    db.flush()
    record_change(db, patient.id, actor.id, "care_plan", None, {"added": _snapshot(task)})
    return task


def plan_change(db: Session, actor: User, task: CareTask, patient: User, body: CareTaskUpdateIn) -> CareTask:
    """Title and instructions change in place. A new time, days, end date or grace starts a
    new version from now (the old one ends), so past days keep their plan."""
    if task.ended_at is not None:
        raise ApiError(409, "This task was removed or replaced.", code="task_ended")
    sent = body.model_fields_set
    before = _snapshot(task)
    if "title" in sent and body.title:
        task.title = body.title
    if "instructions" in sent:
        task.instructions = body.instructions
    current = task
    if sent & {"time", "days", "end_date", "grace_minutes"}:
        now = utcnow()
        new = CareTask(patient_id=task.patient_id, title=task.title, instructions=task.instructions,
                       time_of_day=_parse_time(body.time) if "time" in sent else task.time_of_day,
                       days=body.days if "days" in sent and body.days else task.days,
                       start_date=max(task.start_date, ct.local_today(patient)),
                       end_date=body.end_date if "end_date" in sent else task.end_date,
                       grace_minutes=body.grace_minutes if "grace_minutes" in sent and body.grace_minutes is not None
                       else task.grace_minutes,
                       created_by=task.created_by, created_at=now)  # stays "added by" the same person
        if new.end_date and new.end_date < new.start_date:
            raise ApiError(422, fields={"endDate": "Cannot be before today."})
        db.add(new)
        db.flush()
        task.ended_at = now
        task.replaced_by = new.id
        current = new
    record_change(db, patient.id, actor.id, "care_plan", {"task": before}, {"task": _snapshot(current)})
    return current


def plan_remove(db: Session, actor: User, task: CareTask, patient: User) -> None:
    if task.ended_at is None:
        task.ended_at = utcnow()
        record_change(db, patient.id, actor.id, "care_plan", {"removed": _snapshot(task)}, None)


def _days_out(db: Session, days: list[ct.PatientDay]) -> list[PatientDayOut]:
    people_ids = {c.done_by for d in days for c in [*(o.completion for o in d.occurrences if o.completion), *d.extras]}
    people = {u.id: u for u in db.scalars(select(User).where(User.id.in_(people_ids)))} if people_ids else {}

    def completion_out(c: TaskCompletion) -> CompletionOut:
        return CompletionOut(status=c.status, reason=c.reason, note=c.note,
                             done_by=PersonOut.model_validate(people[c.done_by]), done_at=c.done_at)

    out = []
    for d in days:
        counts = DayCounts()
        for o in d.occurrences:
            setattr(counts, o.status, getattr(counts, o.status) + 1)
        out.append(PatientDayOut(
            patient=PersonOut.model_validate(d.patient), day=d.day, counts=counts,
            tasks=[OccurrenceOut(task_id=o.task.id, title=o.task.title, instructions=o.task.instructions,
                                 time=o.task.time_of_day.strftime("%H:%M") if o.task.time_of_day else None,
                                 due_at=o.due, status=o.status,
                                 completion=completion_out(o.completion) if o.completion else None)
                   for o in d.occurrences],
            extras=[ExtraOut(id=c.id, title=c.title, note=c.note, done_by=PersonOut.model_validate(people[c.done_by]),
                             done_at=c.done_at) for c in d.extras]))
    return out


def _require(db: Session, me: CurrentUser, code: str) -> None:
    if not has_permission(db, me.user, code):
        raise ApiError(403, "You do not have permission to do this.", code="missing_permission")


def _task_for_app(db: Session, me: CurrentUser, task_id: uuid.UUID) -> tuple[CareTask, User]:
    task = db.get(CareTask, task_id)
    if task is None or not access.can_read_patient(db, me.user, task.patient_id):
        raise ApiError(404)
    return task, db.get(User, task.patient_id)


def _snapshot(task: CareTask) -> dict:
    t = task_out(task)
    return {"title": t.title, "time": t.time, "days": t.days, "endDate": str(t.end_date) if t.end_date else None,
            "graceMinutes": t.grace_minutes}


# --- app -----------------------------------------------------------------------------

@router.get("/tasks", response_model=list[PatientDayOut])
def tasks_for_day(day: date | None = None,
                  patient_id: Annotated[uuid.UUID | None, Query(alias="patientId")] = None,
                  me: CurrentUser = Depends(patient_or_caregiver), db: Session = Depends(get_db)):
    """Patient: their own day. Caregiver: each linked patient's day (or one, ?patientId=).
    `day` is the client's local date; default today."""
    _require(db, me, "tasks.view")
    ids = access.readable_patient_ids(db, me.user)
    if patient_id is not None:
        if patient_id not in ids:
            raise ApiError(404)
        ids = [patient_id]
    patients = list(db.scalars(select(User).where(User.id.in_(ids)).order_by(User.name))) if ids else []
    if me.role == "caregiver":
        for p in patients:
            access.log_access(db, me.user, p.id, "tasks.list")
        db.commit()
    return _days_out(db, [ct.day_for(db, [p], day or ct.local_today(p))[0] for p in patients])


@router.post("/tasks/{task_id}/complete", response_model=PatientDayOut, status_code=201)
def complete_task(task_id: uuid.UUID, body: CompleteIn, me: CurrentUser = Depends(patient_or_caregiver),
                  db: Session = Depends(get_db)):
    """Mark a task done, or skipped with a reason. Returns the client's updated day."""
    _require(db, me, "tasks.complete")
    task, patient = _task_for_app(db, me, task_id)
    day = body.day or ct.local_today(patient)
    ct.complete(db, me.user, task, patient, day, body.status, body.reason, body.note)
    if me.role == "caregiver":
        access.log_access(db, me.user, patient.id, "tasks.complete")
    db.commit()
    return _days_out(db, ct.day_for(db, [patient], day))[0]


@router.delete("/tasks/{task_id}/complete", status_code=204)
def undo_task(task_id: uuid.UUID, day: date, me: CurrentUser = Depends(patient_or_caregiver),
              db: Session = Depends(get_db)) -> Response:
    """Undo your own mark (a mistake) within 24 hours."""
    _require(db, me, "tasks.complete")
    _task_for_app(db, me, task_id)
    ct.undo(db, me.user, task_id, day)
    db.commit()
    return Response(status_code=204)


@router.post("/tasks/extra", response_model=ExtraOut, status_code=201)
def log_extra(body: ExtraIn, me: CurrentUser = Depends(patient_or_caregiver), db: Session = Depends(get_db)):
    """Log work that was not in the plan, e.g. "Walk to the park"."""
    _require(db, me, "tasks.complete")
    if me.role == "patient":
        if body.patient_id not in (None, me.id):
            raise ApiError(404)
        patient = me.user
    else:
        linked = access.linked_patient_ids(db, me.id)
        target = body.patient_id or (linked[0] if len(linked) == 1 else None)
        if target is None:
            raise ApiError(422, fields={"patientId": "Choose which linked patient this is for."})
        if target not in linked:
            raise ApiError(404)
        patient = db.get(User, target)
    day = body.day or ct.local_today(patient)
    ct.check_day_can_be_recorded(patient, day)
    extra = TaskCompletion(patient_id=patient.id, task_id=None, day=day, status="done", title=body.title,
                           note=body.note, done_by=me.id, done_at=utcnow())
    db.add(extra)
    if me.role == "caregiver":
        access.log_access(db, me.user, patient.id, "tasks.extra")
    db.commit()
    return ExtraOut(id=extra.id, title=extra.title, note=extra.note, done_by=PersonOut.model_validate(me.user),
                    done_at=extra.done_at)


# --- planning from the app (permission tasks.plan) --------------------------------

def _plan_patient(db: Session, me: CurrentUser, requested: uuid.UUID | None) -> User:
    if me.role == "patient":
        if requested not in (None, me.id):
            raise ApiError(404)
        return me.user
    linked = access.linked_patient_ids(db, me.id)
    target = requested or (linked[0] if len(linked) == 1 else None)
    if target is None:
        raise ApiError(422, fields={"patientId": "Choose which linked patient this is for."})
    if target not in linked:
        raise ApiError(404)
    return db.get(User, target)


def _own_task(db: Session, me: CurrentUser, task_id: uuid.UUID) -> tuple[CareTask, User]:
    """A task this person added. Tasks planned by supervisors stay theirs to change."""
    task, patient = _task_for_app(db, me, task_id)
    if task.created_by != me.id:
        raise ApiError(403, "Only the person who added this task, or a supervisor, can change it.",
                       code="not_your_task")
    return task, patient


@router.get("/tasks/plan", response_model=list[CareTaskOut])
def app_plan(patient_id: Annotated[uuid.UUID | None, Query(alias="patientId")] = None,
             me: CurrentUser = Depends(patient_or_caregiver), db: Session = Depends(get_db)):
    """The care plan (current tasks) of the patient, or of the caregiver's linked patients."""
    _require(db, me, "tasks.view")
    ids = access.readable_patient_ids(db, me.user)
    if patient_id is not None:
        if patient_id not in ids:
            raise ApiError(404)
        ids = [patient_id]
    return tasks_out(db, list(db.scalars(_plan_query(ids, False)))) if ids else []


@router.post("/tasks/plan", response_model=CareTaskOut, status_code=201)
def app_plan_add(body: CareTaskAppIn, me: CurrentUser = Depends(patient_or_caregiver),
                 db: Session = Depends(get_db)):
    """Add a task to a linked client's plan. Needs the tasks.plan permission, which a
    supervisor gives (to one caregiver on their profile, or to a role)."""
    _require(db, me, "tasks.plan")
    patient = _plan_patient(db, me, body.patient_id)
    task = plan_add(db, me.user, patient, CareTaskIn(**body.model_dump(exclude={"patient_id"})))
    if me.role == "caregiver":
        access.log_access(db, me.user, patient.id, "tasks.plan")
    db.commit()
    return tasks_out(db, [task])[0]


@router.patch("/tasks/plan/{task_id}", response_model=CareTaskOut)
def app_plan_change(task_id: uuid.UUID, body: CareTaskUpdateIn, me: CurrentUser = Depends(patient_or_caregiver),
                    db: Session = Depends(get_db)):
    """Change a task you added (a new schedule starts a new version from now).
    There is no delete here: only a supervisor removes tasks. For the same reason the
    end date cannot be changed from the app (ending a task is removing it)."""
    _require(db, me, "tasks.plan")
    task, patient = _own_task(db, me, task_id)
    if "end_date" in body.model_fields_set:
        raise ApiError(403, "Only a supervisor can end or remove a task.", code="supervisor_only")
    current = plan_change(db, me.user, task, patient, body)
    db.commit()
    return tasks_out(db, [current])[0]


# --- admin panel ---------------------------------------------------------------------

def _patient(db: Session, me: CurrentUser, patient_id: uuid.UUID) -> User:
    patient = db.get(User, patient_id)
    if patient is None or patient.role != "patient" or not _in_scope(me, patient):
        raise ApiError(404)
    return patient


def _task(db: Session, me: CurrentUser, task_id: uuid.UUID) -> tuple[CareTask, User]:
    task = db.get(CareTask, task_id)
    if task is None:
        raise ApiError(404)
    return task, _patient(db, me, task.patient_id)


@admin_router.get("/patients/{patient_id}/tasks", response_model=list[CareTaskOut])
def care_plan(patient_id: uuid.UUID, include_ended: Annotated[bool, Query(alias="includeEnded")] = False,
              me: CurrentUser = Depends(need("tasks.view")), db: Session = Depends(get_db)):
    patient = _patient(db, me, patient_id)
    return tasks_out(db, list(db.scalars(_plan_query([patient.id], include_ended))))


@admin_router.post("/patients/{patient_id}/tasks", response_model=CareTaskOut, status_code=201)
def add_task(patient_id: uuid.UUID, body: CareTaskIn, me: CurrentUser = Depends(need("tasks.manage")),
             db: Session = Depends(get_db)):
    patient = _patient(db, me, patient_id)
    task = plan_add(db, me.user, patient, body)
    db.commit()
    return tasks_out(db, [task])[0]


@admin_router.patch("/tasks/{task_id}", response_model=CareTaskOut)
def change_task(task_id: uuid.UUID, body: CareTaskUpdateIn, me: CurrentUser = Depends(need("tasks.manage")),
                db: Session = Depends(get_db)):
    """See plan_change. Returns the current version."""
    task, patient = _task(db, me, task_id)
    current = plan_change(db, me.user, task, patient, body)
    db.commit()
    return tasks_out(db, [current])[0]


@admin_router.delete("/tasks/{task_id}", status_code=204)
def remove_task(task_id: uuid.UUID, me: CurrentUser = Depends(need("tasks.manage")),
                db: Session = Depends(get_db)) -> Response:
    """Take a task off the plan from now. Past days and their marks are kept."""
    task, patient = _task(db, me, task_id)
    plan_remove(db, me.user, task, patient)
    db.commit()
    return Response(status_code=204)


@admin_router.get("/today", response_model=list[PatientDayOut])
def today(day: date | None = None, me: CurrentUser = Depends(need("tasks.view")),
          db: Session = Depends(get_db)):
    """Every client (in your company) with tasks or extra work that day. `day` is each
    client's local date (default: today for each client)."""
    patients = list(db.scalars(_scope(select(User).where(User.role == "patient", User.is_active.is_(True)), me)
                               .where(User.id.in_(select(CareTask.patient_id).union(
                                   select(TaskCompletion.patient_id)))).order_by(User.name)))
    days = [ct.day_for(db, [p], day or ct.local_today(p))[0] for p in patients]
    days = [d for d in days if d.occurrences or d.extras]
    return _days_out(db, days)


@admin_router.post("/tasks/{task_id}/complete", response_model=PatientDayOut, status_code=201)
def staff_complete(task_id: uuid.UUID, body: CompleteIn, me: CurrentUser = Depends(need("tasks.complete")),
                   db: Session = Depends(get_db)):
    task, patient = _task(db, me, task_id)
    day = body.day or ct.local_today(patient)
    ct.complete(db, me.user, task, patient, day, body.status, body.reason, body.note)
    access.log_access(db, me.user, patient.id, "tasks.complete")
    db.commit()
    return _days_out(db, ct.day_for(db, [patient], day))[0]


@admin_router.delete("/tasks/{task_id}/complete", status_code=204)
def staff_undo(task_id: uuid.UUID, day: date, me: CurrentUser = Depends(need("tasks.complete")),
               db: Session = Depends(get_db)) -> Response:
    _task(db, me, task_id)
    ct.undo(db, me.user, task_id, day)
    db.commit()
    return Response(status_code=204)

