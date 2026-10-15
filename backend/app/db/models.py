"""Every table in the CareCircle database.

The migrations in backend/migrations are the source of truth for the real
database; these classes must stay in step with them (a test checks this).
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

ROLES = ("patient", "caregiver", "admin", "supervisor")
SELF_SIGN_UP_ROLES = ("patient", "caregiver")
STAFF_ROLES = ("admin", "supervisor")
LINK_STATUSES = ("pending", "active", "ended")
DOCUMENT_CATEGORIES = ("prescription", "lab_report", "imaging", "discharge_summary", "other")
ENTRY_KINDS = ("medical", "behavioural", "incident", "medication")
SEVERITIES = ("minor", "moderate", "serious")
MOODS = ("calm", "happy", "anxious", "confused", "agitated", "withdrawn")
ALERT_CHANNELS = ("email", "call", "push")

SHORT_TEXT = 100
LONG_TEXT = 2000
EMAIL_LENGTH = 254


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class Base(DeclarativeBase):
    pass


def _id() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                         server_default=text("gen_random_uuid()"))


def _created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


def _user_fk(nullable: bool = False, ondelete: str = "CASCADE") -> Mapped:
    return mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete=ondelete),
                         nullable=nullable)


# --- People and sign-in ------------------------------------------------------

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(_in("role", ROLES), name="users_role_valid"),
        CheckConstraint("email = lower(email)", name="users_email_lowercase"),
        CheckConstraint("length(trim(name)) > 0", name="users_name_not_blank"),
        UniqueConstraint("email", name="users_email_unique"),
    )

    id: Mapped[uuid.UUID] = _id()
    email: Mapped[str] = mapped_column(String(EMAIL_LENGTH), nullable=False)
    name: Mapped[str] = mapped_column(String(SHORT_TEXT), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    # IANA name such as "America/St_Johns". Medicine times are in this zone.
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, server_default="UTC")
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                 server_default=func.now(), onupdate=func.now())


class AuthSession(Base):
    """One row per refresh token. Tokens in one sign-in share a family_id.

    Only a SHA-256 hash of the token is stored. Using a token that was already
    swapped for a new one ends the whole family (someone copied it).
    """

    __tablename__ = "auth_sessions"
    __table_args__ = (Index("auth_sessions_family_idx", "family_id"),)

    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = _user_fk()
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = _created()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = _user_fk()
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = _created()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserPreferences(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    larger_text: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    reminder_notifications: Mapped[bool] = mapped_column(Boolean, nullable=False,
                                                         server_default=text("true"))
    missed_dose_email: Mapped[bool] = mapped_column(Boolean, nullable=False,
                                                    server_default=text("true"))
    missed_dose_call: Mapped[bool] = mapped_column(Boolean, nullable=False,
                                                   server_default=text("false"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                 server_default=func.now(), onupdate=func.now())


class PushToken(Base):
    __tablename__ = "push_tokens"

    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = _user_fk()
    token: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                 server_default=func.now(), onupdate=func.now())


# --- Caregiver links ---------------------------------------------------------

class CareLink(Base):
    """A patient's invitation to a caregiver, and the link once accepted."""

    __tablename__ = "care_links"
    __table_args__ = (
        CheckConstraint(_in("status", LINK_STATUSES), name="care_links_status_valid"),
        CheckConstraint("caregiver_id IS NULL OR caregiver_id <> patient_id",
                        name="care_links_not_self"),
        CheckConstraint("status = 'pending' OR caregiver_id IS NOT NULL OR ended_at IS NOT NULL",
                        name="care_links_active_has_caregiver"),
        CheckConstraint("invited_email = lower(invited_email)", name="care_links_email_lowercase"),
        # At most one open invitation or link between a patient and an email address.
        Index("care_links_one_open_per_pair", "patient_id", "invited_email", unique=True,
              postgresql_where=text("status IN ('pending', 'active')")),
        Index("care_links_caregiver_idx", "caregiver_id"),
        Index("care_links_invited_email_idx", "invited_email"),
    )

    id: Mapped[uuid.UUID] = _id()
    patient_id: Mapped[uuid.UUID] = _user_fk()
    caregiver_id: Mapped[uuid.UUID | None] = _user_fk(nullable=True)
    invited_email: Mapped[str] = mapped_column(String(EMAIL_LENGTH), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="pending")
    created_at: Mapped[datetime] = _created()
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_by: Mapped[uuid.UUID | None] = _user_fk(nullable=True, ondelete="SET NULL")


# --- Medicines and reminders -------------------------------------------------

class Medicine(Base):
    __tablename__ = "medicines"
    __table_args__ = (
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="medicines_dates_order"),
        CheckConstraint("cardinality(times) BETWEEN 1 AND 12", name="medicines_times_count"),
        CheckConstraint("length(trim(name)) > 0", name="medicines_name_not_blank"),
        Index("medicines_patient_idx", "patient_id"),
    )

    id: Mapped[uuid.UUID] = _id()
    patient_id: Mapped[uuid.UUID] = _user_fk()
    name: Mapped[str] = mapped_column(String(SHORT_TEXT), nullable=False)
    # Local times of day, "HH:MM", in the patient's time zone.
    times: Mapped[list[str]] = mapped_column(ARRAY(String(5)), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = _created()


class Reminder(Base):
    """One dose at one moment. Created by a job from medicines. Never confirmed by the server."""

    __tablename__ = "reminders"
    __table_args__ = (
        UniqueConstraint("medicine_id", "scheduled_at", name="reminders_once_per_time"),
        Index("reminders_patient_time_idx", "patient_id", "scheduled_at"),
        Index("reminders_unconfirmed_idx", "scheduled_at",
              postgresql_where=text("acknowledged_at IS NULL")),
    )

    id: Mapped[uuid.UUID] = _id()
    patient_id: Mapped[uuid.UUID] = _user_fk()
    medicine_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("medicines.id", ondelete="CASCADE"), nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created()


class AlertSent(Base):
    """One row per alert sent. The unique key makes "send each alert once" a database rule."""

    __tablename__ = "alerts_sent"
    __table_args__ = (
        UniqueConstraint("reminder_id", "recipient_id", "channel", name="alerts_sent_once"),
        CheckConstraint(_in("channel", ALERT_CHANNELS), name="alerts_sent_channel_valid"),
    )

    id: Mapped[uuid.UUID] = _id()
    reminder_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reminders.id", ondelete="CASCADE"), nullable=False)
    recipient_id: Mapped[uuid.UUID] = _user_fk()
    channel: Mapped[str] = mapped_column(String(10), nullable=False)
    sent_at: Mapped[datetime] = _created()
    delivered: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


# --- Health documents --------------------------------------------------------

class HealthDocument(Base):
    __tablename__ = "health_documents"
    __table_args__ = (
        CheckConstraint(_in("category", DOCUMENT_CATEGORIES), name="health_documents_category_valid"),
        Index("health_documents_patient_idx", "patient_id"),
    )

    id: Mapped[uuid.UUID] = _id()
    patient_id: Mapped[uuid.UUID] = _user_fk()
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    recorded_on: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = _created()


# --- Written records ---------------------------------------------------------

class RecordEntry(Base):
    __tablename__ = "record_entries"
    __table_args__ = (
        CheckConstraint(_in("kind", ENTRY_KINDS), name="record_entries_kind_valid"),
        CheckConstraint(f"severity IS NULL OR {_in('severity', SEVERITIES)}",
                        name="record_entries_severity_valid"),
        CheckConstraint(f"mood IS NULL OR {_in('mood', MOODS)}", name="record_entries_mood_valid"),
        CheckConstraint("severity IS NULL OR kind = 'incident'", name="record_entries_severity_kind"),
        CheckConstraint("mood IS NULL OR kind = 'behavioural'", name="record_entries_mood_kind"),
        CheckConstraint("medicine_name IS NULL OR kind = 'medication'",
                        name="record_entries_medicine_kind"),
        Index("record_entries_patient_time_idx", "patient_id", "occurred_at"),
        Index("record_entries_author_idx", "recorded_by"),
    )

    id: Mapped[uuid.UUID] = _id()
    patient_id: Mapped[uuid.UUID] = _user_fk()
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    client_name: Mapped[str | None] = mapped_column(String(SHORT_TEXT))
    title: Mapped[str] = mapped_column(String(SHORT_TEXT), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(LONG_TEXT))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    witness_name: Mapped[str | None] = mapped_column(String(SHORT_TEXT))
    location: Mapped[str | None] = mapped_column(String(SHORT_TEXT))
    severity: Mapped[str | None] = mapped_column(String(10))
    action_taken: Mapped[str | None] = mapped_column(String(LONG_TEXT))
    mood: Mapped[str | None] = mapped_column(String(15))
    medicine_name: Mapped[str | None] = mapped_column(String(SHORT_TEXT))
    recorded_at: Mapped[datetime] = _created()
    recorded_by: Mapped[uuid.UUID] = _user_fk(ondelete="RESTRICT")
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    edited_by: Mapped[uuid.UUID | None] = _user_fk(nullable=True, ondelete="RESTRICT")
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))


class RecordEntryHistory(Base):
    """A full copy of every earlier version of an entry, written on each edit."""

    __tablename__ = "record_entry_history"
    __table_args__ = (UniqueConstraint("entry_id", "version", name="record_entry_history_version"),)

    id: Mapped[uuid.UUID] = _id()
    entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("record_entries.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    replaced_at: Mapped[datetime] = _created()
    replaced_by: Mapped[uuid.UUID] = _user_fk(ondelete="RESTRICT")


class EntryPhoto(Base):
    """A private photo. Attached to at most one entry; removed with it."""

    __tablename__ = "entry_photos"
    __table_args__ = (
        CheckConstraint("content_type IN ('image/jpeg', 'image/png')", name="entry_photos_type"),
        CheckConstraint("size_bytes > 0 AND size_bytes <= 5242880", name="entry_photos_size"),
        UniqueConstraint("entry_id", name="entry_photos_one_per_entry"),
    )

    id: Mapped[uuid.UUID] = _id()
    uploaded_by: Mapped[uuid.UUID] = _user_fk()
    entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("record_entries.id", ondelete="CASCADE"))
    content_type: Mapped[str] = mapped_column(String(20), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    created_at: Mapped[datetime] = _created()


# --- Access log --------------------------------------------------------------

class AccessLog(Base):
    """Who looked at which patient's data, and when. Rows can be added, never changed."""

    __tablename__ = "access_log"
    __table_args__ = (
        Index("access_log_patient_idx", "patient_id", "at"),
        Index("access_log_viewer_idx", "viewer_id", "at"),
        CheckConstraint("outcome IN ('allowed', 'denied')", name="access_log_outcome_valid"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    viewer_id: Mapped[uuid.UUID] = _user_fk(ondelete="RESTRICT")
    viewer_role: Mapped[str] = mapped_column(String(20), nullable=False)
    patient_id: Mapped[uuid.UUID | None] = _user_fk(nullable=True, ondelete="RESTRICT")
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    outcome: Mapped[str] = mapped_column(String(10), nullable=False, server_default="allowed")
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                         server_default=func.now())
