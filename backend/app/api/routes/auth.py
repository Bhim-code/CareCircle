from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, current_user
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.rate_limit import enforce
from app.core.security import (
    hash_password,
    needs_rehash,
    new_opaque_token,
    token_hash,
    utcnow,
    verify_password,
)
from app.db.models import PasswordResetToken, User, UserPreferences
from app.db.session import get_db
from app.schemas.auth import (
    PasswordResetConfirmIn,
    PasswordResetIn,
    RefreshIn,
    SessionOut,
    SignInIn,
    SignUpIn,
    TokensOut,
)
from app.services import auth as sessions
from app.services.mailer import send_email

router = APIRouter(prefix="/auth", tags=["sign-in"])

_BAD_LOGIN = "Email or password is incorrect."
_401 = {401: {"description": "Not signed in, or the token is no longer valid."}}


@router.post("/sign-up", response_model=SessionOut, status_code=201,
             responses={409: {"description": "An account already uses this email."}})
def sign_up(body: SignUpIn, request: Request, db: Session = Depends(get_db)) -> SessionOut:
    """Create a patient or caregiver account and sign in. Admin and supervisor are refused (422)."""
    enforce(request, "sign-up", limit=10, window_seconds=3600)
    user = User(email=body.email, name=body.name, role=body.role,
                password_hash=hash_password(body.password), timezone=body.timezone)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "An account with this email already exists.",
                       code="email_taken", fields={"email": "This email is already registered."}) from None
    db.add(UserPreferences(user_id=user.id))
    return sessions.start_session(db, user)


@router.post("/sign-in", response_model=SessionOut, responses=_401)
def sign_in(body: SignInIn, request: Request, db: Session = Depends(get_db)) -> SessionOut:
    """Same 401 and message for a wrong password, an unknown email or a deactivated account."""
    email = body.email.strip().lower()
    enforce(request, "sign-in", 10, 60)              # per IP
    enforce(request, "sign-in-email", 5, 60, email)  # per account, slows password guessing
    user = db.scalar(select(User).where(User.email == email))
    if not verify_password(body.password, user.password_hash if user else None) or not user.is_active:
        raise ApiError(401, _BAD_LOGIN)
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    return sessions.start_session(db, user)


@router.post("/refresh", response_model=TokensOut, responses=_401)
def refresh(body: RefreshIn, request: Request, db: Session = Depends(get_db)) -> TokensOut:
    """Returns a new access token AND a new refresh token. The old refresh token stops working."""
    enforce(request, "refresh", 30, 60)
    return sessions.refresh_session(db, body.refresh_token)


@router.post("/sign-out", status_code=204, responses=_401)
def sign_out(me: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    """Ends this sign-in: its access and refresh tokens stop working at once."""
    sessions.end_family(db, me.session_family)
    db.commit()
    return Response(status_code=204)


@router.post("/password-reset", status_code=204)
def request_password_reset(body: PasswordResetIn, request: Request,
                           db: Session = Depends(get_db)) -> Response:
    """Always 204, so nobody can find out whether an email has an account."""
    email = body.email.strip().lower()
    enforce(request, "password-reset", 5, 3600)
    enforce(request, "password-reset-email", 3, 3600, email)
    user = db.scalar(select(User).where(User.email == email))
    if user is not None and user.is_active:
        token = new_opaque_token()
        minutes = get_settings().password_reset_minutes
        db.add(PasswordResetToken(user_id=user.id, token_hash=token_hash(token),
                                  expires_at=utcnow() + timedelta(minutes=minutes)))
        db.commit()
        link = f"{get_settings().password_reset_url}?token={token}"
        send_email(user.email, "Reset your CareCircle password",
                   f"Hello {user.name},\n\nTo choose a new password, open this link within "
                   f"{minutes} minutes:\n\n{link}\n\nIf you did not ask for this, ignore this email.")
    return Response(status_code=204)


@router.post("/password-reset/confirm", status_code=204,
             responses={422: {"description": "The link is invalid, used or expired."}})
def confirm_password_reset(body: PasswordResetConfirmIn, request: Request,
                           db: Session = Depends(get_db)) -> Response:
    """Addition to the contract: set the new password from the emailed link.

    Signs the person out everywhere, in case someone else had their password.
    """
    enforce(request, "password-reset-confirm", 10, 3600)
    now = utcnow()
    row = db.scalar(select(PasswordResetToken)
                    .where(PasswordResetToken.token_hash == token_hash(body.token)).with_for_update())
    user = db.get(User, row.user_id) if row else None
    if row is None or row.used_at is not None or row.expires_at <= now or user is None \
            or not user.is_active:
        raise ApiError(422, "This reset link is invalid or has expired.",
                       fields={"token": "Ask for a new reset link."})
    row.used_at = now
    user.password_hash = hash_password(body.new_password)
    sessions.end_all_sessions(db, user.id)
    # Any other unused links for this account stop working too.
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id,
                                        PasswordResetToken.used_at.is_(None)) \
        .update({PasswordResetToken.used_at: now})
    db.commit()
    return Response(status_code=204)
