"""Daily care tasks: plan, do, skip, extra work, the Today table, and missed-task alerts."""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, update

from app.db.models import AccountChange, CareTask, TaskAlert, TaskCompletion, User
from app.jobs import tasks as jobs
from app.services import care_tasks as ct
from app.services import mailer
from tests.helpers import join_company, link, sign_up, staff

UTC_ZONE = ZoneInfo("UTC")


@pytest.fixture(autouse=True)
def _clear_outbox():
    mailer.outbox.clear()


@pytest.fixture
def team(client):
    sue = staff(client, "supervisor", "Sue")
    ana, sam = sign_up(client, "Ana", "patient"), sign_up(client, "Sam", "caregiver")
    bob, eve = sign_up(client, "Bob", "patient"), sign_up(client, "Eve", "caregiver")
    from app.cli import create_org
    create_org("Northside Care")
    for p in (ana, sam):
        join_company(p)
    for p in (bob, eve):
        join_company(p, "Northside Care")
    link(client, ana, sam)
    link(client, bob, eve)
    mailer.outbox.clear()
    return {"sue": sue, "ana": ana, "sam": sam, "bob": bob, "eve": eve}


def plan(client, sue, patient, **body):
    response = client.post(f"/admin/patients/{patient.id}/tasks",
                           json={"title": "Morning check-in", **body}, headers=sue.auth)
    assert response.status_code == 201, response.text
    return response.json()


def today_of(client, who, patient=None):
    params = {"patientId": patient.id} if patient else {}
    return client.get("/tasks", params=params, headers=who.auth).json()


# --- status rules (service level, fixed clock) -----------------------------------------

def _task(db, patient_id, at: time | None, created: datetime, days=(1, 2, 3, 4, 5, 6, 7), grace=60,
          title="T", **kw):
    task = CareTask(patient_id=uuid.UUID(patient_id), title=title, time_of_day=at, days=list(days),
                    start_date=date(2026, 1, 1), grace_minutes=grace, created_at=created, **kw)
    db.add(task)
    db.commit()
    return task


def test_status_over_a_day(client, db, team):
    task = _task(db, team["ana"].id, time(9, 0), datetime(2026, 10, 1, tzinfo=UTC))
    day = date(2026, 10, 15)
    at = lambda h, m=0: datetime(2026, 10, 15, h, m, tzinfo=UTC)  # noqa: E731
    assert ct.status_of(task, day, UTC_ZONE, None, at(8)) == "upcoming"
    assert ct.status_of(task, day, UTC_ZONE, None, at(9, 30)) == "due"
    assert ct.status_of(task, day, UTC_ZONE, None, at(10, 1)) == "missed"
    done = TaskCompletion(status="done", done_at=at(9, 10))
    late = TaskCompletion(status="done", done_at=at(11))
    skipped = TaskCompletion(status="skipped", done_at=at(11))
    assert ct.status_of(task, day, UTC_ZONE, done, at(12)) == "done"
    assert ct.status_of(task, day, UTC_ZONE, late, at(12)) == "late"
    assert ct.status_of(task, day, UTC_ZONE, skipped, at(12)) == "skipped"
    anytime = _task(db, team["ana"].id, None, datetime(2026, 10, 1, tzinfo=UTC))
    assert ct.status_of(anytime, day, UTC_ZONE, None, at(23, 59)) == "upcoming"
    assert ct.status_of(anytime, day, UTC_ZONE, None, datetime(2026, 10, 16, 0, 1, tzinfo=UTC)) == "missed"


def test_a_task_added_after_its_time_starts_tomorrow(client, db, team):
    task = _task(db, team["ana"].id, time(9, 0), datetime(2026, 10, 15, 15, 0, tzinfo=UTC))
    assert not ct.scheduled_on(task, date(2026, 10, 15), UTC_ZONE)
    assert ct.scheduled_on(task, date(2026, 10, 16), UTC_ZONE)


def test_weekdays_dates_and_removal(client, db, team):
    mwf = _task(db, team["ana"].id, time(9, 0), datetime(2026, 10, 1, tzinfo=UTC), days=(1, 3, 5),
                end_date=date(2026, 10, 31), ended_at=datetime(2026, 10, 20, 12, 0, tzinfo=UTC))
    assert ct.scheduled_on(mwf, date(2026, 10, 14), UTC_ZONE)          # Wednesday
    assert not ct.scheduled_on(mwf, date(2026, 10, 15), UTC_ZONE)      # Thursday
    assert not ct.scheduled_on(mwf, date(2026, 10, 21), UTC_ZONE)      # removed on the 20th
    assert not ct.scheduled_on(mwf, date(2026, 11, 2), UTC_ZONE)       # after end date


def test_local_time_of_the_client(client, db, team):
    # 09:00 in St John's is 11:30 UTC in October.
    db.execute(update(User).where(User.id == uuid.UUID(team["ana"].id)).values(timezone="America/St_Johns"))
    db.commit()
    task = _task(db, team["ana"].id, time(9, 0), datetime(2026, 10, 1, tzinfo=UTC))
    tz = ZoneInfo("America/St_Johns")
    assert ct.due_at(task, date(2026, 10, 15), tz).astimezone(UTC) == datetime(2026, 10, 15, 11, 30, tzinfo=UTC)


# --- planning ----------------------------------------------------------------------------

def test_supervisor_plans_and_caregiver_sees_the_day(client, team):
    task = plan(client, team["sue"], team["ana"], instructions="Ask about sleep and pain.")
    [day] = today_of(client, team["sam"])
    assert day["patient"]["name"] == "Ana"
    assert [(t["title"], t["status"], t["time"]) for t in day["tasks"]] == [("Morning check-in", "upcoming", None)]
    assert day["tasks"][0]["instructions"] == "Ask about sleep and pain."
    [own] = today_of(client, team["ana"])  # the patient can look (read-only by default)
    assert own["tasks"][0]["taskId"] == task["id"]


def test_only_task_managers_plan(client, team):
    response = client.post(f"/admin/patients/{team['ana'].id}/tasks", json={"title": "X"}, headers=team["sam"].auth)
    assert response.status_code == 403
    bad = client.post(f"/admin/patients/{team['ana'].id}/tasks", json={"title": "X", "time": "9am"},
                      headers=team["sue"].auth)
    assert bad.status_code == 422 and "time" in bad.json()["error"]["fields"]
    assert client.post(f"/admin/patients/{team['ana'].id}/tasks", json={"title": "X", "days": [0, 8]},
                       headers=team["sue"].auth).status_code == 422
    # Bob is not in Sue's company.
    assert client.post(f"/admin/patients/{team['bob'].id}/tasks", json={"title": "X"},
                       headers=team["sue"].auth).status_code == 404


def test_changing_the_schedule_makes_a_new_version_and_keeps_history(client, db, team):
    sue, ana = team["sue"], team["ana"]
    task = plan(client, sue, ana, time="09:00")
    renamed = client.patch(f"/admin/tasks/{task['id']}", json={"title": "Morning visit"}, headers=sue.auth).json()
    assert renamed["id"] == task["id"] and renamed["title"] == "Morning visit"
    moved = client.patch(f"/admin/tasks/{task['id']}", json={"time": "10:30", "days": [1, 2, 3, 4, 5]},
                         headers=sue.auth).json()
    assert moved["id"] != task["id"] and moved["time"] == "10:30" and moved["days"] == [1, 2, 3, 4, 5]
    plan_now = client.get(f"/admin/patients/{ana.id}/tasks", headers=sue.auth).json()
    assert [t["id"] for t in plan_now] == [moved["id"]]
    everything = client.get(f"/admin/patients/{ana.id}/tasks?includeEnded=true", headers=sue.auth).json()
    old = next(t for t in everything if t["id"] == task["id"])
    assert old["endedAt"] and old["replacedBy"] == moved["id"]
    assert client.patch(f"/admin/tasks/{task['id']}", json={"title": "x"}, headers=sue.auth).status_code == 409
    changes = db.scalars(select(AccountChange.change).where(AccountChange.user_id == uuid.UUID(ana.id))).all()
    assert changes.count("care_plan") == 3


def test_removed_task_disappears_but_its_mark_stays(client, team):
    sue, ana, sam = team["sue"], team["ana"], team["sam"]
    kept = plan(client, sue, ana, title="Lunch")
    gone = plan(client, sue, ana, title="Shower")
    client.post(f"/tasks/{kept['id']}/complete", json={}, headers=sam.auth)
    client.delete(f"/admin/tasks/{kept['id']}", headers=sue.auth)
    client.delete(f"/admin/tasks/{gone['id']}", headers=sue.auth)
    [day] = today_of(client, sam)
    assert [(t["title"], t["status"]) for t in day["tasks"]] == [("Lunch", "done")]


# --- doing ---------------------------------------------------------------------------------

def test_caregiver_marks_done_once_and_can_undo(client, team):
    sue, ana, sam = team["sue"], team["ana"], team["sam"]
    task = plan(client, sue, ana)
    done = client.post(f"/tasks/{task['id']}/complete", json={"note": "Slept well."}, headers=sam.auth)
    assert done.status_code == 201
    item = done.json()["tasks"][0]
    assert item["status"] == "done" and item["completion"]["doneBy"]["name"] == "Sam"
    assert item["completion"]["note"] == "Slept well." and done.json()["counts"]["done"] == 1
    again = client.post(f"/tasks/{task['id']}/complete", json={}, headers=sam.auth)
    assert again.status_code == 409
    today = ct.local_today(User(timezone="UTC")).isoformat()
    assert client.delete(f"/admin/tasks/{task['id']}/complete?day={today}", headers=sue.auth).status_code == 403
    assert client.delete(f"/tasks/{task['id']}/complete?day={today}", headers=sam.auth).status_code == 204
    assert today_of(client, sam)[0]["tasks"][0]["status"] == "upcoming"


def test_skip_needs_a_reason(client, team):
    task = plan(client, team["sue"], team["ana"])
    no_reason = client.post(f"/tasks/{task['id']}/complete", json={"status": "skipped"}, headers=team["sam"].auth)
    assert no_reason.status_code == 422
    skipped = client.post(f"/tasks/{task['id']}/complete",
                          json={"status": "skipped", "reason": "Ana refused, felt tired"}, headers=team["sam"].auth)
    item = skipped.json()["tasks"][0]
    assert item["status"] == "skipped" and item["completion"]["reason"] == "Ana refused, felt tired"


def test_day_rules(client, team):
    sue, sam = team["sue"], team["sam"]
    task = plan(client, sue, team["ana"])
    today = date.fromisoformat(ct.local_today(User(timezone="UTC")).isoformat())
    future = client.post(f"/tasks/{task['id']}/complete", json={"day": str(today + timedelta(days=1))},
                         headers=sam.auth)
    assert future.status_code == 422
    before_it_existed = client.post(f"/tasks/{task['id']}/complete", json={"day": str(today - timedelta(days=2))},
                                    headers=sam.auth)
    assert before_it_existed.status_code == 422
    weekday_off = plan(client, sue, team["ana"], title="Weekly", days=[(today.isoweekday() % 7) + 1])
    assert client.post(f"/tasks/{weekday_off['id']}/complete", json={}, headers=sam.auth).status_code == 422


def test_strangers_cannot_see_or_mark(client, team):
    task = plan(client, team["sue"], team["ana"])
    eve, bob = team["eve"], team["bob"]
    assert client.get(f"/tasks?patientId={team['ana'].id}", headers=eve.auth).status_code == 404
    assert client.post(f"/tasks/{task['id']}/complete", json={}, headers=eve.auth).status_code == 404
    # Bob (a patient) has no permission to tick tasks at all: refused before anything is looked up.
    assert client.post(f"/tasks/{task['id']}/complete", json={}, headers=bob.auth).status_code == 403
    assert all(d["patient"]["name"] != "Ana" for d in today_of(client, eve))
    # The patient can look but not tick (no tasks.complete by default).
    patient_tick = client.post(f"/tasks/{task['id']}/complete", json={}, headers=team["ana"].auth)
    assert patient_tick.status_code == 403


def test_extra_work_shows_on_the_day(client, team):
    sam = team["sam"]
    extra = client.post("/tasks/extra", json={"title": "Walk to the park", "note": "20 minutes, sunny"},
                        headers=sam.auth)
    assert extra.status_code == 201 and extra.json()["doneBy"]["name"] == "Sam"
    [day] = today_of(client, sam)
    assert [e["title"] for e in day["extras"]] == ["Walk to the park"]
    assert client.post("/tasks/extra", json={"title": "x", "patientId": team["bob"].id},
                       headers=sam.auth).status_code == 404
    assert client.post("/tasks/extra", json={"title": " "}, headers=sam.auth).status_code == 422


def test_permissions_turn_ticking_on_and_off(client, team):
    sue, ana, sam = team["sue"], team["ana"], team["sam"]
    task = plan(client, sue, ana)
    adm = staff(client, "admin", "Al")
    roles = {r["name"]: r for r in client.get("/admin/roles", headers=adm.auth).json()}
    caregiver = roles["Caregiver"]
    client.patch(f"/admin/roles/{caregiver['id']}", json={
        "permissions": [c for c in caregiver["permissions"] if c != "tasks.complete"]}, headers=adm.auth)
    assert client.post(f"/tasks/{task['id']}/complete", json={}, headers=sam.auth).status_code == 403
    client.put(f"/admin/users/{ana.id}/permissions", json={"permissions": ["tasks.complete"]}, headers=sue.auth)
    assert client.post(f"/tasks/{task['id']}/complete", json={}, headers=ana.auth).status_code == 201


# --- the Today table ---------------------------------------------------------------------

def test_today_table_for_supervisors(client, team):
    sue = team["sue"]
    first = plan(client, sue, team["ana"], title="Breakfast")
    plan(client, sue, team["ana"], title="Lunch")
    client.post(f"/tasks/{first['id']}/complete", json={}, headers=team["sam"].auth)
    client.post("/tasks/extra", json={"title": "Phoned her daughter"}, headers=team["sam"].auth)
    rows = client.get("/admin/today", headers=sue.auth).json()
    assert [r["patient"]["name"] for r in rows] == ["Ana"]  # Bob is another company
    assert rows[0]["counts"]["done"] == 1 and rows[0]["counts"]["upcoming"] == 1
    assert rows[0]["extras"][0]["title"] == "Phoned her daughter"
    lunch = next(t for t in rows[0]["tasks"] if t["title"] == "Lunch")
    marked = client.post(f"/admin/tasks/{lunch['taskId']}/complete",
                         json={"status": "skipped", "reason": "At the hospital"}, headers=sue.auth)
    assert marked.status_code == 201 and marked.json()["counts"]["skipped"] == 1
    assert client.get("/admin/today", headers=team["sam"].auth).status_code == 403


# --- alerts ---------------------------------------------------------------------------------

def _overdue_task(db, patient_id, now: datetime) -> CareTask:
    """A 09:00 task that existed since last week; `now` is chosen after its deadline."""
    return _task(db, patient_id, time(9, 0), now - timedelta(days=7), title="Insulin injection")


def test_missed_task_alerts_caregiver_then_supervisor_once(client, db, team):
    now = datetime.now(UTC).replace(hour=10, minute=30, second=0, microsecond=0)  # deadline was 10:00
    _overdue_task(db, team["ana"].id, now)
    assert jobs.send_task_alerts(db, now) == 1
    assert [m["To"] for m in mailer.outbox] == [team["sam"].email]
    assert jobs.send_task_alerts(db, now + timedelta(minutes=5)) == 0
    later = now + timedelta(hours=3)
    assert jobs.send_task_alerts(db, later) == 1
    assert mailer.outbox[-1]["To"] == "supervisor.sue@test.example"
    assert jobs.send_task_alerts(db, later + timedelta(minutes=5)) == 0
    message = mailer.outbox[0]
    assert "09:00" in message.get_content()
    # The task's name can be health information: it is never in the email.
    assert "Insulin" not in message.get_content() and "Insulin" not in message["Subject"]


def test_no_alert_when_done_or_skipped(client, db, team):
    now = datetime.now(UTC).replace(hour=10, minute=30, second=0, microsecond=0)
    task = _overdue_task(db, team["ana"].id, now)
    db.add(TaskCompletion(patient_id=task.patient_id, task_id=task.id, day=now.date(), status="skipped",
                          reason="In hospital", done_by=uuid.UUID(team["sam"].id), done_at=now))
    db.commit()
    assert jobs.send_task_alerts(db, now + timedelta(hours=4)) == 0
    assert db.scalars(select(TaskAlert)).all() == []


def test_waiting_accounts_cannot_use_tasks(client):
    body = client.post("/auth/sign-up", json={"name": "Pat", "email": "pat@test.example",
                                              "password": "correct-horse-1"}).json()
    assert client.get("/tasks", headers={"Authorization": f"Bearer {body['accessToken']}"}).status_code == 403


# --- caregivers allowed to plan (permission tasks.plan) -----------------------------

def test_caregiver_needs_permission_to_add_tasks(client, team):
    sam = team["sam"]
    body = {"title": "Evening walk", "time": "18:00"}
    assert client.post("/tasks/plan", json=body, headers=sam.auth).status_code == 403
    # The supervisor gives Sam the permission on his profile.
    given = client.put(f"/admin/users/{sam.id}/permissions", json={"permissions": ["tasks.plan"]},
                       headers=team["sue"].auth)
    assert given.status_code == 200
    added = client.post("/tasks/plan", json=body, headers=sam.auth)
    assert added.status_code == 201
    assert added.json()["patientId"] == team["ana"].id and added.json()["createdBy"]["name"] == "Sam"
    # It is part of Ana's plan, for everyone.
    plan_titles = [t["title"] for t in client.get(f"/admin/patients/{team['ana'].id}/tasks",
                                                  headers=team["sue"].auth).json()]
    assert "Evening walk" in plan_titles
    assert [t["title"] for t in client.get("/tasks/plan", headers=team["ana"].auth).json()] == ["Evening walk"]


def test_caregiver_plans_only_for_linked_clients_and_changes_only_own_tasks(client, team):
    sue, sam, eve = team["sue"], team["sam"], team["eve"]
    client.put(f"/admin/users/{sam.id}/permissions", json={"permissions": ["tasks.plan"]}, headers=sue.auth)
    assert client.post("/tasks/plan", json={"title": "X", "patientId": team["bob"].id},
                       headers=sam.auth).status_code == 404
    supervisors_task = plan(client, sue, team["ana"], title="Morning check-in")
    mine = client.post("/tasks/plan", json={"title": "Puzzle time"}, headers=sam.auth).json()
    assert client.patch(f"/tasks/plan/{supervisors_task['id']}", json={"title": "x"},
                        headers=sam.auth).status_code == 403
    moved = client.patch(f"/tasks/plan/{mine['id']}", json={"time": "16:00"}, headers=sam.auth)
    assert moved.status_code == 200 and moved.json()["createdBy"]["name"] == "Sam"
    # Caregivers cannot remove tasks, not even their own, and cannot end them by date.
    assert client.delete(f"/tasks/plan/{moved.json()['id']}", headers=sam.auth).status_code == 405
    ended = client.patch(f"/tasks/plan/{moved.json()['id']}", json={"endDate": str(date.today())},
                         headers=sam.auth)
    assert ended.status_code == 403 and ended.json()["error"]["code"] == "supervisor_only"
    titles = [t["title"] for t in client.get("/tasks/plan", headers=sam.auth).json()]
    assert "Puzzle time" in titles
    # The supervisor can remove it.
    assert client.delete(f"/admin/tasks/{moved.json()['id']}", headers=sue.auth).status_code == 204
    # Eve (another client's caregiver, no permission) sees nothing of Ana's plan.
    assert client.get(f"/tasks/plan?patientId={team['ana'].id}", headers=eve.auth).status_code == 404


def test_supervisor_can_change_a_caregivers_task_and_history_shows_who(client, db, team):
    sue, sam = team["sue"], team["sam"]
    client.put(f"/admin/users/{sam.id}/permissions", json={"permissions": ["tasks.plan"]}, headers=sue.auth)
    task = client.post("/tasks/plan", json={"title": "Puzzle time"}, headers=sam.auth).json()
    assert client.patch(f"/admin/tasks/{task['id']}", json={"title": "Puzzles and cards"},
                        headers=sue.auth).status_code == 200
    changes = db.scalars(select(AccountChange).where(AccountChange.change == "care_plan")
                         .order_by(AccountChange.id)).all()
    assert [str(c.changed_by) for c in changes] == [sam.id, sue.id]


def test_giving_tasks_plan_to_a_role(client, team):
    adm = staff(client, "admin", "Al")
    caregiver = {r["name"]: r for r in client.get("/admin/roles", headers=adm.auth).json()}["Caregiver"]
    client.patch(f"/admin/roles/{caregiver['id']}", json={"permissions": caregiver["permissions"] + ["tasks.plan"]},
                 headers=adm.auth)
    assert client.post("/tasks/plan", json={"title": "Read the paper together"},
                       headers=team["sam"].auth).status_code == 201
