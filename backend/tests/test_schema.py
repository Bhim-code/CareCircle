"""The database itself enforces the most important rules, as a last line of defence."""

import uuid
from datetime import UTC, datetime

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.db.models import AccessLog, CareLink, RecordEntry, User
from tests.conftest import BACKEND


def _user(db, role="patient", email=None) -> User:
    user = User(email=email or f"{uuid.uuid4().hex[:8]}@test.example", name="Test",
                role=role, password_hash="x")
    db.add(user)
    db.commit()
    return user


def test_models_match_migrations():
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    command.check(config)  # raises if a model changed without a migration


def test_only_known_roles_are_allowed(db):
    db.add(User(email="x@test.example", name="X", role="superuser", password_hash="x"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_emails_are_unique_and_lowercase(db):
    _user(db, email="ana@test.example")
    db.add(User(email="ana@test.example", name="Ana 2", role="patient", password_hash="x"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    db.add(User(email="Ana@Test.example", name="Ana 3", role="patient", password_hash="x"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_one_open_link_per_patient_and_email(db):
    patient = _user(db)
    db.add(CareLink(patient_id=patient.id, invited_email="sam@test.example"))
    db.commit()
    db.add(CareLink(patient_id=patient.id, invited_email="sam@test.example"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_mood_only_on_behavioural_entries(db):
    patient = _user(db)
    db.add(RecordEntry(patient_id=patient.id, kind="incident", title="t", mood="calm",
                       occurred_at=datetime.now(UTC), recorded_by=patient.id))
    with pytest.raises(IntegrityError):
        db.commit()


def test_access_log_cannot_be_edited_or_deleted(db):
    viewer = _user(db, role="supervisor")
    db.add(AccessLog(viewer_id=viewer.id, viewer_role="supervisor", action="view"))
    db.commit()
    with pytest.raises(DBAPIError, match="append-only"):
        db.execute(text("UPDATE access_log SET action = 'changed'"))
    db.rollback()
    with pytest.raises(DBAPIError, match="append-only"):
        db.execute(text("DELETE FROM access_log"))
