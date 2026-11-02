"""Health documents, with files uploaded from the phone (Android or iOS).

- A patient uploads and opens their own documents.
- A caregiver with an ACTIVE link uploads for, and opens, that patient's documents.
- Both need the documents.upload / documents.view permissions (on by default for the
  Patient and Caregiver roles; supervisors can change that per role or per person).
- Files are checked and cleaned (app/services/uploads.py), stored privately
  (app/services/storage.py), and opened only through signed links that expire.
"""

import time
import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.api.deps import CurrentUser, patient_or_caregiver
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.rate_limit import enforce
from app.core.security import utcnow
from app.db.models import HealthDocument, User
from app.db.session import get_db
from app.schemas.base import CamelModel
from app.schemas.common import PersonOut, UtcDateTime
from app.services import access, photos, uploads
from app.services.permissions import has_permission
from app.services.storage import get_storage

Category = Literal["prescription", "lab_report", "imaging", "discharge_summary", "other"]


class HealthDocumentOut(CamelModel):
    # The four fields in api-contract.md ...
    id: uuid.UUID
    title: str
    category: Category
    recorded_on: date | None
    # ... and, since file upload, these additions.
    patient_id: uuid.UUID
    file_type: Literal["pdf", "image"] | None  # null = details only, no file
    file_name: str | None
    size_bytes: int | None
    file_uri: str | None  # signed link, works for a few minutes; fetch the list again for a new one
    uploaded_by: PersonOut | None
    uploaded_at: UtcDateTime


router = APIRouter(tags=["health documents"])
files_router = APIRouter(tags=["files"])


# --- links -----------------------------------------------------------------------

def signed_document_uri(doc: HealthDocument) -> str:
    settings = get_settings()
    expires = int(time.time()) + settings.photo_link_minutes * 60
    sig = photos.sign(f"document:{doc.id}:{doc.file_key}", expires)
    return settings.public_base_url.rstrip("/") + f"/files/documents/{doc.id}?expires={expires}&sig={sig}"


def document_out(doc: HealthDocument, uploader: User | None) -> HealthDocumentOut:
    return HealthDocumentOut(
        id=doc.id, title=doc.title, category=doc.category, recorded_on=doc.recorded_on,
        patient_id=doc.patient_id,
        file_type=None if not doc.file_key else ("pdf" if doc.content_type == "application/pdf" else "image"),
        file_name=doc.file_name, size_bytes=doc.size_bytes,
        file_uri=signed_document_uri(doc) if doc.file_key else None,
        uploaded_by=PersonOut.model_validate(uploader) if uploader else None,
        uploaded_at=doc.created_at,
    )


# --- who may -----------------------------------------------------------------------

def _require(db: Session, me: CurrentUser, code: str) -> None:
    if not has_permission(db, me.user, code):
        raise ApiError(403, "You do not have permission to do this.", code="missing_permission")


def _patients_for(db: Session, me: CurrentUser, requested: uuid.UUID | None) -> list[uuid.UUID]:
    allowed = access.readable_patient_ids(db, me.user)
    if requested is None:
        return allowed
    if requested not in allowed:
        raise ApiError(404)
    return [requested]


def _upload_target(db: Session, me: CurrentUser, requested: uuid.UUID | None) -> uuid.UUID:
    if me.role == "patient":
        if requested not in (None, me.id):
            raise ApiError(404)
        return me.id
    linked = access.linked_patient_ids(db, me.id)
    if requested is None:
        if len(linked) == 1:
            return linked[0]
        raise ApiError(422, fields={"patientId": "Choose which linked patient this is for."}
                       if linked else {"patientId": "You are not linked to a patient yet."})
    if requested not in linked:
        raise ApiError(404)
    return requested


# --- endpoints -----------------------------------------------------------------------

@router.get("/health-records", response_model=list[HealthDocumentOut])
def list_health_records(
    patient_id: Annotated[uuid.UUID | None, Query(alias="patientId")] = None,
    me: CurrentUser = Depends(patient_or_caregiver),
    db: Session = Depends(get_db),
) -> list[HealthDocumentOut]:
    """Patient: their own. Caregiver: their linked patients' (or one, with ?patientId=).
    Newest first; documents with no date go last."""
    _require(db, me, "documents.view")
    patients = _patients_for(db, me, patient_id)
    if not patients:
        return []
    uploader = aliased(User)
    rows = db.execute(
        select(HealthDocument, uploader).outerjoin(uploader, uploader.id == HealthDocument.uploaded_by)
        .where(HealthDocument.patient_id.in_(patients), HealthDocument.deleted_at.is_(None))
        .order_by(HealthDocument.recorded_on.desc().nulls_last(), HealthDocument.created_at.desc()))
    if me.role == "caregiver":
        for pid in patients:
            access.log_access(db, me.user, pid, "documents.list")
        db.commit()
    return [document_out(d, u) for d, u in rows]


@router.post("/health-records", response_model=HealthDocumentOut, status_code=201,
             responses={413: {"description": "Larger than 10 MB."},
                        415: {"description": "Not a PDF/JPEG/PNG/HEIC, unreadable, or a PDF with scripts."}})
async def upload_health_record(
    request: Request,
    file: Annotated[UploadFile, File(description="PDF, JPEG, PNG or HEIC, at most 10 MB")],
    title: Annotated[str, Form(min_length=1, max_length=200)],
    category: Annotated[Category, Form()],
    recorded_on: Annotated[date | None, Form(alias="recordedOn")] = None,
    patient_id: Annotated[uuid.UUID | None, Form(alias="patientId")] = None,
    me: CurrentUser = Depends(patient_or_caregiver),
    db: Session = Depends(get_db),
) -> HealthDocumentOut:
    """Multipart form: file, title, category, optional recordedOn (YYYY-MM-DD) and patientId
    (a caregiver with more than one linked patient must send it)."""
    _require(db, me, "documents.upload")
    enforce(request, "document-upload", 30, 3600, str(me.id))
    patient = _upload_target(db, me, patient_id)
    title = title.strip()
    if not title:
        raise ApiError(422, fields={"title": "This is required."})
    if recorded_on and recorded_on > utcnow().date():
        raise ApiError(422, fields={"recordedOn": "This cannot be in the future."})

    data = await file.read(uploads.MAX_DOCUMENT_BYTES + 1)
    try:
        clean = uploads.clean(data)
    except uploads.RejectedFile as rejected:
        raise ApiError(rejected.status, rejected.message, fields={"file": rejected.message}) from None

    doc_id = uuid.uuid4()
    key = f"documents/{patient}/{doc_id.hex}{clean.extension}"
    get_storage().save(key, clean.data)
    doc = HealthDocument(id=doc_id, patient_id=patient, title=title, category=category,
                         recorded_on=recorded_on, file_key=key, content_type=clean.content_type,
                         size_bytes=len(clean.data), file_name=uploads.safe_filename(file.filename, clean.extension),
                         uploaded_by=me.id)
    db.add(doc)
    if me.role == "caregiver":
        access.log_access(db, me.user, patient, "documents.upload")
    try:
        db.commit()
    except Exception:
        get_storage().delete(key)  # never leave a file without its row
        raise
    db.refresh(doc)
    return document_out(doc, me.user)


@router.delete("/health-records/{document_id}", status_code=204)
def delete_health_record(document_id: uuid.UUID, me: CurrentUser = Depends(patient_or_caregiver),
                         db: Session = Depends(get_db)) -> Response:
    """The patient, or the caregiver who uploaded it (while still linked), can delete a
    document. It disappears from lists; the file is kept as part of the health record."""
    doc = db.get(HealthDocument, document_id)
    if doc is None or doc.deleted_at is not None or not access.can_read_patient(db, me.user, doc.patient_id):
        raise ApiError(404)
    if me.id not in (doc.patient_id, doc.uploaded_by):
        raise ApiError(403, "Only the patient or the person who uploaded it can delete this.")
    doc.deleted_at = utcnow()
    doc.deleted_by = me.id
    db.commit()
    return Response(status_code=204)


@files_router.get("/files/documents/{document_id}",
                  responses={404: {"description": "Unknown, deleted, or the link has expired."}})
def open_document(document_id: uuid.UUID, expires: int, sig: Annotated[str, Query(max_length=128)],
                  db: Session = Depends(get_db)) -> Response:
    """Opens a document from a signed link (no sign-in needed so the phone can show it,
    but the link is only given to people allowed to see it, and it expires)."""
    doc = db.get(HealthDocument, document_id)
    if (doc is None or not doc.file_key or doc.deleted_at is not None or expires < time.time()
            or not photos.signature_ok_for(f"document:{doc.id}:{doc.file_key}", expires, sig)):
        raise ApiError(404)
    headers = {
        "Cache-Control": "private, no-store",
        # Shown inside the browser or phone, never run: no scripts, no forms, no navigation.
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        "Content-Disposition": f'inline; filename="{doc.file_name or "document"}"',
    }
    storage = get_storage()
    path = storage.path(doc.file_key)
    if path is not None:
        return FileResponse(path, media_type=doc.content_type, headers=headers)
    return Response(storage.read(doc.file_key), media_type=doc.content_type, headers=headers)
