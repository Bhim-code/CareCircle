"""Issue 4: a patient invites a caregiver by email; the caregiver accepts.

A caregiver can see a patient's data only while their link is ACTIVE.
Ending a link (either side) removes that access on the very next request.
"""

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.api.deps import CurrentUser, caregiver_only, current_user, patient_only
from app.core.errors import ApiError
from app.core.security import utcnow
from app.db.models import CareLink, User
from app.db.session import get_db
from app.schemas.care_links import CareLinkOut, InvitationIn
from app.schemas.common import PersonWithEmailOut
from app.services.mailer import send_email

router = APIRouter(prefix="/care-links", tags=["care links"])


def _out(link: CareLink, patient: User, caregiver: User | None) -> CareLinkOut:
    return CareLinkOut(
        id=link.id, status=link.status, invited_email=link.invited_email,
        patient=PersonWithEmailOut.model_validate(patient),
        caregiver=PersonWithEmailOut.model_validate(caregiver) if caregiver else None,
        created_at=link.created_at, accepted_at=link.accepted_at, ended_at=link.ended_at,
    )


def _visible_to(me: User):
    """Links this person is part of: as the patient, the caregiver, or the invited email."""
    conditions = [CareLink.patient_id == me.id, CareLink.caregiver_id == me.id]
    if me.role == "caregiver":
        conditions.append(and_(CareLink.status == "pending", CareLink.invited_email == me.email))
    return or_(*conditions)


@router.post("/invitations", response_model=CareLinkOut, status_code=201,
             responses={409: {"description": "Already invited or linked."}})
def invite(body: InvitationIn, me: CurrentUser = Depends(patient_only),
           db: Session = Depends(get_db)) -> CareLinkOut:
    """Patient only. The person invited may not have an account yet; they see the
    invitation after signing up as a caregiver with this email."""
    if body.email == me.user.email:
        raise ApiError(422, "You cannot invite yourself.", fields={"email": "Use someone else's email."})
    link = CareLink(patient_id=me.id, invited_email=body.email, status="pending")
    db.add(link)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "This person is already invited or linked.", code="already_linked") from None
    db.refresh(link)
    send_email(body.email, "You have been invited to CareCircle",
               f"{me.user.name} has invited you to help look after them on CareCircle.\n\n"
               f"Sign in (or sign up as a caregiver) with this email address to accept.")
    return _out(link, me.user, None)


@router.get("", response_model=list[CareLinkOut])
def list_links(include_ended: bool = Query(False, alias="includeEnded"),
               me: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> list[CareLinkOut]:
    """Everyone linked to (or invited by / invited to) the signed-in person."""
    if me.role not in ("patient", "caregiver"):
        return []
    patient, caregiver = aliased(User), aliased(User)
    query = (select(CareLink, patient, caregiver)
             .join(patient, patient.id == CareLink.patient_id)
             .outerjoin(caregiver, caregiver.id == CareLink.caregiver_id)
             .where(_visible_to(me.user))
             .order_by(CareLink.created_at.desc()))
    if not include_ended:
        query = query.where(CareLink.status != "ended")
    return [_out(link, p, c) for link, p, c in db.execute(query)]


@router.post("/invitations/{link_id}/accept", response_model=CareLinkOut)
def accept(link_id: uuid.UUID, me: CurrentUser = Depends(caregiver_only),
           db: Session = Depends(get_db)) -> CareLinkOut:
    """Caregiver only, and only an invitation sent to their own email. Otherwise 404."""
    link = db.scalar(select(CareLink).where(
        CareLink.id == link_id, CareLink.status == "pending",
        CareLink.invited_email == me.user.email).with_for_update())
    patient = db.get(User, link.patient_id) if link else None
    if link is None or patient is None or not patient.is_active:
        raise ApiError(404)
    link.status = "active"
    link.caregiver_id = me.id
    link.accepted_at = utcnow()
    db.commit()
    return _out(link, patient, me.user)


@router.delete("/{link_id}", status_code=204)
def end_link(link_id: uuid.UUID, me: CurrentUser = Depends(current_user),
             db: Session = Depends(get_db)) -> Response:
    """Either side ends a link, cancels an invitation, or declines one. 404 if not yours."""
    link = db.scalar(select(CareLink).where(CareLink.id == link_id, CareLink.status != "ended",
                                            _visible_to(me.user)).with_for_update())
    if link is None:
        raise ApiError(404)
    link.status = "ended"
    link.ended_at = utcnow()
    link.ended_by = me.id
    db.commit()
    return Response(status_code=204)

