"""Issue 8: private photo storage with expiring links.

Files live in PHOTO_DIR under random names and are never served as a folder.
The only way to fetch one is a link signed with the server's secret that stops
working after PHOTO_LINK_MINUTES. Links are only handed out to people who are
allowed to read the record the photo belongs to, at the moment they read it.
"""

import hashlib
import hmac
import logging
import re
import time
import uuid
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import utcnow
from app.db.models import EntryPhoto

logger = logging.getLogger("carecircle.photos")

MAX_BYTES = 5 * 1024 * 1024
_SIGNATURES = {
    b"\xff\xd8\xff": ("image/jpeg", ".jpg"),
    b"\x89PNG\r\n\x1a\n": ("image/png", ".png"),
}
_URI_ID = re.compile(r"/files/photos/([0-9a-fA-F-]{36})(?:\?|$)")


def sniff_type(data: bytes) -> tuple[str, str] | None:
    """Trust the bytes, not the file name or the Content-Type the phone sent."""
    for magic, kind in _SIGNATURES.items():
        if data.startswith(magic):
            return kind
    return None


def photo_dir() -> Path:
    path = get_settings().photo_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def save(db: Session, uploader_id: uuid.UUID, data: bytes, content_type: str, ext: str) -> EntryPhoto:
    key = f"{uuid.uuid4().hex}{ext}"
    (photo_dir() / key).write_bytes(data)
    photo = EntryPhoto(uploaded_by=uploader_id, content_type=content_type, size_bytes=len(data),
                       storage_key=key)
    db.add(photo)
    db.flush()
    return photo


def file_path(photo: EntryPhoto) -> Path:
    return photo_dir() / photo.storage_key


def _signature(photo_id: str, expires: int) -> str:
    key = hashlib.sha256(b"photo-links:" + get_settings().jwt_secret.encode()).digest()
    return hmac.new(key, f"{photo_id}:{expires}".encode(), hashlib.sha256).hexdigest()


def signed_uri(photo_id: uuid.UUID) -> str:
    settings = get_settings()
    expires = int(time.time()) + settings.photo_link_minutes * 60
    path = f"/files/photos/{photo_id}?expires={expires}&sig={_signature(str(photo_id), expires)}"
    return settings.public_base_url.rstrip("/") + path


def signature_ok(photo_id: uuid.UUID, expires: int, sig: str) -> bool:
    if expires < time.time():
        return False
    return hmac.compare_digest(_signature(str(photo_id), expires), sig)


def id_from_uri(uri: str) -> uuid.UUID | None:
    match = _URI_ID.search(uri)
    try:
        return uuid.UUID(match.group(1)) if match else None
    except ValueError:
        return None


def remove(db: Session, photo: EntryPhoto) -> None:
    path = file_path(photo)
    db.delete(photo)
    path.unlink(missing_ok=True)


def cleanup(db: Session, older_than_hours: int = 24) -> int:
    """Job: delete photos never attached to a record, and files whose row is gone."""
    cutoff = utcnow().timestamp() - older_than_hours * 3600
    removed = 0
    for photo in db.scalars(select(EntryPhoto).where(EntryPhoto.entry_id.is_(None))):
        if photo.created_at.timestamp() < cutoff:
            file_path(photo).unlink(missing_ok=True)
            db.execute(delete(EntryPhoto).where(EntryPhoto.id == photo.id))
            removed += 1
    db.commit()
    known = set(db.scalars(select(EntryPhoto.storage_key)))
    for path in photo_dir().iterdir():
        if path.is_file() and path.name not in known and path.stat().st_mtime < cutoff:
            path.unlink(missing_ok=True)
            removed += 1
    return removed
