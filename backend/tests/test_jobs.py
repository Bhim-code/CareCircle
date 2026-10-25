"""Issue 13: background jobs."""

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.db.models import AlertSent, Medicine, PushToken, Reminder
from app.jobs import notify, tasks
from app.services import mailer
from tests.helpers import link, sign_up

PREFS = {"largerText": False, "reminderNotifications": True, "missedDoseEmail": True,
         "missedDoseCall": False}


@pytest.fixture(autouse=True)
def _clear():
    mailer.outbox.clear()
    notify.calls_made.clear()
    notify.pushes_sent.clear()


def _reminder(db, patient_id: str, minutes_ago: int, acknowledged=False) -> uuid.UUID:
    now = datetime.now(UTC)
    med = Medicine(patient_id=uuid.UUID(patient_id), name="Metformin", times=["08:00"],
                   start_date=date(2026, 1, 1), end_date=date(2026, 1, 1))
    db.add(med)
    db.flush()
    r = Reminder(patient_id=med.patient_id, medicine_id=med.id,
                 scheduled_at=now - timedelta(minutes=minutes_ago),
                 acknowledged_at=now if acknowledged else None)
    db.add(r)
    db.commit()
    return r.id


@pytest.fixture
def pair(client):
    ana = sign_up(client, "Ana", "patient", timezone="America/St_Johns")
    sam = sign_up(client, "Sam", "caregiver")
    link(client, ana, sam)
    mailer.outbox.clear()  # drop the invitation email
    return ana, sam


def _alert_emails():
    return [m for m in mailer.outbox if "missed a dose" in m["Subject"]]


def test_missed_dose_alert_sent_once(client, db, pair):
    ana, sam = pair
    _reminder(db, ana.id, minutes_ago=61)
    assert tasks.send_missed_dose_alerts(db) == 1
    assert tasks.send_missed_dose_alerts(db) == 0  # second run: nothing new
    [message] = _alert_emails()
    assert message["To"] == sam.email
    body = message.get_content()
    assert "Ana" in body and "Metformin" not in body and "Metformin" not in message["Subject"]


def test_no_alert_before_60_minutes_or_after_confirming(client, db, pair):
    ana, _ = pair
    _reminder(db, ana.id, minutes_ago=59)
    _reminder(db, ana.id, minutes_ago=90, acknowledged=True)
    assert tasks.send_missed_dose_alerts(db) == 0


def test_alerts_follow_each_caregivers_choices(client, db, pair):
    ana, sam = pair
    client.put("/me/preferences", json={**PREFS, "missedDoseEmail": False, "missedDoseCall": True},
               headers=sam.auth)
    _reminder(db, ana.id, minutes_ago=70)
    assert tasks.send_missed_dose_alerts(db) == 1
    assert _alert_emails() == [] and len(notify.calls_made) == 1
    assert db.scalar(select(AlertSent.channel)) == "call"


def test_no_alert_to_unlinked_or_ended_caregivers(client, db, pair):
    ana, sam = pair
    sign_up(client, "Eve", "caregiver")
    [row] = client.get("/care-links", headers=ana.auth).json()
    client.delete(f"/care-links/{row['id']}", headers=ana.auth)
    _reminder(db, ana.id, minutes_ago=70)
    assert tasks.send_missed_dose_alerts(db) == 0


def test_failed_send_is_retried_next_run(client, db, pair, monkeypatch):
    ana, _ = pair
    _reminder(db, ana.id, minutes_ago=70)
    monkeypatch.setattr(notify, "email", lambda *a: False)
    assert tasks.send_missed_dose_alerts(db) == 0
    assert db.scalars(select(AlertSent)).all() == []
    monkeypatch.undo()
    assert tasks.send_missed_dose_alerts(db) == 1


def test_old_misses_are_not_alerted(client, db, pair):
    ana, _ = pair
    _reminder(db, ana.id, minutes_ago=60 * 13)
    assert tasks.send_missed_dose_alerts(db) == 0


def test_due_push_once_and_respects_setting(client, db, pair):
    ana, _ = pair
    client.put("/me/push-token", json={"token": "ExponentPushToken[ana]"}, headers=ana.auth)
    _reminder(db, ana.id, minutes_ago=2)
    assert tasks.send_due_notifications(db) == 1
    assert tasks.send_due_notifications(db) == 0
    [push] = notify.pushes_sent
    assert push["to"] == "ExponentPushToken[ana]" and "Metformin" not in push["body"]

    client.put("/me/preferences", json={**PREFS, "reminderNotifications": False}, headers=ana.auth)
    _reminder(db, ana.id, minutes_ago=1)
    assert tasks.send_due_notifications(db) == 0


def test_dead_push_tokens_are_removed(client, db, pair, monkeypatch):
    ana, _ = pair
    client.put("/me/push-token", json={"token": "ExponentPushToken[gone]"}, headers=ana.auth)
    monkeypatch.setattr(notify, "push", lambda tokens, *a: list(tokens))
    _reminder(db, ana.id, minutes_ago=1)
    tasks.send_due_notifications(db)
    assert db.scalars(select(PushToken)).all() == []


def test_generate_job_creates_rows_for_patients(client, db):
    ana = sign_up(client, "Ana", "patient")
    client.post("/medicines", json={"name": "M", "times": ["23:59"], "startDate": "2026-01-01"},
                headers=ana.auth)
    before = len(db.scalars(select(Reminder)).all())
    tasks.generate_reminders(db)
    assert len(db.scalars(select(Reminder)).all()) >= before
    assert tasks.generate_reminders(db) == 0  # idempotent


def test_cli_runs_one_job(client, db, pair, capsys):
    from app.jobs.__main__ import main
    ana, _ = pair
    _reminder(db, ana.id, minutes_ago=61)
    main(["once", "alerts"])
    assert capsys.readouterr().out.strip() == "alerts: 1"
