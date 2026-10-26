import uuid
from datetime import date
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import StringConstraints

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


class CompanyRef(CamelModel):
    id: uuid.UUID
    name: str


class CompanyOut(CompanyRef):
    patients: int
    caregivers: int
    supervisors: int
    created_at: UtcDateTime


class CompanyIn(CamelModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class OverviewOut(CamelModel):
    # The company these numbers cover (a supervisor's own); null = every company (admin).
    company: CompanyRef | None
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
    # The role's kind (patient | caregiver | supervisor | admin) or "pending".
    role: str
    role_id: uuid.UUID | None = None
    role_name: str | None = None
    # What they asked for at sign-up while pending (a hint only).
    requested_role: str | None = None
    is_active: bool
    timezone: str
    company: CompanyRef | None = None
    photo_uri: str | None = None
    created_at: UtcDateTime


class CaregiverPatientOut(CamelModel):
    id: uuid.UUID
    name: str
    email: str
    linked_since: UtcDateTime | None
    adherence_last_7_days: float | None


class CaregiverDetailOut(CamelModel):
    caregiver: AdminUserOut
    patients: list[CaregiverPatientOut]
    # Linked patients who belong to another company (names hidden from supervisors).
    other_company_patients: int
    entries_written_last_7_days: int

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


# --- people, roles and permissions -------------------------------------------

Phone = Annotated[str, StringConstraints(strip_whitespace=True, max_length=30, pattern=r"^[0-9 +()\-.]*$")]


class ProfileFields(CamelModel):
    phone: Phone | None = None
    date_of_birth: date | None = None
    address: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] | None = None
    emergency_contact_name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None
    emergency_contact_phone: Phone | None = None
    notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None = None


class PersonCreateIn(ProfileFields):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    email: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254,
                                            pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    # null = waiting for a role
    role_id: uuid.UUID | None = None


class PersonUpdateIn(ProfileFields):
    """Send only what changes. Details need people.edit, isActive people.deactivate,
    organizationId an admin."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)] | None = None
    is_active: bool | None = None
    organization_id: uuid.UUID | None = None


class RoleAssignIn(CamelModel):
    role_id: uuid.UUID


class PermissionsIn(CamelModel):
    permissions: list[Annotated[str, StringConstraints(max_length=60)]]


class PermissionOut(CamelModel):
    code: str
    group: str
    description: str


class RoleOut(CamelModel):
    id: uuid.UUID
    name: str
    kind: str
    description: str
    is_system: bool
    permissions: list[str]
    people: int


class RoleIn(CamelModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    kind: Literal["patient", "caregiver", "supervisor"]
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    permissions: list[Annotated[str, StringConstraints(max_length=60)]] = []


class RoleUpdateIn(CamelModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)] | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    permissions: list[Annotated[str, StringConstraints(max_length=60)]] | None = None


class ChangeOut(CamelModel):
    at: UtcDateTime
    change: str
    by: PersonWithEmailOut | None
    before: dict | None
    after: dict | None


class ProfileOut(ProfileFields):
    person: AdminUserOut
    role_permissions: list[str]
    extra_permissions: list[str]
    effective_permissions: list[str]
    active_links: int
    history: list[ChangeOut]


class StaffMeOut(CamelModel):
    person: AdminUserOut
    permissions: list[str]
