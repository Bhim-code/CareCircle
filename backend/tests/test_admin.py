"""Issue 11: admin and supervisor access, with the access log."""

import csv
import io
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.db.models import AccessLog, Medicine, Reminder
from tests.helpers import join_company, link, sign_up, staff
from tests.test_entries import entry


@pytest.fixture
def world(client, db):
    ana = sign_up(client, "Ana", "patient")
    bob = sign_up(client, "Bob", "patient")
    sam = sign_up(client, "Sam", "caregiver")
    link(client, ana, sam)
    client.post("/entries", json=entry("behavioural", notes="=HYPERLINK(\"http://evil\")"), headers=sam.auth)
    client.post("/entries", json=entry("medical"), headers=ana.auth)
    now = datetime.now(UTC)
    med = Medicine(patient_id=uuid.UUID(ana.id), name="Metformin", times=["08:00"],
                   start_date=date(2026, 1, 1), end_date=date(2026, 1, 1))
    db.add(med)
    db.flush()
    db.add_all([
        Reminder(patient_id=med.patient_id, medicine_id=med.id, scheduled_at=now - timedelta(hours=3),
                 acknowledged_at=now - timedelta(hours=3)),
        Reminder(patient_id=med.patient_id, medicine_id=med.id, scheduled_at=now - timedelta(hours=2)),
        Reminder(patient_id=med.patient_id, medicine_id=med.id, scheduled_at=now - timedelta(minutes=10)),
    ])
    db.commit()
    sup = staff(client, "supervisor", "Sue")  # company "Harbour Care"
    adm = staff(client, "admin", "Al")
    for person in (ana, bob, sam):
        join_company(person)
    return {"ana": ana, "bob": bob, "sam": sam, "sup": sup, "adm": adm}


ADMIN_GETS = ["/admin/overview", "/admin/users", "/admin/access-log"]


def test_patients_and_caregivers_are_refused_and_logged(client, db, world):
    for person in (world["ana"], world["sam"]):
        for url in ADMIN_GETS + [f"/admin/patients/{world['ana'].id}"]:
            assert client.get(url, headers=person.auth).status_code == 403, url
    denied = db.scalars(select(AccessLog).where(AccessLog.outcome == "denied")).all()
    assert len(denied) == 8
    assert client.get("/admin/overview").status_code == 401


def test_overview_counts_come_from_the_database(client, world):
    body = client.get("/admin/overview", headers=world["sup"].auth).json()
    assert body["patients"] == 2 and body["caregivers"] == 1 and body["activeLinks"] == 1
    assert body["entriesLast7Days"] == 2
    today = body["remindersToday"]
    assert today["taken"] + today["missed"] + today["due"] + today["upcoming"] == today["total"]
    assert body["adherenceLast7Days"] == 0.5  # 1 of 2 closed doses confirmed


def test_supervisor_reads_everything_and_every_view_is_logged(client, db, world):
    sup, ana = world["sup"], world["ana"]
    pid = ana.id
    detail = client.get(f"/admin/patients/{pid}", headers=sup.auth)
    assert detail.status_code == 200
    assert [c["name"] for c in detail.json()["caregivers"]] == ["Sam"]
    reminders = client.get(f"/admin/patients/{pid}/reminders", headers=sup.auth).json()
    assert sorted(r["status"] for r in reminders) == ["due", "missed", "taken"]
    entries = client.get(f"/admin/patients/{pid}/entries?kind=medical", headers=sup.auth).json()
    assert [e["kind"] for e in entries] == ["medical"]
    assert client.get(f"/admin/patients/{pid}/documents", headers=sup.auth).status_code == 200

    logged = db.execute(select(AccessLog.action).where(AccessLog.viewer_id == uuid.UUID(sup.id),
                                                       AccessLog.patient_id == uuid.UUID(pid))).scalars().all()
    assert logged == ["patient.view", "reminders.view", "entries.view", "documents.view"]


def test_supervisor_can_turn_off_a_patient_in_own_company(client, world):
    response = client.patch(f"/admin/users/{world['ana'].id}", json={"isActive": False},
                            headers=world["sup"].auth)
    assert response.status_code == 200
    assert client.get("/me", headers=world["ana"].auth).status_code == 401


def test_admin_deactivates_and_access_ends_immediately(client, world):
    adm, ana = world["adm"], world["ana"]
    response = client.patch(f"/admin/users/{ana.id}", json={"isActive": False}, headers=adm.auth)
    assert response.status_code == 200 and response.json()["person"]["isActive"] is False
    assert client.get("/me", headers=ana.auth).status_code == 401
    assert client.patch(f"/admin/users/{adm.id}", json={"isActive": False}, headers=adm.auth).status_code == 422
    assert client.patch(f"/admin/users/{ana.id}", json={"role": "admin"}, headers=adm.auth).status_code == 422


def test_users_search_and_paging(client, world):
    sup = world["sup"]
    page = client.get("/admin/users?role=patient&pageSize=1", headers=sup.auth).json()
    assert page["total"] == 2 and len(page["items"]) == 1
    found = client.get("/admin/users?q=ANA", headers=sup.auth).json()
    assert [u["name"] for u in found["items"]] == ["Ana"]
    assert "passwordHash" not in str(found)
    wildcard = client.get("/admin/users?q=%25", headers=sup.auth).json()
    assert wildcard["total"] == 0  # % is searched literally, not as "match all"


def test_non_patient_or_unknown_id_is_404(client, world):
    sup = world["sup"]
    assert client.get(f"/admin/patients/{world['sam'].id}", headers=sup.auth).status_code == 404
    assert client.get(f"/admin/patients/{uuid.uuid4()}", headers=sup.auth).status_code == 404


def test_csv_export_is_logged_and_safe_in_spreadsheets(client, db, world):
    sup, ana = world["sup"], world["ana"]
    response = client.get(f"/admin/patients/{ana.id}/entries.csv", headers=sup.auth)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert rows[0][0] == "occurredAt" and len(rows) == 3
    notes = [r[4] for r in rows[1:]]
    assert "'=HYPERLINK(\"http://evil\")" in notes
    reminders = client.get(f"/admin/patients/{ana.id}/reminders.csv", headers=sup.auth)
    assert reminders.status_code == 200 and len(reminders.text.splitlines()) == 4
    actions = db.scalars(select(AccessLog.action).where(AccessLog.action.like("%.export"))).all()
    assert sorted(actions) == ["entries.export", "reminders.export"]


def test_access_log_page_and_patient_can_see_who_viewed(client, world):
    sup, ana, sam = world["sup"], world["ana"], world["sam"]
    client.get(f"/admin/patients/{ana.id}", headers=sup.auth)
    client.get("/entries", headers=sam.auth)
    log = client.get(f"/admin/access-log?patientId={ana.id}", headers=sup.auth).json()
    assert {item["viewer"]["name"] for item in log["items"]} == {"Sue", "Sam"}
    mine = client.get("/me/access-log", headers=ana.auth).json()
    assert {(m["viewer"]["name"], m["viewer"]["role"]) for m in mine} == {("Sue", "supervisor"),
                                                                          ("Sam", "caregiver")}
    assert client.get("/me/access-log", headers=sam.auth).status_code == 403
    assert client.get("/me/access-log", headers=world["bob"].auth).json() == []
