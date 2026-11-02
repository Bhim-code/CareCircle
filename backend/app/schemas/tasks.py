import re
import uuid
from datetime import date
from datetime import time as TimeOfDay
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator, model_validator

from app.schemas.base import CamelModel
from app.schemas.common import PersonOut, UtcDateTime

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Days = Annotated[list[int], Field(min_length=1, max_length=7)]
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _parse_time(value: str | None) -> TimeOfDay | None:
    if value is None or value == "":
        return None
    if not _HHMM.match(value):
        raise ValueError("Use 24-hour time like 09:00, or leave empty for any time.")
    hours, minutes = value.split(":")
    return TimeOfDay(int(hours), int(minutes))


class CareTaskIn(CamelModel):
    title: Title
    instructions: LongText | None = None
    # "HH:MM" in the client's time zone; null = any time that day.
    time: str | None = None
    # ISO weekdays 1 = Monday ... 7 = Sunday. Default: every day.
    days: Days = [1, 2, 3, 4, 5, 6, 7]
    start_date: date | None = None  # default: today (client's time)
    end_date: date | None = None
    grace_minutes: Annotated[int, Field(ge=0, le=720)] = 60

    @field_validator("days")
    @classmethod
    def _days(cls, value: list[int]) -> list[int]:
        if any(d < 1 or d > 7 for d in value) or len(set(value)) != len(value):
            raise ValueError("Days are 1 (Monday) to 7 (Sunday), each once.")
        return sorted(value)

    @field_validator("time")
    @classmethod
    def _time(cls, value: str | None) -> str | None:
        _parse_time(value)
        return value or None

    @model_validator(mode="after")
    def _dates(self) -> "CareTaskIn":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("endDate cannot be before startDate.")
        return self

    def parsed_time(self) -> TimeOfDay | None:
        return _parse_time(self.time)


class CareTaskAppIn(CareTaskIn):
    # Caregivers with more than one linked patient say which one.
    patient_id: uuid.UUID | None = None


class CareTaskUpdateIn(CamelModel):
    """Send only what changes. Title and instructions change in place; changing the
    schedule (time, days, endDate, graceMinutes) starts a new version of the task from now."""

    title: Title | None = None
    instructions: LongText | None = None
    time: str | None = None
    days: Days | None = None
    end_date: date | None = None
    grace_minutes: Annotated[int, Field(ge=0, le=720)] | None = None

    @field_validator("time")
    @classmethod
    def _time(cls, value: str | None) -> str | None:
        _parse_time(value)
        return value or None

    @field_validator("days")
    @classmethod
    def _days(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return value
        if any(d < 1 or d > 7 for d in value) or len(set(value)) != len(value):
            raise ValueError("Days are 1 (Monday) to 7 (Sunday), each once.")
        return sorted(value)


class CareTaskOut(CamelModel):
    id: uuid.UUID
    patient_id: uuid.UUID
    title: str
    instructions: str | None
    time: str | None
    days: list[int]
    start_date: date
    end_date: date | None
    grace_minutes: int
    created_at: UtcDateTime
    ended_at: UtcDateTime | None
    replaced_by: uuid.UUID | None
    # Who added the task (a supervisor, or a caregiver with the tasks.plan permission).
    created_by: PersonOut | None = None


class CompletionOut(CamelModel):
    status: Literal["done", "skipped"]
    reason: str | None
    note: str | None
    done_by: PersonOut
    done_at: UtcDateTime


class OccurrenceOut(CamelModel):
    task_id: uuid.UUID
    title: str
    instructions: str | None
    time: str | None
    due_at: UtcDateTime | None
    status: Literal["upcoming", "due", "done", "late", "skipped", "missed"]
    completion: CompletionOut | None


class ExtraOut(CamelModel):
    id: uuid.UUID
    title: str
    note: str | None
    done_by: PersonOut
    done_at: UtcDateTime


class DayCounts(CamelModel):
    done: int = 0
    late: int = 0
    skipped: int = 0
    missed: int = 0
    due: int = 0
    upcoming: int = 0


class PatientDayOut(CamelModel):
    patient: PersonOut
    day: date
    tasks: list[OccurrenceOut]
    extras: list[ExtraOut]
    counts: DayCounts


class CompleteIn(CamelModel):
    day: date | None = None  # default: today in the client's time zone
    status: Literal["done", "skipped"] = "done"
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    note: LongText | None = None


class ExtraIn(CamelModel):
    patient_id: uuid.UUID | None = None
    title: Title
    note: LongText | None = None
    day: date | None = None
