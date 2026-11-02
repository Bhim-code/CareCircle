"""Issues 7 and 8: written records and their photos.

Rules (api-contract.md):
- A patient sees their own records; a caregiver sees their linked patients'.
- recordedAt / recordedBy come from the login, never from the app, and never change.
- Only the author can edit; each edit keeps the previous version in history.
- Each role may only write certain kinds.
"""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.api.deps import CurrentUser, patient_or_caregiver
from app.core.errors import ApiError
from app.core.security import utcnow
from app.db.models import EntryPhoto, RecordEntry, RecordEntryHistory, User
from app.db.session import get_db
from app.schemas.base import CamelModel
from app.schemas.common import PersonOut
from app.schemas.entries import ONLY_FOR, EntryIn, EntryOut, Kind
from app.services import access, photos
from app.services.permissions import has_permission

router = APIRouter(tags=["written records"])
files_router = APIRouter(tags=["files"])

_FIELDS = ("kind", "client_name", "title", "notes", "occurred_at", "witness_name", "location",
           "severity", "action_taken", "mood", "medicine_name")
_CAMEL = {"medicine_name": "medicineName", "severity": "severity", "mood": "mood"}


class PhotoOut(CamelModel):
    photo_uri: str


# --- helpers -----------------------------------------------------------------

def _out(entry: RecordEntry, author: User, editor: User | None, photo: EntryPhoto | None) -> EntryOut:
    return EntryOut(
        **{f: getattr(entry, f) for f in _FIELDS},
        id=entry.id, patient_id=entry.patient_id,
        photo_uri=photos.signed_uri(photo.id) if photo else None,
        recorded_at=entry.recorded_at, recorded_by=PersonOut.model_validate(author),
        edited_at=entry.edited_at,
        edited_by=PersonOut.model_validate(editor) if editor else None,
    )


def _load_out(db: Session, entry: RecordEntry) -> EntryOut:
    author = db.get(User, entry.recorded_by)
    editor = db.get(User, entry.edited_by) if entry.edited_by else None
    photo = db.scalar(select(EntryPhoto).where(EntryPhoto.entry_id == entry.id))
    return _out(entry, author, editor, photo)


def _check_kind_fields(body: EntryIn) -> None:
    for field, kind in ONLY_FOR.items():
        if getattr(body, field) is not None and body.kind != kind:
            raise ApiError(422, fields={_CAMEL[field]: f"Only used for {kind} records. Send null."})


def _check_role_may_write(db: Session, me: CurrentUser, kind: str) -> None:
    """Permission entries.write.<kind>, set per role (and per person) in the admin panel."""
    if not has_permission(db, me.user, f"entries.write.{kind}"):
        raise ApiError(403, f"You do not have permission to write {kind} records.")


def _target_patient(db: Session, me: CurrentUser, requested: uuid.UUID | None) -> uuid.UUID:
    if me.role == "patient":
        if requested not in (None, me.id):
            raise ApiError(404)
        return me.id
    linked = access.linked_patient_ids(db, me.id)
    if requested is None:
        if len(linked) == 1:
            return linked[0]
        raise ApiError(422, fields={"patientId": "Choose which linked patient this is about."}
                       if linked else {"patientId": "You are not linked to a patient yet."})
    if requested not in linked:
        raise ApiError(404)
    return requested


def _attach_photo(db: Session, me: CurrentUser, entry: RecordEntry, uri: str | None) -> None:
    current = db.scalar(select(EntryPhoto).where(EntryPhoto.entry_id == entry.id))
    wanted_id = photos.id_from_uri(uri) if uri else None
    if uri and wanted_id is None:
        raise ApiError(422, fields={"photoUri": "Upload the photo with POST /entries/photo first."})
    if current and current.id == wanted_id:
        return
    if wanted_id:
        photo = db.get(EntryPhoto, wanted_id)
        # Only your own, not-yet-used upload can be attached.
        if photo is None or photo.uploaded_by != me.id or photo.entry_id is not None:
            raise ApiError(422, fields={"photoUri": "This photo cannot be used here."})
    if current:
        photos.remove(db, current)  # replaced or removed: delete the old file
        db.flush()
    if wanted_id:
        photo.entry_id = entry.id


def _snapshot(entry: RecordEntry, photo_id: uuid.UUID | None) -> dict:
    data = {f: getattr(entry, f) for f in _FIELDS}
    data["occurred_at"] = entry.occurred_at.isoformat()
    data.update(recorded_at=entry.recorded_at.isoformat(), recorded_by=str(entry.recorded_by),
                edited_at=entry.edited_at.isoformat() if entry.edited_at else None,
                edited_by=str(entry.edited_by) if entry.edited_by else None,
                photo_id=str(photo_id) if photo_id else None, version=entry.version)
    return data


# --- endpoints ---------------------------------------------------------------

@router.get("/entries", response_model=list[EntryOut])
def list_entries(
    patient_id: Annotated[uuid.UUID | None, Query(alias="patientId")] = None,
    kind: Kind | None = None,
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    me: CurrentUser = Depends(patient_or_caregiver),
    db: Session = Depends(get_db),
) -> list[EntryOut]:
    """Newest first. Optional filters: patientId, kind, from, to (YYYY-MM-DD, UTC days)."""
    allowed = access.readable_patient_ids(db, me.user)
    if patient_id is not None:
        if patient_id not in allowed:
            raise ApiError(404)
        allowed = [patient_id]
    if not allowed:
        return []

    author, editor = aliased(User), aliased(User)
    query = (select(RecordEntry, author, editor, EntryPhoto)
             .join(author, author.id == RecordEntry.recorded_by)
             .outerjoin(editor, editor.id == RecordEntry.edited_by)
             .outerjoin(EntryPhoto, EntryPhoto.entry_id == RecordEntry.id)
             .where(RecordEntry.patient_id.in_(allowed))
             .order_by(RecordEntry.occurred_at.desc()))
    if kind:
        query = query.where(RecordEntry.kind == kind)
    if from_date:
        query = query.where(RecordEntry.occurred_at >= datetime.combine(from_date, time.min, tzinfo=UTC))
    if to_date:
        query = query.where(RecordEntry.occurred_at <
                            datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=UTC))

    if me.role == "caregiver":  # someone reading another person's health data: log it
        for pid in allowed:
            access.log_access(db, me.user, pid, "entries.list")
        db.commit()
    return [_out(e, a, ed, p) for e, a, ed, p in db.execute(query)]


@router.post("/entries", response_model=EntryOut, status_code=201)
def create_entry(body: EntryIn, me: CurrentUser = Depends(patient_or_caregiver),
                 db: Session = Depends(get_db)) -> EntryOut:
    _check_role_may_write(db, me, body.kind)
    _check_kind_fields(body)
    patient_id = _target_patient(db, me, body.patient_id)
    entry = RecordEntry(**{f: getattr(body, f) for f in _FIELDS},
                        patient_id=patient_id, recorded_by=me.id)  # recorded_at: database clock
    db.add(entry)
    db.flush()
    _attach_photo(db, me, entry, body.photo_uri)
    db.commit()
    db.refresh(entry)
    return _load_out(db, entry)


@router.put("/entries/{entry_id}", response_model=EntryOut)
def edit_entry(entry_id: uuid.UUID, body: EntryIn, me: CurrentUser = Depends(patient_or_caregiver),
               db: Session = Depends(get_db)) -> EntryOut:
    """Author only (403 for anyone else who can see it; 404 for anyone who cannot)."""
    entry = db.scalar(select(RecordEntry).where(RecordEntry.id == entry_id).with_for_update())
    if entry is None or not access.can_read_patient(db, me.user, entry.patient_id):
        raise ApiError(404)
    if entry.recorded_by != me.id:
        raise ApiError(403, "Only the person who wrote this record can edit it.")
    if body.kind != entry.kind:
        raise ApiError(422, fields={"kind": "The kind of a record cannot be changed."})
    if body.patient_id not in (None, entry.patient_id):
        raise ApiError(422, fields={"patientId": "A record cannot be moved to another patient."})
    _check_role_may_write(db, me, body.kind)
    _check_kind_fields(body)

    old_photo = db.scalar(select(EntryPhoto.id).where(EntryPhoto.entry_id == entry.id))
    db.add(RecordEntryHistory(entry_id=entry.id, version=entry.version,
                              snapshot=_snapshot(entry, old_photo), replaced_by=me.id))
    for field in _FIELDS:
        setattr(entry, field, getattr(body, field))
    entry.edited_at = utcnow()
    entry.edited_by = me.id
    entry.version += 1
    _attach_photo(db, me, entry, body.photo_uri)
    db.commit()
    return _load_out(db, entry)


@router.post("/entries/photo", response_model=PhotoOut, status_code=201,
             responses={413: {"description": "Larger than 5 MB."},
                        415: {"description": "Not a JPEG or PNG."}})
async def upload_photo(file: UploadFile = File(...), me: CurrentUser = Depends(patient_or_caregiver),
                       db: Session = Depends(get_db)) -> PhotoOut:
    """JPEG or PNG, at most 5 MB, checked from the file's bytes. Returns a private link
    to put in photoUri when saving the record. Unused uploads are deleted after a day."""
    data = await file.read(photos.MAX_BYTES + 1)
    if len(data) > photos.MAX_BYTES:
        raise ApiError(413, "The photo must be 5 MB or smaller.", fields={"file": "Too large."})
    kind = photos.sniff_type(data)
    if not data or kind is None:
        raise ApiError(415, "Only JPEG and PNG photos are accepted.", fields={"file": "Wrong type."})
    photo = photos.save(db, me.id, data, *kind)
    db.commit()
    return PhotoOut(photo_uri=photos.signed_uri(photo.id))


@files_router.get("/files/photos/{photo_id}", include_in_schema=True,
                  responses={404: {"description": "Unknown, or the link has expired."}})
def get_photo(photo_id: uuid.UUID, expires: int, sig: Annotated[str, Query(max_length=128)],
              db: Session = Depends(get_db)) -> FileResponse:
    """Opens a photo from a signed link. No sign-in needed (so <Image> works), but the
    link only comes from someone allowed to see the record, and it expires."""
    photo = db.get(EntryPhoto, photo_id) if photos.signature_ok(photo_id, expires, sig) else None
    if photo is None or not photos.file_path(photo).is_file():
        raise ApiError(404)
    return FileResponse(photos.file_path(photo), media_type=photo.content_type,
                        headers={"Cache-Control": "private, no-store"})

