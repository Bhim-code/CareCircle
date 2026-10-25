"""Background jobs (issue 13). Each takes `now` so tests can choose the time.

Safe to run twice at once or to re-run after a crash:
- reminder rows are unique per medicine and time;
- each alert is "claimed" by inserting a row whose unique key is
  (reminder, caregiver, channel) BEFORE it is sent, so it goes out once;
- a due notification is claimed by setting due_notified_at in one UPDATE.
"""

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.db.models import (
    AlertSent,
    AuthSession,
    CareLink,
    PasswordResetToken,
    PushToken,
    Reminder,
    User,
    UserPreferences,
)
from app.jobs import notify
from app.services import photos
from app.services.reminders import generate_upcoming
from app.services.stats import missed_after

logger = logging.getLogger("carecircle.jobs")

# Older misses are not alerted (for example after the job was off for a day).
ALERT_LOOKBACK = timedelta(hours=12)
# A "medicine due" push is only worth sending close to the time.
DUE_WINDOW = timedelta(minutes=15)


def generate_reminders(db: Session, now: datetime | None = None) -> int:
    return generate_upcoming(db, now)


def _claim(db: Session, reminder_id, recipient_id, channel: str) -> bool:
    result = db.execute(insert(AlertSent).values(reminder_id=reminder_id, recipient_id=recipient_id,
                                                 channel=channel)
                        .on_conflict_do_nothing(constraint="alerts_sent_once").returning(AlertSent.id))
    claimed = result.first() is not None
    db.commit()
    return claimed


def _release(db: Session, reminder_id, recipient_id, channel: str) -> None:
    """Sending failed: remove the claim so the next run tries again."""
    db.execute(delete(AlertSent).where(AlertSent.reminder_id == reminder_id,
                                       AlertSent.recipient_id == recipient_id,
                                       AlertSent.channel == channel))
    db.commit()


def send_missed_dose_alerts(db: Session, now: datetime | None = None) -> int:
    """A reminder still unconfirmed 60 minutes after its time: tell the linked caregivers
    who asked for it, by email and/or phone. Each alert is sent once."""
    now = now or utcnow()
    cutoff = now - missed_after()
    patient, caregiver = User.__table__.alias("patient"), User.__table__.alias("caregiver")
    rows = db.execute(
        select(Reminder.id, Reminder.scheduled_at, patient.c.name, patient.c.timezone,
               caregiver.c.id, caregiver.c.email, caregiver.c.name,
               UserPreferences.missed_dose_email, UserPreferences.missed_dose_call)
        .join(patient, patient.c.id == Reminder.patient_id)
        .join(CareLink, (CareLink.patient_id == Reminder.patient_id) & (CareLink.status == "active"))
        .join(caregiver, caregiver.c.id == CareLink.caregiver_id)
        .outerjoin(UserPreferences, UserPreferences.user_id == caregiver.c.id)
        .where(Reminder.acknowledged_at.is_(None),
               Reminder.scheduled_at <= cutoff,
               Reminder.scheduled_at > now - ALERT_LOOKBACK,
               patient.c.is_active.is_(True), caregiver.c.is_active.is_(True))
    ).all()

    sent = 0
    for (reminder_id, scheduled_at, patient_name, patient_tz, caregiver_id, caregiver_email,
         caregiver_name, wants_email, wants_call) in rows:
        local = scheduled_at.astimezone(ZoneInfo(patient_tz)).strftime("%H:%M")
        # Defaults when no preferences row exists: email on, call off.
        channels = [c for c, on in (("email", True if wants_email is None else wants_email),
                                    ("call", bool(wants_call))) if on]
        message = (f"{patient_name} has not confirmed the dose scheduled for {local} "
                   f"({patient_tz} time). You may want to check in with them.")
        for channel in channels:
            if not _claim(db, reminder_id, caregiver_id, channel):
                continue  # already sent
            try:
                ok = (notify.email(caregiver_email, f"CareCircle: {patient_name} missed a dose",
                                   f"Hello {caregiver_name},\n\n{message}\n\n"
                                   "You can change these alerts in the CareCircle app settings.")
                      if channel == "email" else notify.phone_call(str(caregiver_id), message))
            except Exception:  # noqa: BLE001 - one failure must not stop the others
                ok = False
            if ok:
                sent += 1
            else:
                _release(db, reminder_id, caregiver_id, channel)
    if sent:
        logger.info("Missed-dose alerts sent: %d", sent)
    return sent


def send_due_notifications(db: Session, now: datetime | None = None) -> int:
    """Push "time for your medicine" to the patient when a dose becomes due."""
    now = now or utcnow()
    candidates = db.execute(
        select(Reminder.id, Reminder.patient_id, Reminder.scheduled_at, User.timezone)
        .join(User, User.id == Reminder.patient_id)
        .outerjoin(UserPreferences, UserPreferences.user_id == User.id)
        .where(Reminder.due_notified_at.is_(None), Reminder.acknowledged_at.is_(None),
               Reminder.scheduled_at <= now, Reminder.scheduled_at > now - DUE_WINDOW,
               User.is_active.is_(True),
               UserPreferences.reminder_notifications.is_not(False))
    ).all()
    sent = 0
    for reminder_id, patient_id, scheduled_at, tz in candidates:
        claimed = db.execute(update(Reminder).where(Reminder.id == reminder_id,
                                                    Reminder.due_notified_at.is_(None))
                             .values(due_notified_at=now).returning(Reminder.id)).first()
        db.commit()
        if not claimed:
            continue
        tokens = list(db.scalars(select(PushToken.token).where(PushToken.user_id == patient_id)))
        local = scheduled_at.astimezone(ZoneInfo(tz)).strftime("%H:%M")
        try:
            dead = notify.push(tokens, "CareCircle", f"It's time for your {local} medicine.")
        except Exception:  # noqa: BLE001
            db.execute(update(Reminder).where(Reminder.id == reminder_id).values(due_notified_at=None))
            db.commit()
            continue
        if dead:
            db.execute(delete(PushToken).where(PushToken.token.in_(dead)))
            db.commit()
        sent += 1 if tokens else 0
    return sent


def cleanup(db: Session, now: datetime | None = None) -> int:
    """Remove unused photo uploads and long-expired sign-in and reset tokens."""
    now = now or utcnow()
    removed = photos.cleanup(db)
    old = now - timedelta(days=30)
    removed += db.execute(delete(AuthSession).where(AuthSession.expires_at < old)).rowcount or 0
    removed += db.execute(delete(PasswordResetToken).where(PasswordResetToken.expires_at < old)).rowcount or 0
    db.commit()
    return removed
