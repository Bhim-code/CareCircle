import uuid
from datetime import date
from typing import Generic, Literal, TypeVar

from app.schemas.base import CamelModel
from app.schemas.common import PersonWithEmailOut, UtcDateTime

T = TypeVar("T")


class Page(CamelModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class RemindersToday(CamelModel):
    total: int
    taken: int
    missed: int
    due: int
    upcoming: int


class OverviewOut(CamelModel):
    patients: int
    caregivers: int
    active_links: int
    reminders_today: RemindersToday
    # Share of doses confirmed out of those that were due, last 7 days. Null if none were due.
    adherence_last_7_days: float | None
    entries_last_7_days: int


class AdminUserOut(CamelModel):
    id: uuid.UUID
    name: str
    email: str
    role: str
    is_active: bool
    timezone: str
    created_at: UtcDateTime


class UserUpdateIn(CamelModel):
    is_active: bool


class AdminMedicineOut(CamelModel):
    id: uuid.UUID
    name: str
    times: list[str]
    start_date: date
    end_date: date | None
    stopped_at: UtcDateTime | None


class PatientDetailOut(CamelModel):
    patient: AdminUserOut
    caregivers: list[PersonWithEmailOut]
    medicines: list[AdminMedicineOut]
    adherence_last_7_days: float | None
    entries_total: int
    documents_total: int


class AdminReminderOut(CamelModel):
    id: uuid.UUID
    medicine_name: str
    scheduled_at: UtcDateTime
    acknowledged_at: UtcDateTime | None
    status: Literal["upcoming", "due", "taken", "missed"]


class AdminDocumentOut(CamelModel):
    id: uuid.UUID
    title: str
    category: str
    recorded_on: date | None


class AccessLogOut(CamelModel):
    id: int
    at: UtcDateTime
    viewer: PersonWithEmailOut
    patient: PersonWithEmailOut | None
    action: str
    outcome: Literal["allowed", "denied"]
