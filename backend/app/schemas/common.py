import uuid
from datetime import UTC, datetime
from typing import Annotated

from pydantic import AwareDatetime, PlainSerializer

from app.schemas.base import CamelModel


def _iso_utc(value: datetime) -> str:
    """2026-10-15T14:30:00.000Z, as api-contract.md shows."""
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# Every date-time leaving the API is UTC with a Z. Incoming ones must carry a zone.
UtcDateTime = Annotated[AwareDatetime, PlainSerializer(_iso_utc, return_type=str)]


class PersonOut(CamelModel):
    id: uuid.UUID
    name: str
    role: str


class PersonWithEmailOut(PersonOut):
    email: str
