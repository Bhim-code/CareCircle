"""Written records: incident, medical, behavioural, medication (issue 7)."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator

from app.schemas.base import CamelModel
from app.schemas.common import PersonOut, UtcDateTime

Kind = Literal["medical", "behavioural", "incident", "medication"]
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]
Long = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]

# Which fields belong to which kind. Anything else must be null.
ONLY_FOR = {"severity": "incident", "mood": "behavioural", "medicine_name": "medication"}
# Who may write which kind is now a permission (entries.write.<kind>), set per role
# in the admin panel. The defaults match api-contract.md (app/core/permissions.py).
FUTURE_ALLOWANCE = timedelta(minutes=1)


class EntryIn(CamelModel):
    kind: Kind
    client_name: Short | None = None
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    notes: Long | None = None
    occurred_at: UtcDateTime
    witness_name: Short | None = None
    location: Short | None = None
    severity: Literal["minor", "moderate", "serious"] | None = None
    action_taken: Long | None = None
    mood: Literal["calm", "happy", "anxious", "confused", "agitated", "withdrawn"] | None = None
    medicine_name: Short | None = None
    photo_uri: Annotated[str, Field(max_length=600)] | None = None
    # Addition to the contract: which patient this is about. Optional for patients
    # (always themselves) and for caregivers with exactly one linked patient.
    patient_id: uuid.UUID | None = None

    @field_validator("client_name", "notes", "witness_name", "location", "action_taken",
                     "medicine_name", mode="after")
    @classmethod
    def _blank_is_null(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("occurred_at")
    @classmethod
    def _not_in_future(cls, value: datetime) -> datetime:
        if value > datetime.now(UTC) + FUTURE_ALLOWANCE:
            raise ValueError("This cannot be in the future.")
        return value


class EntryOut(CamelModel):
    id: uuid.UUID
    patient_id: uuid.UUID
    kind: Kind
    client_name: str | None
    title: str
    notes: str | None
    occurred_at: UtcDateTime
    witness_name: str | None
    location: str | None
    severity: str | None
    action_taken: str | None
    mood: str | None
    medicine_name: str | None
    photo_uri: str | None
    recorded_at: UtcDateTime
    recorded_by: PersonOut
    edited_at: UtcDateTime | None
    edited_by: PersonOut | None
