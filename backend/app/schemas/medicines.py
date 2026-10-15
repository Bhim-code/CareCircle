import re
import uuid
from datetime import date
from typing import Annotated

from pydantic import Field, StringConstraints, field_validator, model_validator

from app.schemas.base import CamelModel
from app.schemas.common import UtcDateTime

_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class MedicineIn(CamelModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    # Local times in the patient's time zone, "HH:MM", 24-hour.
    times: Annotated[list[str], Field(min_length=1, max_length=12)]
    start_date: date
    end_date: date | None = None

    @field_validator("times")
    @classmethod
    def _valid_times(cls, value: list[str]) -> list[str]:
        for item in value:
            if not _TIME.match(item):
                raise ValueError("Use 24-hour times like 08:00 or 20:30.")
        if len(set(value)) != len(value):
            raise ValueError("Each time can appear only once.")
        return sorted(value)

    @model_validator(mode="after")
    def _dates_in_order(self) -> "MedicineIn":
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("endDate cannot be before startDate.")
        return self


class MedicineOut(CamelModel):
    id: uuid.UUID
    name: str
    times: list[str]
    start_date: date
    end_date: date | None


class ReminderOut(CamelModel):
    """Exactly the contract shape. The app works out upcoming / due / missed itself."""

    id: uuid.UUID
    medicine_name: str
    scheduled_at: UtcDateTime
    acknowledged: bool
