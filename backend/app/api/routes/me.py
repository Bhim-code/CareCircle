from fastapi import APIRouter, Depends, Response
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, current_user
from app.core.security import utcnow
from app.db.models import PushToken, UserPreferences
from app.db.session import get_db
from app.schemas.auth import MeUpdateIn, UserOut
from app.schemas.me import PreferencesIO, PushTokenIn

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserOut)
def get_me(me: CurrentUser = Depends(current_user)) -> UserOut:
    return UserOut.model_validate(me.user)


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
