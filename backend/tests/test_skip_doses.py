"""Skipping a dose (the alarm's "Skip"), and caregivers reading their patients' doses."""

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db.models import AccessLog, Medicine, Reminder
from app.jobs import notify, tasks
from app.services import mailer
from tests.helpers import link, sign_up, staff


@pytest.fixture(autouse=True)
def _clear():
    mailer.outbox.clear()
    notify.pushes_sent.clear()


def _dose(db, patient_id: str, minutes_ago: int, name: str = "Metformin") -> str:
    """One dose at an exact moment, from a medicine that has already ended (so on-demand
    generation adds nothing else)."""
    med = Medicine(patient_id=uuid.UUID(patient_id), name=name, times=["08:00"],
                   start_date=date(2026, 1, 1), end_date=date(2026, 1, 1))
    db.add(med)
    db.flush()
    r = Reminder(patient_id=med.patient_id, medicine_id=med.id,
                 scheduled_at=datetime.now(UTC) - timedelta(minutes=minutes_ago))
    db.add(r)
    db.commit()
    return str(r.id)


def _today(client, who, **query):
    params = "&".join(f"{k}={v}" for k, v in query.items())
    day = datetime.now(UTC).date()
    response = client.get(f"/reminders?day={day}&timezone=UTC" + (f"&{params}" if params else ""),
                          headers=who.auth)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def pair(client):
    ana = sign_up(client, "Ana", "patient")
    sam = sign_up(client, "Sam", "caregiver")
    link(client, ana, sam)
    mailer.outbox.clear()
    return ana, sam


def test_patient_skips_a_dose_and_it_shows_as_skipped(client, db, pair):
    ana, _ = pair
    dose = _dose(db, ana.id, minutes_ago=5)
    assert client.post(f"/reminders/{dose}/skip", headers=ana.auth).status_code == 204
    [item] = _today(client, ana)
    assert item["skipped"] is True and item["acknowledged"] is False and item["status"] == "skipped"


def test_skipping_twice_keeps_the_first_time(client, db, pair):
    ana, _ = pair
    dose = _dose(db, ana.id, minutes_ago=5)
    client.post(f"/reminders/{dose}/skip", headers=ana.auth)
    first = db.scalar(select(Reminder.skipped_at).where(Reminder.id == uuid.UUID(dose)))
    assert client.post(f"/reminders/{dose}/skip", headers=ana.auth).status_code == 204
    db.expire_all()
    assert db.scalar(select(Reminder.skipped_at).where(Reminder.id == uuid.UUID(dose))) == first


def test_a_taken_dose_cannot_be_skipped(client, db, pair):
    ana, _ = pair
    dose = _dose(db, ana.id, minutes_ago=5)
    client.post(f"/reminders/{dose}/acknowledge", headers=ana.auth)
    response = client.post(f"/reminders/{dose}/skip", headers=ana.auth)
    assert response.status_code == 409 and response.json()["error"]["code"] == "already_taken"


def test_taking_after_skipping_is_allowed_and_clears_the_skip(client, db, pair):
    ana, _ = pair
    dose = _dose(db, ana.id, minutes_ago=5)
    client.post(f"/reminders/{dose}/skip", headers=ana.auth)
    assert client.post(f"/reminders/{dose}/acknowledge", headers=ana.auth).status_code == 204
    [item] = _today(client, ana)
    assert item["status"] == "taken" and item["skipped"] is False


def test_cannot_skip_hours_early(client, db, pair):
    ana, _ = pair
    dose = _dose(db, ana.id, minutes_ago=-180)
    response = client.post(f"/reminders/{dose}/skip", headers=ana.auth)
    assert response.status_code == 422 and response.json()["error"]["code"] == "not_due"


def test_only_the_patient_can_skip(client, db, pair):
    ana, sam = pair
    bob = sign_up(client, "Bob", "patient")
    dose = _dose(db, ana.id, minutes_ago=5)
    assert client.post(f"/reminders/{dose}/skip", headers=bob.auth).status_code == 404
    assert client.post(f"/reminders/{dose}/skip", headers=sam.auth).status_code == 403
    assert client.post(f"/reminders/{uuid.uuid4()}/skip", headers=ana.auth).status_code == 404


def test_skipped_doses_send_no_missed_dose_alert(client, db, pair):
    ana, _ = pair
    skipped = _dose(db, ana.id, minutes_ago=61)
    client.post(f"/reminders/{skipped}/skip", headers=ana.auth)
    assert tasks.send_missed_dose_alerts(db) == 0
    _dose(db, ana.id, minutes_ago=62, name="Lisinopril")  # not skipped: still alerted
    assert tasks.send_missed_dose_alerts(db) == 1


def test_skipped_doses_get_no_due_push(client, db, pair):
    ana, _ = pair
    client.put("/me/push-token", json={"token": "ExponentPushToken[ana]"}, headers=ana.auth)
    dose = _dose(db, ana.id, minutes_ago=1)
    client.post(f"/reminders/{dose}/skip", headers=ana.auth)
    assert tasks.send_due_notifications(db) == 0


def test_a_dose_is_never_both_taken_and_skipped_in_the_database(db, pair):
    ana, _ = pair
    dose = _dose(db, ana.id, minutes_ago=5)
    reminder = db.get(Reminder, uuid.UUID(dose))
    reminder.acknowledged_at = reminder.skipped_at = datetime.now(UTC)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_staff_see_skipped_separately_from_missed(client, db, pair):
    ana, _ = pair
    sue = staff(client, "admin")
    dose = _dose(db, ana.id, minutes_ago=90)
    client.post(f"/reminders/{dose}/skip", headers=ana.auth)
    _dose(db, ana.id, minutes_ago=91, name="Lisinopril")
    [one, two] = client.get(f"/admin/patients/{ana.id}/reminders", headers=sue.auth).json()
    assert {one["status"], two["status"]} == {"skipped", "missed"}
    csv = client.get(f"/admin/patients/{ana.id}/reminders.csv", headers=sue.auth).text
    assert "skippedAt" in csv and "skipped" in csv


# --- caregivers reading their patients' doses ---------------------------------------

def test_caregiver_reads_linked_patients_doses(client, db, pair):
    ana, sam = pair
    bob = sign_up(client, "Bob", "patient")
    _dose(db, ana.id, minutes_ago=5)
    _dose(db, bob.id, minutes_ago=5, name="Bob's pill")
    items = _today(client, sam)
    assert [(i["patientName"], i["medicineName"]) for i in items] == [("Ana", "Metformin")]
    assert items[0]["patientId"] == ana.id
    # Reading is written to the access log, like other caregiver reads.
    assert db.scalar(select(AccessLog).where(AccessLog.action == "reminders.list",
                                             AccessLog.patient_id == uuid.UUID(ana.id)))


def test_caregiver_with_two_patients_gets_both_or_one(client, db, pair):
    ana, sam = pair
    cleo = sign_up(client, "Cleo", "patient")
    link(client, cleo, sam)
    _dose(db, ana.id, minutes_ago=5)
    _dose(db, cleo.id, minutes_ago=6, name="Cleo's pill")
    assert {i["patientName"] for i in _today(client, sam)} == {"Ana", "Cleo"}
    assert {i["patientName"] for i in _today(client, sam, patientId=cleo.id)} == {"Cleo"}


def test_unlinked_patients_are_not_found(client, db, pair):
    ana, sam = pair
    bob = sign_up(client, "Bob", "patient")
    day = datetime.now(UTC).date()
    assert client.get(f"/reminders?day={day}&patientId={bob.id}", headers=sam.auth).status_code == 404
    # A patient asking for someone else is refused the same way.
    assert client.get(f"/reminders?day={day}&patientId={bob.id}", headers=ana.auth).status_code == 404


def test_caregiver_cannot_skip_or_take_for_the_patient(client, db, pair):
    ana, sam = pair
    dose = _dose(db, ana.id, minutes_ago=5)
    assert client.post(f"/reminders/{dose}/acknowledge", headers=sam.auth).status_code == 403
    assert client.post(f"/reminders/{dose}/skip", headers=sam.auth).status_code == 403
