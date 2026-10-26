"""Demo data for the demo day (issue 14).

    python -m app.seed

Run it once on an empty database. To start again from nothing:
    alembic downgrade base && alembic upgrade head && python -m app.seed
(The access log is append-only, so demo accounts are never deleted one by one.)

Creates two companies (password for every account: demo1234):

  Harbour Home Care
    patients    ana@ and bob@demo.carecircle.test
    caregiver   sam@demo.carecircle.test     (looks after Ana)
    supervisor  sue@demo.carecircle.test     (admin panel, sees Harbour Home Care only)
  Northside Care
    patient     cara@demo.carecircle.test
    caregiver   dan@demo.carecircle.test     (looks after Cara)
    supervisor  nina@demo.carecircle.test    (admin panel, sees Northside Care only)
  admin         al@demo.carecircle.test      (admin panel, every company)
and two weeks of medicines, reminders (some missed), documents and records.
Never run this against a database with real people in it.
"""

import random
import sys
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import (
    CareLink,
    Organization,
    HealthDocument,
    Medicine,
    RecordEntry,
    Reminder,
    User,
    UserPreferences,
)
from app.db.session import get_engine

DOMAIN = "demo.carecircle.test"
PASSWORD = "demo1234"
TZ = "America/St_Johns"


def _user(db: Session, name: str, role: str, password_hash: str,
          company: Organization | None = None) -> User:
    user = User(email=f"{name.split()[0].lower()}@{DOMAIN}", name=name, role=role,
                password_hash=password_hash, timezone=TZ,
                organization_id=company.id if company else None)
    db.add(user)
    db.flush()
    db.add(UserPreferences(user_id=user.id))
    return user


def seed() -> None:
    if get_settings().environment == "production":
        sys.exit("Refusing to load demo data into a production database.")
    rng = random.Random(7)
    tz = ZoneInfo(TZ)
    now = datetime.now(UTC)
    today = now.astimezone(tz).date()
    password_hash = hash_password(PASSWORD)

    with Session(get_engine()) as db:
        if db.scalar(select(User.id).where(User.email.like(f"%@{DOMAIN}")).limit(1)):
            sys.exit("Demo data is already loaded. To reload: alembic downgrade base && "
                     "alembic upgrade head && python -m app.seed")
        harbour, northside = Organization(name="Harbour Home Care"), Organization(name="Northside Care")
        db.add_all([harbour, northside])
        db.flush()
        ana = _user(db, "Ana Patient", "patient", password_hash, harbour)
        bob = _user(db, "Bob Fisher", "patient", password_hash, harbour)
        sam = _user(db, "Sam Caregiver", "caregiver", password_hash, harbour)
        _user(db, "Sue Supervisor", "supervisor", password_hash, harbour)
        cara = _user(db, "Cara Walsh", "patient", password_hash, northside)
        dan = _user(db, "Dan Caregiver", "caregiver", password_hash, northside)
        _user(db, "Nina Supervisor", "supervisor", password_hash, northside)
        _user(db, "Al Admin", "admin", password_hash)
        db.add(CareLink(patient_id=cara.id, caregiver_id=dan.id, invited_email=dan.email,
                        status="active", accepted_at=now - timedelta(days=10)))

        db.add(CareLink(patient_id=ana.id, caregiver_id=sam.id, invited_email=sam.email,
                        status="active", accepted_at=now - timedelta(days=20)))

        long_ago = now - timedelta(days=30)
        plans = [(ana, "Metformin", ["08:00", "20:00"]), (ana, "Lisinopril", ["09:00"]),
                 (bob, "Atorvastatin", ["21:00"]), (cara, "Levothyroxine", ["07:30"])]
        for patient, name, times in plans:
            medicine = Medicine(patient_id=patient.id, name=name, times=times,
                                start_date=today - timedelta(days=14), created_at=long_ago)
            db.add(medicine)
            db.flush()
            for days_back in range(14, -2, -1):
                day = today - timedelta(days=days_back)
                for hhmm in times:
                    hour, minute = map(int, hhmm.split(":"))
                    at = datetime.combine(day, time(hour, minute), tzinfo=tz).astimezone(UTC)
                    taken = None
                    if at + timedelta(minutes=60) < now and rng.random() < (0.8 if patient is ana else 0.65):
                        taken = at + timedelta(minutes=rng.randint(0, 40))
                    db.add(Reminder(patient_id=patient.id, medicine_id=medicine.id, scheduled_at=at,
                                    acknowledged_at=taken))

        db.add_all([
            HealthDocument(patient_id=ana.id, title="Metformin prescription", category="prescription",
                           recorded_on=today - timedelta(days=40)),
            HealthDocument(patient_id=ana.id, title="HbA1c blood test", category="lab_report",
                           recorded_on=today - timedelta(days=12)),
            HealthDocument(patient_id=ana.id, title="Hospital discharge letter", category="discharge_summary",
                           recorded_on=today - timedelta(days=95)),
            HealthDocument(patient_id=ana.id, title="Old clinic notes", category="other"),
            HealthDocument(patient_id=cara.id, title="Thyroid blood test", category="lab_report",
                           recorded_on=today - timedelta(days=20)),
            HealthDocument(patient_id=bob.id, title="Chest X-ray", category="imaging",
                           recorded_on=today - timedelta(days=5)),
        ])

        def entry(author: User, kind: str, title: str, notes: str, hours_ago: int,
                  patient: User | None = None, **extra) -> None:
            patient = patient or ana
            db.add(RecordEntry(patient_id=patient.id, kind=kind, client_name=patient.name, title=title,
                               notes=notes, occurred_at=now - timedelta(hours=hours_ago),
                               recorded_by=author.id, **extra))

        entry(sam, "incident", "Incident: Bathroom", "Slipped on the wet floor. No visible injury.", 50,
              severity="moderate", location="Bathroom", witness_name="Sam Caregiver",
              action_taken="Helped her up and called her daughter.")
        entry(sam, "behavioural", "Afternoon check-in", "Quiet after lunch, settled after a walk.", 26,
              mood="withdrawn")
        entry(sam, "behavioural", "Morning visit", "Chatty and cheerful, ate a full breakfast.", 5, mood="happy")
        entry(ana, "medical", "Dizzy in the morning", "Felt light-headed for ten minutes after getting up.", 30)
        entry(ana, "medication", "Missed evening dose", "Fell asleep early and missed the 20:00 dose.", 70,
              medicine_name="Metformin")
        entry(dan, "behavioural", "Evening visit", "Watched the news together, in good spirits.", 20,
              patient=cara, mood="calm")
        db.commit()

    print(f"Demo data loaded. Every demo account uses the password {PASSWORD!r}:")
    for who in ("ana patient, Harbour Home Care", "bob patient, Harbour Home Care",
                "sam caregiver, Harbour Home Care", "sue supervisor, Harbour Home Care",
                "cara patient, Northside Care", "dan caregiver, Northside Care",
                "nina supervisor, Northside Care", "al admin, every company"):
        first, rest = who.split(" ", 1)
        print(f"  {first}@{DOMAIN}  ({rest})")


if __name__ == "__main__":
    seed()
