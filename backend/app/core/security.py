"""Passwords, access tokens and refresh tokens."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

# argon2id with the library's recommended settings. Tests use cheap settings to stay fast;
# hashes made either way verify fine, because the settings are stored inside each hash.
_hasher = (PasswordHasher(time_cost=1, memory_cost=1024, parallelism=1)
           if get_settings().environment == "test" else PasswordHasher())
# Checked against when the email is unknown, so both cases take the same time.
_DUMMY_HASH = _hasher.hash("not-a-real-password-" + secrets.token_hex(8))
_ALGORITHM = "HS256"


def utcnow() -> datetime:
    return datetime.now(UTC)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_opaque_token() -> str:
    """A random token for refresh and password-reset links. Only its hash is stored."""
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_access_token(user_id: uuid.UUID, role: str, session_family: uuid.UUID) -> tuple[str, int]:
    settings = get_settings()
    lifetime = timedelta(minutes=settings.access_token_minutes)
    now = utcnow()
    claims = {
        "sub": str(user_id),
        "role": role,
        "sid": str(session_family),
        "typ": "access",
        "iat": now,
        "exp": now + lifetime,
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=_ALGORITHM), int(lifetime.total_seconds())


def decode_access_token(token: str) -> dict | None:
    try:
        claims = jwt.decode(token, get_settings().jwt_secret, algorithms=[_ALGORITHM],
                            options={"require": ["sub", "sid", "exp", "typ"]})
    except jwt.PyJWTError:
        return None
    return claims if claims.get("typ") == "access" else None
