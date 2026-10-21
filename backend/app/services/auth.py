"""Sign-in sessions: create, refresh (with rotation), end."""

import uuid
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.security import create_access_token, new_opaque_token, token_hash, utcnow
from app.db.models import AuthSession, User
from app.schemas.auth import SessionOut, TokensOut, UserOut


def _issue(db: Session, user: User, family: uuid.UUID) -> TokensOut:
    refresh = new_opaque_token()
    db.add(AuthSession(
        user_id=user.id,
        family_id=family,
        token_hash=token_hash(refresh),
        expires_at=utcnow() + timedelta(days=get_settings().refresh_token_days),
    ))
    access, expires_in = create_access_token(user.id, user.role, family)
    return TokensOut(access_token=access, refresh_token=refresh, expires_in=expires_in)


def start_session(db: Session, user: User) -> SessionOut:
    tokens = _issue(db, user, uuid.uuid4())
    db.commit()
    return SessionOut(**tokens.model_dump(), user=UserOut.model_validate(user))


def refresh_session(db: Session, refresh_token: str) -> TokensOut:
    """Swap a refresh token for a new pair. Each refresh token works once.

    If an already-used token comes back, someone else has a copy: end the whole
    sign-in (both the thief's and the owner's tokens stop working).
    """
    now = utcnow()
    row = db.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash(refresh_token))
                    .with_for_update())
    if row is None:
        raise ApiError(401)
    if row.rotated_at is not None and row.revoked_at is None:
        end_family(db, row.family_id)
        db.commit()
        raise ApiError(401)
    if row.revoked_at is not None or row.expires_at <= now:
        raise ApiError(401)

    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise ApiError(401)

    row.rotated_at = now
    tokens = _issue(db, user, row.family_id)
    db.commit()
    return tokens


def end_family(db: Session, family: uuid.UUID) -> None:
    db.execute(update(AuthSession).where(AuthSession.family_id == family,
                                         AuthSession.revoked_at.is_(None))
               .values(revoked_at=utcnow()))


def end_all_sessions(db: Session, user_id: uuid.UUID) -> None:
    db.execute(update(AuthSession).where(AuthSession.user_id == user_id,
                                         AuthSession.revoked_at.is_(None))
               .values(revoked_at=utcnow()))
