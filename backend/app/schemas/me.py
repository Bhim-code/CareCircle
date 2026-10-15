from typing import Annotated

from pydantic import Field, StringConstraints

from app.schemas.base import CamelModel


class PreferencesIO(CamelModel):
    """Exactly the four switches in api-contract.md. All are required on PUT."""

    larger_text: bool
    reminder_notifications: bool
    missed_dose_email: bool
    missed_dose_call: bool


class PushTokenIn(CamelModel):
    token: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1), Field(max_length=512)]
