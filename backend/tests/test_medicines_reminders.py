"""Issue 5: medicines, reminders and "I took it"."""

import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from sqlalchemy import select, update

from app.db.models import Medicine, Reminder, User
from app.services.reminders import generate_for_patient, generate_upcoming, local_day_bounds
from tests.helpers import link, sign_up


def _add_reminder(db, patient_id: str, when: datetime, name: str = "Metformin") -> str:
    """Put a reminder at an exact moment, bypassing the 'not before created' rule."""
    # A medicine that has already ended, so on-demand generation adds nothing else.
    start = when.date() - timedelta(days=30)
    medicine = Medicine(patient_id=uuid.UUID(patient_id), name=name, times=["08:00"],
                        start_date=start, end_date=start)
    db.add(medicine)
    db.flush()
    reminder = Reminder(patient_id=medicine.patient_id, medicine_id=medicine.id, scheduled_at=when)
    db.add(reminder)
    db.commit()
    return str(reminder.id)


def test_add_and_list_medicines(client):
    ana = sign_up(client, "Ana", "patient")
    body = {"name": "Metformin", "times": ["20:00", "08:00"], "startDate": "2026-10-01", "endDate": None}
    created = client.post("/medicines", json=body, headers=ana.auth)
    assert created.status_code == 201
    assert created.json()["times"] == ["08:00", "20:00"]
    assert [m["name"] for m in client.get("/medicines", headers=ana.auth).json()] == ["Metformin"]


def test_medicine_validation(client):
    ana = sign_up(client, "Ana", "patient")
    for bad in ({"times": ["8am"]}, {"times": []}, {"times": ["08:00", "08:00"]},
                {"endDate": "2026-09-01"}, {"name": "  "}):
        body = {"name": "Metformin", "times": ["08:00"], "startDate": "2026-10-01", **bad}
        assert client.post("/medicines", json=body, headers=ana.auth).status_code == 422, bad


def test_caregivers_cannot_use_patient_endpoints(client):
    ana = sign_up(client, "Ana", "patient")
    sam = sign_up(client, "Sam", "caregiver")
    link(client, ana, sam)
    assert client.get("/medicines", headers=sam.auth).status_code == 403
    assert client.get("/reminders?day=2026-10-15", headers=sam.auth).status_code == 403
    assert client.get("/health-records", headers=sam.auth).status_code == 403


def test_reminders_are_the_patients_own_and_in_contract_shape(client, db):
    ana = sign_up(client, "Ana", "patient")
    bob = sign_up(client, "Bob", "patient")
    when = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)
    _add_reminder(db, ana.id, when)
    _add_reminder(db, bob.id, when, name="Bob's pill")

    response = client.get("/reminders?day=2026-10-15", headers=ana.auth)
    assert response.status_code == 200
    [reminder] = response.json()
    assert set(reminder) == {"id", "medicineName", "scheduledAt", "acknowledged"}
    assert reminder["medicineName"] == "Metformin"
    assert reminder["scheduledAt"] == "2026-10-15T12:00:00.000Z"
    assert reminder["acknowledged"] is False


def test_day_is_the_patients_local_day(client, db):
    # St John's is UTC-2:30 in October. 01:00 UTC on the 16th is still the 15th there.
    ana = sign_up(client, "Ana", "patient", timezone="America/St_Johns")
    _add_reminder(db, ana.id, datetime(2026, 10, 16, 1, 0, tzinfo=UTC))
    assert len(client.get("/reminders?day=2026-10-15", headers=ana.auth).json()) == 1
    assert client.get("/reminders?day=2026-10-16", headers=ana.auth).json() == []
    # The phone can also say its zone explicitly.
    utc_view = client.get("/reminders?day=2026-10-16&timezone=UTC", headers=ana.auth).json()
    assert len(utc_view) == 1


def test_acknowledge_sets_time_once_and_only_for_owner(client, db):
    ana = sign_up(client, "Ana", "patient")
    bob = sign_up(client, "Bob", "patient")
    sam = sign_up(client, "Sam", "caregiver")
    link(client, ana, sam)
    reminder_id = _add_reminder(db, ana.id, datetime.now(UTC) - timedelta(minutes=10))

    assert client.post(f"/reminders/{reminder_id}/acknowledge", headers=bob.auth).status_code == 404
    assert client.post(f"/reminders/{reminder_id}/acknowledge", headers=sam.auth).status_code == 403
    assert client.post(f"/reminders/{uuid.uuid4()}/acknowledge", headers=ana.auth).status_code == 404

    assert client.post(f"/reminders/{reminder_id}/acknowledge", headers=ana.auth).status_code == 204
    first = db.scalar(select(Reminder.acknowledged_at).where(Reminder.id == uuid.UUID(reminder_id)))
    assert first is not None
    assert client.post(f"/reminders/{reminder_id}/acknowledge", headers=ana.auth).status_code == 204
    db.expire_all()
    again = db.scalar(select(Reminder.acknowledged_at).where(Reminder.id == uuid.UUID(reminder_id)))
    assert again == first


def test_cannot_confirm_a_dose_hours_early(client, db):
    ana = sign_up(client, "Ana", "patient")
    reminder_id = _add_reminder(db, ana.id, datetime.now(UTC) + timedelta(hours=3))
    assert client.post(f"/reminders/{reminder_id}/acknowledge", headers=ana.auth).status_code == 422


def test_reminders_are_never_confirmed_by_the_server(client, db):
    ana = sign_up(client, "Ana", "patient")
    _add_reminder(db, ana.id, datetime.now(UTC) - timedelta(hours=5))
    generate_upcoming(db)
    assert db.scalar(select(Reminder.acknowledged_at)) is None


def test_generation_is_idempotent_and_skips_times_before_the_medicine_existed(db):
    patient = User(email="p@test.example", name="P", role="patient", password_hash="x",
                   timezone="America/St_Johns")
    db.add(patient)
    db.flush()
    created_at = datetime(2026, 10, 15, 15, 0, tzinfo=ZoneInfo("America/St_Johns"))
    db.add(Medicine(patient_id=patient.id, name="M", times=["08:00", "20:00"],
                    start_date=date(2026, 10, 1), created_at=created_at))
    db.flush()
    days = [date(2026, 10, 15), date(2026, 10, 16)]
    assert generate_for_patient(db, patient, days) == 3  # 15th 20:00, 16th 08:00 and 20:00
    assert generate_for_patient(db, patient, days) == 0
    times = [r.astimezone(ZoneInfo("America/St_Johns")).strftime("%d %H:%M")
             for r in db.scalars(select(Reminder.scheduled_at).order_by(Reminder.scheduled_at))]
    assert times == ["15 20:00", "16 08:00", "16 20:00"]


def test_daylight_saving_day_keeps_local_clock_times(db):
    # Clocks go back on 1 Nov 2026 in St John's: 08:00 local is 10:30 UTC instead of 09:30.
    tz = ZoneInfo("America/St_Johns")
    patient = User(email="p@test.example", name="P", role="patient", password_hash="x",
                   timezone="America/St_Johns")
    db.add(patient)
    db.flush()
    db.add(Medicine(patient_id=patient.id, name="M", times=["08:00"], start_date=date(2026, 10, 1),
                    created_at=datetime(2026, 10, 1, tzinfo=UTC)))
    db.flush()
    generate_for_patient(db, patient, [date(2026, 10, 31), date(2026, 11, 1)])
    utc_times = [r.strftime("%H:%M") for r in db.scalars(select(Reminder.scheduled_at)
                                                         .order_by(Reminder.scheduled_at))]
    assert utc_times == ["10:30", "11:30"]
    start, end = local_day_bounds(date(2026, 11, 1), tz)
    assert end - start == timedelta(hours=25)


def test_stop_medicine_keeps_history_and_ends_future_doses(client, db):
    ana = sign_up(client, "Ana", "patient")
    past = _add_reminder(db, ana.id, datetime.now(UTC) - timedelta(days=2))
    medicine_id = db.scalar(select(Reminder.medicine_id).where(Reminder.id == uuid.UUID(past)))
    db.add(Reminder(patient_id=uuid.UUID(ana.id), medicine_id=medicine_id,
                    scheduled_at=datetime.now(UTC) + timedelta(days=1)))
    db.commit()
    bob = sign_up(client, "Bob", "patient")
    assert client.delete(f"/medicines/{medicine_id}", headers=bob.auth).status_code == 404
    assert client.delete(f"/medicines/{medicine_id}", headers=ana.auth).status_code == 204
    assert client.delete(f"/medicines/{medicine_id}", headers=ana.auth).status_code == 204
    remaining = list(db.scalars(select(Reminder.id)))
    assert [str(r) for r in remaining] == [past]
    [medicine] = client.get("/medicines", headers=ana.auth).json()
    assert medicine["stoppedAt"]


def test_stopping_on_the_first_day_keeps_a_confirmed_dose(client, db):
    # Every hour of the day, so some doses are past and some are still to come.
    ana = sign_up(client, "Ana", "patient")
    times = [f"{h:02d}:00" for h in range(0, 24, 2)]
    today = datetime.now(UTC).date().isoformat()
    medicine = client.post("/medicines", json={"name": "M", "times": times, "startDate": today},
                           headers=ana.auth).json()
    # Pretend the medicine was added yesterday so today's earlier doses exist, then confirm one.
    db.execute(update(Medicine).where(Medicine.id == uuid.UUID(medicine["id"]))
               .values(created_at=datetime.now(UTC) - timedelta(days=1)))
    db.commit()
    client.get(f"/reminders?day={today}", headers=ana.auth)
    taken = db.scalar(select(Reminder).where(Reminder.scheduled_at < datetime.now(UTC))
                      .order_by(Reminder.scheduled_at.desc()).limit(1))
    if taken is None:
        pytest.skip("Too early in the UTC day to have a past dose")
    taken.acknowledged_at = datetime.now(UTC)
    db.commit()

    assert client.delete(f"/medicines/{medicine['id']}", headers=ana.auth).status_code == 204
    after = client.get(f"/reminders?day={today}&timezone=UTC", headers=ana.auth).json()
    assert any(r["acknowledged"] for r in after)  # history kept
    assert all(r["scheduledAt"] < datetime.now(UTC).isoformat() for r in after)  # nothing new


def test_health_records_are_own_only(client, db):
    from app.db.models import HealthDocument
    ana = sign_up(client, "Ana", "patient")
    bob = sign_up(client, "Bob", "patient")
    db.add_all([
        HealthDocument(patient_id=uuid.UUID(ana.id), title="Blood test", category="lab_report",
                       recorded_on=date(2026, 9, 1)),
        HealthDocument(patient_id=uuid.UUID(ana.id), title="Old letter", category="other"),
        HealthDocument(patient_id=uuid.UUID(bob.id), title="Bob X-ray", category="imaging"),
    ])
    db.commit()
    docs = client.get("/health-records", headers=ana.auth).json()
    assert [d["title"] for d in docs] == ["Blood test", "Old letter"]
    assert docs[0] == {"id": docs[0]["id"], "title": "Blood test", "category": "lab_report",
                       "recordedOn": "2026-09-01"}
    assert docs[1]["recordedOn"] is None
