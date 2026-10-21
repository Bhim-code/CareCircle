"""Who is asking? Every protected endpoint starts here.

`current_user` checks the access token, that the account is still active, and
that the sign-in session has not been ended. So signing out or deactivating an
account takes effect on the very next request, not when the token expires.
"""

import uuid
from collections.abc import Callable
from datetime import datetime

from fastapi import Depends, Request
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.security import decode_access_token, utcnow
from app.db.models import AuthSession, User
from app.db.session import get_db

_UNAUTHENTICATED = {"WWW-Authenticate": "Bearer"}


class CurrentUser:
    """The signed-in user plus the sign-in session they used."""

    def __init__(self, user: User, session_family: uuid.UUID) -> None:
        self.user = user
        self.session_family = session_family

    @property
    def id(self) -> uuid.UUID:
        return self.user.id

    @property
    def role(self) -> str:
        return self.user.role


def _session_is_live(db: Session, family: uuid.UUID, now: datetime) -> bool:
    return db.scalar(select(exists().where(
        AuthSession.family_id == family,
        AuthSession.revoked_at.is_(None),
        AuthSession.expires_at > now,
    ))) or False


def current_user(request: Request, db: Session = Depends(get_db)) -> CurrentUser:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise ApiError(401, headers=_UNAUTHENTICATED)

    claims = decode_access_token(token.strip())
    if claims is None:
        raise ApiError(401, headers=_UNAUTHENTICATED)
    try:
        user_id = uuid.UUID(claims["sub"])
        family = uuid.UUID(claims["sid"])
    except ValueError:
        raise ApiError(401, headers=_UNAUTHENTICATED) from None

    user = db.get(User, user_id)
    if user is None or not user.is_active or not _session_is_live(db, family, utcnow()):
        raise ApiError(401, headers=_UNAUTHENTICATED)
    return CurrentUser(user, family)


def require_roles(*roles: str) -> Callable[..., CurrentUser]:
    """Dependency: 403 unless the signed-in user has one of these roles."""

    def check(me: CurrentUser = Depends(current_user)) -> CurrentUser:
        if me.role not in roles:
            raise ApiError(403)
        return me

    return check


patient_only = require_roles("patient")
caregiver_only = require_roles("caregiver")
patient_or_caregiver = require_roles("patient", "caregiver")
staff_only = require_roles("admin", "supervisor")
admin_only = require_roles("admin")
