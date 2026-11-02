"""Demo data for the demo day (issue 14).

    python -m app.seed

Run it once on an empty database. To start again from nothing:
    alembic downgrade base && alembic upgrade head && python -m app.seed
(The access log is append-only, so demo accounts are never deleted one by one.)

Creates one company, Harbour Home Care (password for every account: demo1234):

    patients    ana@ and bob@demo.carecircle.test
    caregiver   sam@demo.carecircle.test     (looks after Ana)
    supervisor  sue@demo.carecircle.test     (admin panel: full control of the company)
    waiting     pat@ and carl@demo.carecircle.test  (signed up, waiting for a role)
    admin       al@demo.carecircle.test      (admin panel, platform administrator)
and two weeks of medicines, reminders (some missed), documents and records.
Never run this against a database with real people in it.
"""

import io
import random
import sys
import uuid
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


def _demo_pdf(text: str) -> bytes:
    """A small, valid one-page PDF with a line of text."""
    stream = f"BT /F1 18 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
               b"/Resources << /Font << /F1 5 0 R >> >> >>",
               b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def _demo_photo() -> bytes:
    from PIL import Image, ImageDraw
    image = Image.new("RGB", (480, 640), (246, 247, 249))
    draw = ImageDraw.Draw(image)
    for i, line in enumerate(["PHARMACY RECEIPT (demo)", "Metformin 500 mg x 60", "Lisinopril 10 mg x 30"]):
        draw.text((40, 60 + i * 40), line, fill=(28, 36, 51))
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=85)
    return out.getvalue()


def _demo_file(db: Session, patient: User, uploader: User, title: str, category: str, recorded_on,
               data: bytes, file_name: str, content_type: str) -> None:
    from app.services.storage import get_storage
    doc_id = uuid.uuid4()
    key = f"documents/{patient.id}/{doc_id.hex}{'.pdf' if content_type == 'application/pdf' else '.jpg'}"
    get_storage().save(key, data)
    db.add(HealthDocument(id=doc_id, patient_id=patient.id, title=title, category=category,
                          recorded_on=recorded_on, file_key=key, content_type=content_type,
                          size_bytes=len(data), file_name=file_name, uploaded_by=uploader.id))


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
        harbour = Organization(name="Harbour Home Care")
        db.add(harbour)
        db.flush()
        ana = _user(db, "Ana Patient", "patient", password_hash, harbour)
        bob = _user(db, "Bob Fisher", "patient", password_hash, harbour)
        sam = _user(db, "Sam Caregiver", "caregiver", password_hash, harbour)
        _user(db, "Sue Supervisor", "supervisor", password_hash, harbour)
        _user(db, "Al Admin", "admin", password_hash)
        # Two people who signed up in the app and wait for Sue to assign a role.
        for name, asked in (("Pat Newman", "patient"), ("Carl Brooks", "caregiver")):
            pending = _user(db, name, "pending", password_hash, harbour)
            pending.requested_role = asked

        db.add(CareLink(patient_id=ana.id, caregiver_id=sam.id, invited_email=sam.email,
                        status="active", accepted_at=now - timedelta(days=20)))

        long_ago = now - timedelta(days=30)
        plans = [(ana, "Metformin", ["08:00", "20:00"]), (ana, "Lisinopril", ["09:00"]),
                 (bob, "Atorvastatin", ["21:00"])]
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
            HealthDocument(patient_id=bob.id, title="Chest X-ray", category="imaging",
                           recorded_on=today - timedelta(days=5)),
        ])

        # Two documents with real files, as if uploaded from the phones.
        _demo_file(db, ana, sam, "Pharmacy receipt photo", "prescription", today - timedelta(days=2),
                   _demo_photo(), "receipt.jpg", "image/jpeg")
        _demo_file(db, ana, ana, "Cardiology letter", "discharge_summary", today - timedelta(days=9),
                   _demo_pdf("Cardiology clinic - follow-up letter (demo)"), "cardiology-letter.pdf",
                   "application/pdf")

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
        db.commit()

    print(f"Demo data loaded. Every demo account uses the password {PASSWORD!r}:")
    for who in ("ana patient", "bob patient", "sam caregiver", "sue supervisor (full control)",
                "pat waiting for a role (asked: patient)", "carl waiting for a role (asked: caregiver)",
                "al admin"):
        first, rest = who.split(" ", 1)
        print(f"  {first}@{DOMAIN}  ({rest})")


if __name__ == "__main__":
    seed()
