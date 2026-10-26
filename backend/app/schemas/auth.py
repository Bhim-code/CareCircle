import uuid
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator, EmailStr, Field, StringConstraints

from app.schemas.base import CamelModel

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
# 8 to match the app's sign-up form; 128 stops someone sending megabytes to the hasher.
Password = Annotated[str, Field(min_length=8, max_length=128)]
Email = Annotated[EmailStr, Field(max_length=254), AfterValidator(lambda v: v.lower())]


def _valid_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Unknown time zone. Use a name such as America/St_Johns.") from None
    return value


TimeZoneName = Annotated[str, Field(max_length=64), AfterValidator(_valid_timezone)]


class SignUpIn(CamelModel):
    name: Name
    email: Email
    password: Password
    # Optional, and only a hint: every new account waits ("pending") until a supervisor
    # assigns a role. Admin and supervisor are refused (422).
    role: Literal["patient", "caregiver"] | None = None
    # Optional addition to the contract: the phone's time zone, for reminder times.
    timezone: TimeZoneName = "UTC"


class SignInIn(CamelModel):
    email: Annotated[str, Field(max_length=254)]
    password: Annotated[str, Field(max_length=128)]


class RefreshIn(CamelModel):
    refresh_token: Annotated[str, Field(max_length=200)]


class PasswordResetIn(CamelModel):
    email: Annotated[str, Field(max_length=254)]


class PasswordResetConfirmIn(CamelModel):
    token: Annotated[str, Field(max_length=200)]
    new_password: Password


class UserOut(CamelModel):
    id: uuid.UUID
    email: str
    name: str
    # patient | caregiver | supervisor | admin, or "pending" while waiting for a role.
    role: str
    timezone: str


class MeOut(UserOut):
    # The role's name (e.g. "Night nurse"); null while pending.
    role_name: str | None = None
    # Everything this person may do (role permissions + their own extra ones).
    permissions: list[str] = []


class TokensOut(CamelModel):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: Literal["Bearer"] = "Bearer"


class SessionOut(TokensOut):
    user: UserOut


class MeUpdateIn(CamelModel):
    name: Name | None = None
    timezone: TimeZoneName | None = None
