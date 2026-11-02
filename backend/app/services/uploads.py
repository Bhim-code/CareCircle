"""Checking and cleaning files uploaded from phones.

Rules:
- The type comes from the file's own bytes, never from its name or the phone's label.
- Allowed: PDF, JPEG, PNG, and HEIC/HEIF (iPhone camera). Max 10 MB.
- Photos are decoded and saved again. This proves they really are images, turns HEIC
  into JPEG (opens everywhere), fixes the rotation, and drops hidden metadata such as
  the GPS location where the photo was taken.
- PDFs that contain active content (JavaScript, launch actions, embedded files) are
  refused, because a PDF viewer could run them.
"""

import io
import re
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

register_heif_opener()
Image.MAX_IMAGE_PIXELS = 60_000_000  # refuse "decompression bombs"

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
_HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"}
# Names that let a PDF run code or carry other files. (A plain "open at this zoom"
# instruction is normal in scanned PDFs and is allowed.) This is a first line of
# defence that reads the visible structure; PDFs are also served with a sandbox header.
_PDF_ACTIVE = re.compile(rb"/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|XFA)\b")


class RejectedFile(ValueError):
    """The file is not acceptable. `status` is 413 (too big) or 415 (wrong or unsafe)."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class CleanFile:
    data: bytes
    content_type: str   # what we store and serve
    extension: str
    kind: str           # "pdf" or "image"


def detect(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(data) > 12 and data[4:8] == b"ftyp" and data[8:12] in _HEIF_BRANDS:
        return "heic"
    return None


def _clean_image(data: bytes, kind: str) -> CleanFile:
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            image = ImageOps.exif_transpose(image)  # keep the photo the right way up
            out = io.BytesIO()
            if kind == "png":
                image.save(out, format="PNG", optimize=True)  # saved without metadata
                return CleanFile(out.getvalue(), "image/png", ".png", "image")
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            image.save(out, format="JPEG", quality=90)  # no EXIF passed = no GPS, no camera data
            return CleanFile(out.getvalue(), "image/jpeg", ".jpg", "image")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError):
        raise RejectedFile(415, "This image could not be read. Try taking the photo again.") from None


def _check_pdf(data: bytes) -> CleanFile:
    if b"%%EOF" not in data[-2048:]:
        raise RejectedFile(415, "This PDF looks incomplete or damaged.")
    if _PDF_ACTIVE.search(data):
        raise RejectedFile(415, "This PDF contains scripts or attachments, which are not allowed. "
                                "Print it to a new PDF or upload a photo instead.")
    return CleanFile(data, "application/pdf", ".pdf", "pdf")


def clean(data: bytes) -> CleanFile:
    if len(data) > MAX_DOCUMENT_BYTES:
        raise RejectedFile(413, "The file must be 10 MB or smaller.")
    kind = detect(data) if data else None
    if kind is None:
        raise RejectedFile(415, "Upload a PDF or a photo (JPEG, PNG or iPhone HEIC).")
    return _check_pdf(data) if kind == "pdf" else _clean_image(data, kind)


def safe_filename(name: str | None, extension: str) -> str:
    """A display name for downloads: letters, digits, spaces, - _ . only; our extension."""
    stem = (name or "document").rsplit("/", 1)[-1].rsplit("\\", 1)[-1].rsplit(".", 1)[0]
    stem = re.sub(r"[^\w .-]", "", stem, flags=re.ASCII).strip(" .")[:80] or "document"
    return stem + extension
