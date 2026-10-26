from fastapi import APIRouter, Depends, Response
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, current_user, patient_only
from app.core.security import utcnow
from app.db.models import AccessLog, PushToken, Role, User, UserPreferences
from app.services.permissions import effective_permissions
from app.db.session import get_db
from app.schemas.auth import MeOut, MeUpdateIn, UserOut
from app.schemas.base import CamelModel
from app.schemas.common import PersonOut, UtcDateTime
from app.schemas.me import PreferencesIO, PushTokenIn

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=MeOut)
def get_me(me: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> MeOut:
    """Who am I, my role, and what may I do. role "pending" = waiting for a supervisor."""
    out = MeOut.model_validate(me.user)
    role = db.get(Role, me.user.role_id) if me.user.role_id else None
    out.role_name = role.name if role else None
    out.permissions = sorted(effective_permissions(db, me.user))
    return out


@router.patch("", response_model=UserOut)
def update_me(body: MeUpdateIn, me: CurrentUser = Depends(current_user),
              db: Session = Depends(get_db)) -> UserOut:
    """Addition to the contract: change your name or time zone. Role and email cannot change here."""
    user = me.user  # loaded in this same request session
    if body.name is not None:
        user.name = body.name
    if body.timezone is not None:
        user.timezone = body.timezone
    db.commit()
    return UserOut.model_validate(user)


def _preferences(db: Session, me: CurrentUser) -> UserPreferences:
    prefs = db.get(UserPreferences, me.id)
    if prefs is None:
        prefs = UserPreferences(user_id=me.id)
        db.add(prefs)
        db.flush()
        db.refresh(prefs)
    return prefs


@router.get("/preferences", response_model=PreferencesIO)
def get_preferences(me: CurrentUser = Depends(current_user),
                    db: Session = Depends(get_db)) -> PreferencesIO:
    prefs = _preferences(db, me)
    db.commit()
    return PreferencesIO.model_validate(prefs)


@router.put("/preferences", response_model=PreferencesIO)
def put_preferences(body: PreferencesIO, me: CurrentUser = Depends(current_user),
                    db: Session = Depends(get_db)) -> PreferencesIO:
    prefs = _preferences(db, me)
    prefs.larger_text = body.larger_text
    prefs.reminder_notifications = body.reminder_notifications
    prefs.missed_dose_email = body.missed_dose_email
    prefs.missed_dose_call = body.missed_dose_call
    db.commit()
    return PreferencesIO.model_validate(prefs)


@router.put("/push-token", status_code=204)
def put_push_token(body: PushTokenIn, me: CurrentUser = Depends(current_user),
                   db: Session = Depends(get_db)) -> Response:
    """Save this phone's push token. A token moves to whoever signed in on that phone last."""
    db.execute(insert(PushToken).values(user_id=me.id, token=body.token)
               .on_conflict_do_update(index_elements=[PushToken.token],
                                      set_={"user_id": me.id, "updated_at": utcnow()}))
    db.commit()
    return Response(status_code=204)


@router.delete("/push-token", status_code=204)
def delete_push_token(body: PushTokenIn, me: CurrentUser = Depends(current_user),
                      db: Session = Depends(get_db)) -> Response:
    """Addition: call on sign-out so this phone stops getting notifications."""
    db.execute(delete(PushToken).where(PushToken.user_id == me.id, PushToken.token == body.token))
    db.commit()
    return Response(status_code=204)


class AccessLogEntryOut(CamelModel):
    at: UtcDateTime
    viewer: PersonOut
    action: str


@router.get("/access-log", response_model=list[AccessLogEntryOut])
def my_access_log(me: CurrentUser = Depends(patient_only),
                  db: Session = Depends(get_db)) -> list[AccessLogEntryOut]:
    """Addition: patients see who has looked at their data (caregivers, supervisors, admins).

    The latest 200 views. Gives patients transparency about staff access (issue 11's
    consent question)."""
    rows = db.execute(select(AccessLog, User).join(User, User.id == AccessLog.viewer_id)
                      .where(AccessLog.patient_id == me.id, AccessLog.outcome == "allowed",
                             AccessLog.viewer_id != me.id)
                      .order_by(AccessLog.at.desc(), AccessLog.id.desc()).limit(200))
    return [AccessLogEntryOut(at=log.at, viewer=PersonOut.model_validate(viewer), action=log.action)
            for log, viewer in rows]
