"""Issue 6: the patient's own health documents. Upload and download come later."""

import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, patient_only
from app.db.models import HealthDocument
from app.db.session import get_db
from app.schemas.base import CamelModel


class HealthDocumentOut(CamelModel):
    id: uuid.UUID
    title: str
    category: Literal["prescription", "lab_report", "imaging", "discharge_summary", "other"]
    recorded_on: date | None


router = APIRouter(tags=["health documents"])


@router.get("/health-records", response_model=list[HealthDocumentOut])
def list_health_records(me: CurrentUser = Depends(patient_only),
                        db: Session = Depends(get_db)) -> list[HealthDocument]:
    """Newest first; documents with no date go last."""
    return list(db.scalars(
        select(HealthDocument).where(HealthDocument.patient_id == me.id)
        .order_by(HealthDocument.recorded_on.desc().nulls_last(), HealthDocument.created_at.desc())))
