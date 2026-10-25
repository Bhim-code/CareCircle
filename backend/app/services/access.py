"""The one place that answers "may this person see this patient's data?".

Every endpoint that touches patient data goes through these functions, so the
rules live in one file and the security tests exercise them all.

  patient    -> only themselves
  caregiver  -> only patients with an ACTIVE care link to them
  admin / supervisor -> every patient, read only, and every view is logged
                        (admin endpoints, see app/api/routes/admin.py)
"""

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.db.models import AccessLog, CareLink, User

logger = logging.getLogger("carecircle.access")


def caregiver_is_linked(db: Session, caregiver_id: uuid.UUID, patient_id: uuid.UUID) -> bool:
    """An ACTIVE link to a patient whose account is still turned on."""
    return db.scalar(
        select(CareLink.id).join(User, User.id == CareLink.patient_id).where(
            CareLink.caregiver_id == caregiver_id,
            CareLink.patient_id == patient_id,
            CareLink.status == "active",
            User.is_active.is_(True),
        ).limit(1)
    ) is not None


def linked_patient_ids(db: Session, caregiver_id: uuid.UUID) -> list[uuid.UUID]:
    return list(db.scalars(
        select(CareLink.patient_id).join(User, User.id == CareLink.patient_id).where(
            CareLink.caregiver_id == caregiver_id,
            CareLink.status == "active",
            User.is_active.is_(True),
        )
    ))


def readable_patient_ids(db: Session, user: User) -> list[uuid.UUID]:
    """Patients whose records this person may read in the app (not the admin panel)."""
    if user.role == "patient":
        return [user.id]
    if user.role == "caregiver":
        return linked_patient_ids(db, user.id)
    return []


def can_read_patient(db: Session, user: User, patient_id: uuid.UUID) -> bool:
    if user.role == "patient":
        return user.id == patient_id
    if user.role == "caregiver":
        return caregiver_is_linked(db, user.id, patient_id)
    return False


def ensure_can_read_patient(db: Session, user: User, patient_id: uuid.UUID) -> None:
    """404 (never 403) so nobody learns whether a patient or record exists."""
    if not can_read_patient(db, user, patient_id):
        raise ApiError(404)


def log_access(db: Session, viewer: User, patient_id: uuid.UUID | None, action: str,
               outcome: str = "allowed") -> None:
    """Write one line to the append-only access log. Committed with the caller's work."""
    db.add(AccessLog(viewer_id=viewer.id, viewer_role=viewer.role, patient_id=patient_id,
                     action=action, outcome=outcome))
