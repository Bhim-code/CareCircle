from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from app.schemas.base import CamelModel


SnoozeMinutes = Literal[5, 10, 15]


class PreferencesOut(CamelModel):
    """The four switches in api-contract.md, plus the medicine alarm's settings."""

    larger_text: bool
    reminder_notifications: bool
    missed_dose_email: bool
    missed_dose_call: bool
    alarm_sound: bool
    alarm_vibration: bool
    snooze_minutes: SnoozeMinutes


class PreferencesIn(CamelModel):
    """The four contract switches are required on PUT. The alarm settings are optional:
    left out, they keep their saved value, so an older app that sends only the four
    does not reset them."""

    larger_text: bool
    reminder_notifications: bool
    missed_dose_email: bool
    missed_dose_call: bool
    alarm_sound: bool | None = None
    alarm_vibration: bool | None = None
    snooze_minutes: SnoozeMinutes | None = None


class PushTokenIn(CamelModel):
    token: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1), Field(max_length=512)]
