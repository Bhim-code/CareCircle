import uuid
from typing import Literal

from app.schemas.auth import Email
from app.schemas.base import CamelModel
from app.schemas.common import PersonWithEmailOut, UtcDateTime


class InvitationIn(CamelModel):
    email: Email


class CareLinkOut(CamelModel):
    id: uuid.UUID
    status: Literal["pending", "active", "ended"]
    invited_email: str
    patient: PersonWithEmailOut
    caregiver: PersonWithEmailOut | None
    created_at: UtcDateTime
    accepted_at: UtcDateTime | None
    ended_at: UtcDateTime | None
