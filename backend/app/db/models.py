"""Every table in the CareCircle database.

The migrations in backend/migrations are the source of truth for the real
database; these classes must stay in step with them (a test checks this).
"""

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    ARRAY,
    event,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# users.role is the KIND of the person's role (what the app treats them as), or
# "pending" until a supervisor assigns a role. The role itself is users.role_id.
ROLES = ("patient", "caregiver", "admin", "supervisor", "pending")
ROLE_KINDS = ("patient", "caregiver", "supervisor", "admin")
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


# --- Companies ---------------------------------------------------------------

class Organization(Base):
    """A care company. Its supervisors see only its own clients and caregivers."""

    __tablename__ = "organizations"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="organizations_name_not_blank"),
        Index("organizations_name_unique", text("lower(name)"), unique=True),
    )

    id: Mapped[uuid.UUID] = _id()
    name: Mapped[str] = mapped_column(String(SHORT_TEXT), nullable=False)
    created_at: Mapped[datetime] = _created()


# --- Roles and permissions (many-to-many) ------------------------------------

class Permission(Base):
    """One thing a person may do. The list is fixed in app/core/permissions.py."""

    __tablename__ = "permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(String(200), nullable=False)


class Role(Base):
    """A named set of permissions. Its kind decides how the app treats the person."""

    __tablename__ = "roles"
    __table_args__ = (
        CheckConstraint(_in("kind", ROLE_KINDS), name="roles_kind_valid"),
        CheckConstraint("length(trim(name)) > 0", name="roles_name_not_blank"),
        Index("roles_name_unique", text("lower(name)"), unique=True),
        # Exactly one built-in role per kind: the default when someone is given that kind.
        Index("roles_one_system_role_per_kind", "kind", unique=True, postgresql_where=text("is_system")),
    )

    id: Mapped[uuid.UUID] = _id()
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(String(200), nullable=False, server_default="")
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = _created()


class RolePermission(Base):
    """Many-to-many: which permissions each role has."""

    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    permission_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True)


class UserPermission(Base):
    """Many-to-many: extra permissions given to one person, on top of their role's."""

    __tablename__ = "user_permissions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    permission_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True)
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    granted_at: Mapped[datetime] = _created()


# --- People and sign-in ------------------------------------------------------

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(_in("role", ROLES), name="users_role_valid"),
        CheckConstraint("email = lower(email)", name="users_email_lowercase"),
        CheckConstraint("length(trim(name)) > 0", name="users_name_not_blank"),
        UniqueConstraint("email", name="users_email_unique"),
        # An active supervisor always belongs to a company; an admin never does (admins are global).
        CheckConstraint("role <> 'supervisor' OR organization_id IS NOT NULL OR NOT is_active",
                        name="users_supervisor_has_company"),
        CheckConstraint("role <> 'admin' OR organization_id IS NULL", name="users_admin_is_global"),
        # Waiting for a role <=> no role assigned.
        CheckConstraint("(role = 'pending') = (role_id IS NULL)", name="users_pending_has_no_role"),
        CheckConstraint(f"requested_role IS NULL OR {_in('requested_role', SELF_SIGN_UP_ROLES)}",
                        name="users_requested_role_valid"),
        Index("users_role_id_idx", "role_id"),
        Index("users_organization_idx", "organization_id"),
    )

    id: Mapped[uuid.UUID] = _id()
    email: Mapped[str] = mapped_column(String(EMAIL_LENGTH), nullable=False)
    name: Mapped[str] = mapped_column(String(SHORT_TEXT), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    role_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("roles.id", ondelete="RESTRICT", name="users_role_id_fkey"))
    # What the person asked for at sign-up (a hint for the supervisor; grants nothing).
    requested_role: Mapped[str | None] = mapped_column(String(20))
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    # IANA name such as "America/St_Johns". Medicine times are in this zone.
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, server_default="UTC")
    # The care company this person belongs to. Only an admin can set it.
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="RESTRICT",
                                       name="users_organization_id_fkey"))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                 server_default=func.now(), onupdate=func.now())


class UserProfile(Base):
    """Details shown on the profile page. Personal data: staff with people.view only."""

    __tablename__ = "user_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    phone: Mapped[str | None] = mapped_column(String(30))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    address: Mapped[str | None] = mapped_column(String(300))
    emergency_contact_name: Mapped[str | None] = mapped_column(String(SHORT_TEXT))
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(30))
    notes: Mapped[str | None] = mapped_column(String(LONG_TEXT))
    photo_key: Mapped[str | None] = mapped_column(String(100), unique=True)
    photo_type: Mapped[str | None] = mapped_column(String(20))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                 server_default=func.now(), onupdate=func.now())


class AccountChange(Base):
    """Every change to someone's account: role, permissions, on/off, details. Append-only."""

    __tablename__ = "account_changes"
    __table_args__ = (Index("account_changes_user_idx", "user_id", "at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = _user_fk(ondelete="RESTRICT")
    changed_by: Mapped[uuid.UUID | None] = _user_fk(nullable=True, ondelete="RESTRICT")
    change: Mapped[str] = mapped_column(String(30), nullable=False)
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


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
    # Set when the patient stops the medicine. No reminders at or after this moment.
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Reminder(Base):
    """One dose at one moment. Created by a job from medicines. Never confirmed by the server."""

    __tablename__ = "reminders"
    __table_args__ = (
        UniqueConstraint("medicine_id", "scheduled_at", name="reminders_once_per_time"),
        Index("reminders_patient_time_idx", "patient_id", "scheduled_at"),
        Index("reminders_unconfirmed_idx", "scheduled_at",
              postgresql_where=text("acknowledged_at IS NULL")),
        CheckConstraint("acknowledged_at IS NULL OR skipped_at IS NULL",
                        name="reminders_taken_or_skipped"),
    )

    id: Mapped[uuid.UUID] = _id()
    patient_id: Mapped[uuid.UUID] = _user_fk()
    medicine_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("medicines.id", ondelete="CASCADE"), nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # "Skip" on the alarm: the patient chose not to take this dose. Set only by the patient.
    skipped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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
    """A patient's document. Since migration 0005 it can carry an uploaded file
    (older rows are details only). Deleting hides it (deleted_at); the file is kept."""

    __tablename__ = "health_documents"
    __table_args__ = (
        CheckConstraint(_in("category", DOCUMENT_CATEGORIES), name="health_documents_category_valid"),
        # A file's details are all there or all missing.
        CheckConstraint("(file_key IS NULL) = (content_type IS NULL) AND (file_key IS NULL) = (size_bytes IS NULL)",
                        name="health_documents_file_complete"),
        CheckConstraint("content_type IS NULL OR content_type IN ('application/pdf', 'image/jpeg', 'image/png')",
                        name="health_documents_type_valid"),
        CheckConstraint("size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= 10485760)",
                        name="health_documents_size_valid"),
        CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="health_documents_deleted_by"),
        UniqueConstraint("file_key", name="health_documents_file_key_key"),
        Index("health_documents_patient_idx", "patient_id"),
    )

    id: Mapped[uuid.UUID] = _id()
    patient_id: Mapped[uuid.UUID] = _user_fk()
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    recorded_on: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = _created()
    file_key: Mapped[str | None] = mapped_column(String(200))
    content_type: Mapped[str | None] = mapped_column(String(40))
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    file_name: Mapped[str | None] = mapped_column(String(100))
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT", name="health_documents_uploaded_by_fkey"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT", name="health_documents_deleted_by_fkey"))


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


# --- Care plan: daily tasks -------------------------------------------------

class CareTask(Base):
    """Something to do for one client on certain days, planned by a supervisor.

    A task's schedule never changes in place: changing it ends this task and starts a
    new one, so every past day keeps the plan that applied that day.
    """

    __tablename__ = "care_tasks"
    __table_args__ = (
        CheckConstraint("length(trim(title)) > 0", name="care_tasks_title_not_blank"),
        CheckConstraint("cardinality(days) BETWEEN 1 AND 7 AND days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]",
                        name="care_tasks_days_valid"),
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="care_tasks_dates_order"),
        CheckConstraint("grace_minutes BETWEEN 0 AND 720", name="care_tasks_grace_valid"),
        Index("care_tasks_patient_idx", "patient_id"),
    )

    id: Mapped[uuid.UUID] = _id()
    patient_id: Mapped[uuid.UUID] = _user_fk()
    title: Mapped[str] = mapped_column(String(SHORT_TEXT), nullable=False)
    instructions: Mapped[str | None] = mapped_column(String(LONG_TEXT))
    # Local time in the client's time zone; null = any time that day.
    time_of_day: Mapped[time | None] = mapped_column(Time)
    # ISO weekdays: 1 = Monday ... 7 = Sunday.
    days: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    # How long after its time a task counts as missed.
    grace_minutes: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("60"))
    created_by: Mapped[uuid.UUID | None] = _user_fk(nullable=True, ondelete="SET NULL")
    created_at: Mapped[datetime] = _created()
    # Set when the task is removed from the plan (or replaced by a new schedule).
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("care_tasks.id", ondelete="SET NULL", name="care_tasks_replaced_by_fkey"))


class TaskCompletion(Base):
    """A planned task done or skipped on a day, or extra work done (no task)."""

    __tablename__ = "task_completions"
    __table_args__ = (
        CheckConstraint("status IN ('done', 'skipped')", name="task_completions_status_valid"),
        CheckConstraint("status <> 'skipped' OR length(trim(coalesce(reason, ''))) > 0",
                        name="task_completions_skip_has_reason"),
        CheckConstraint("task_id IS NOT NULL OR (status = 'done' AND length(trim(coalesce(title, ''))) > 0)",
                        name="task_completions_extra_has_title"),
        # Each planned task is done (or skipped) once per day.
        Index("task_completions_once_per_day", "task_id", "day", unique=True,
              postgresql_where=text("task_id IS NOT NULL")),
        Index("task_completions_patient_day_idx", "patient_id", "day"),
    )

    id: Mapped[uuid.UUID] = _id()
    patient_id: Mapped[uuid.UUID] = _user_fk()
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("care_tasks.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(200))
    title: Mapped[str | None] = mapped_column(String(SHORT_TEXT))  # extra work only
    note: Mapped[str | None] = mapped_column(String(LONG_TEXT))
    done_by: Mapped[uuid.UUID] = _user_fk(ondelete="RESTRICT")
    done_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class TaskAlert(Base):
    """One row per missed-task alert; the unique key makes "send once" a database rule."""

    __tablename__ = "task_alerts"
    __table_args__ = (
        UniqueConstraint("task_id", "day", "recipient_id", "stage", name="task_alerts_once"),
        CheckConstraint("stage IN ('caregiver', 'supervisor')", name="task_alerts_stage_valid"),
    )

    id: Mapped[uuid.UUID] = _id()
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("care_tasks.id", ondelete="CASCADE"), nullable=False)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    recipient_id: Mapped[uuid.UUID] = _user_fk()
    stage: Mapped[str] = mapped_column(String(12), nullable=False)
    sent_at: Mapped[datetime] = _created()


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


@event.listens_for(User, "before_insert")
def _default_role_for_kind(_mapper, connection, user: User) -> None:
    """Anyone created with a kind but no role (CLI, seed, tests) gets that kind's built-in role."""
    if user.role_id is None and user.role and user.role != "pending":
        user.role_id = connection.execute(
            text("SELECT id FROM roles WHERE kind = :kind AND is_system"), {"kind": user.role}).scalar()
