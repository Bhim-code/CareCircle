"""Uploading health documents from the phone: PDFs and photos (incl. iPhone HEIC)."""

import io
import time
from urllib.parse import urlparse

import pytest
from PIL import Image
from pillow_heif import register_heif_opener
from sqlalchemy import select

from app.db.models import AccessLog
from app.services import uploads
from app.services.storage import LocalStorage
from tests.helpers import link, sign_up, staff

register_heif_opener()


# --- real sample files ----------------------------------------------------------

def pdf_bytes(extra: bytes = b"") -> bytes:
    return (b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
            b"2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n" + extra +
            b"trailer << /Root 1 0 R >>\n%%EOF\n")


def image_bytes(fmt: str, gps: bool = False, size=(64, 48)) -> bytes:
    image = Image.new("RGB", size, (46, 106, 92))
    out = io.BytesIO()
    if gps:
        exif = Image.Exif()
        exif[0x8825] = {1: "N", 2: (47.0, 33.0, 40.0), 3: "W", 4: (52.0, 42.0, 45.0)}  # GPS: St. John's
        exif[0x010F] = "PhoneMaker"
        image.save(out, format=fmt, exif=exif)
    else:
        image.save(out, format=fmt)
    return out.getvalue()


def upload(client, who, data: bytes, name="scan.pdf", ctype="application/pdf", **form):
    fields = {"title": "Blood test", "category": "lab_report", **form}
    return client.post("/health-records", data=fields, files={"file": (name, io.BytesIO(data), ctype)},
                       headers=who.auth)


def open_link(client, uri: str):
    parsed = urlparse(uri)
    return client.get(f"{parsed.path}?{parsed.query}")


@pytest.fixture
def people(client):
    ana, bob = sign_up(client, "Ana", "patient"), sign_up(client, "Bob", "patient")
    sam, eve = sign_up(client, "Sam", "caregiver"), sign_up(client, "Eve", "caregiver")
    link(client, ana, sam)
    link(client, bob, eve)
    return ana, bob, sam, eve


# --- happy paths -------------------------------------------------------------------

def test_patient_uploads_a_pdf_and_opens_it(client, people):
    ana = people[0]
    made = upload(client, ana, pdf_bytes(), recordedOn="2026-09-01")
    assert made.status_code == 201, made.text
    doc = made.json()
    assert doc["fileType"] == "pdf" and doc["fileName"] == "scan.pdf" and doc["recordedOn"] == "2026-09-01"
    assert doc["uploadedBy"]["name"] == "Ana"
    [listed] = client.get("/health-records", headers=ana.auth).json()
    opened = open_link(client, listed["fileUri"])
    assert opened.status_code == 200 and opened.content == pdf_bytes()
    assert opened.headers["content-type"] == "application/pdf"
    assert opened.headers["content-disposition"].startswith("inline;")
    assert "sandbox" in opened.headers["content-security-policy"]
    assert opened.headers["x-content-type-options"] == "nosniff"


def test_caregiver_uploads_for_linked_patient_and_both_see_it(client, db, people):
    ana, _, sam, _ = people
    made = upload(client, sam, image_bytes("JPEG"), name="IMG_0042.jpg", ctype="image/jpeg",
                  title="Discharge letter", category="discharge_summary")
    assert made.status_code == 201 and made.json()["patientId"] == ana.id
    titles = [d["title"] for d in client.get("/health-records", headers=ana.auth).json()]
    assert titles == ["Discharge letter"]
    assert [d["title"] for d in client.get("/health-records", headers=sam.auth).json()] == ["Discharge letter"]
    actions = db.scalars(select(AccessLog.action).where(AccessLog.viewer_id.isnot(None))).all()
    assert "documents.upload" in actions and "documents.list" in actions


def test_iphone_heic_becomes_jpeg(client, people):
    ana = people[0]
    made = upload(client, ana, image_bytes("HEIF"), name="IMG_1234.HEIC", ctype="image/heic")
    assert made.status_code == 201, made.text
    assert made.json()["fileName"] == "IMG_1234.jpg"
    stored = open_link(client, made.json()["fileUri"])
    assert stored.headers["content-type"] == "image/jpeg"
    assert Image.open(io.BytesIO(stored.content)).format == "JPEG"


def test_photo_location_and_camera_data_are_removed(client, people):
    ana = people[0]
    original = image_bytes("JPEG", gps=True)
    assert Image.open(io.BytesIO(original)).getexif().get_ifd(0x8825)  # it really had GPS
    made = upload(client, ana, original, name="kitchen.jpg", ctype="image/jpeg")
    stored = Image.open(io.BytesIO(open_link(client, made.json()["fileUri"]).content))
    exif = stored.getexif()
    assert not exif.get_ifd(0x8825) and 0x010F not in exif


def test_png_stays_png(client, people):
    made = upload(client, people[0], image_bytes("PNG"), name="chart.png", ctype="image/png")
    assert made.json()["fileName"] == "chart.png"
    assert open_link(client, made.json()["fileUri"]).headers["content-type"] == "image/png"


# --- what is refused -----------------------------------------------------------------

@pytest.mark.parametrize("data,name,status", [
    (b"just some text pretending", "photo.jpg", 415),                    # wrong type behind a .jpg name
    (b"GIF89a" + b"\x00" * 40, "anim.gif", 415),                          # not allowed
    (b"", "empty.pdf", 415),
    (b"\xff\xd8\xff\xe0" + b"garbage" * 20, "broken.jpg", 415),           # says JPEG, isn't one
    (pdf_bytes(b"3 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj\n"), "evil.pdf", 415),
    (pdf_bytes(b"4 0 obj << /Type /EmbeddedFile >> endobj\n"), "carrier.pdf", 415),
    (b"%PDF-1.4\n1 0 obj << >> endobj\n", "cut.pdf", 415),                 # truncated, no %%EOF
    (b"%PDF-1.4\n" + b"0" * (10 * 1024 * 1024) + b"\n%%EOF", "huge.pdf", 413),
])
def test_unsafe_or_wrong_files_are_refused(client, people, data, name, status):
    response = upload(client, people[0], data, name=name, ctype="application/pdf")
    assert response.status_code == status
    assert "file" in response.json()["error"]["fields"]
    assert client.get("/health-records", headers=people[0].auth).json() == []


def test_form_fields_are_checked(client, people):
    ana = people[0]
    assert upload(client, ana, pdf_bytes(), title="  ").status_code == 422
    assert upload(client, ana, pdf_bytes(), category="xray").status_code == 422
    future = upload(client, ana, pdf_bytes(), recordedOn="2999-01-01")
    assert future.status_code == 422 and "recordedOn" in future.json()["error"]["fields"]


def test_missing_or_text_file_gets_a_plain_message(client, people):
    """A web form that cannot attach the file sends text such as "[object Object]"."""
    ana = people[0]
    form = {"title": "Blood test", "category": "lab_report"}
    for data in ({**form, "file": "[object Object]"}, form):
        response = client.post("/health-records", data=data, headers=ana.auth)
        assert response.status_code == 422
        assert response.json()["error"]["fields"] == {"file": "Choose a file to upload."}
        assert "<class" not in response.text and "UploadFile" not in response.text


def test_dangerous_file_names_are_cleaned(client, people):
    made = upload(client, people[0], pdf_bytes(), name='../../etc/pa"ss<script>.exe.pdf')
    name = made.json()["fileName"]
    assert name.endswith(".pdf") and "/" not in name and "<" not in name and '"' not in name


# --- who may ---------------------------------------------------------------------------

def test_strangers_cannot_upload_list_or_open(client, people):
    ana, bob, sam, eve = people
    made = upload(client, ana, pdf_bytes()).json()
    assert upload(client, eve, pdf_bytes(), patientId=ana.id).status_code == 404
    assert upload(client, sam, pdf_bytes(), patientId=bob.id).status_code == 404
    assert upload(client, bob, pdf_bytes(), patientId=ana.id).status_code == 404
    assert client.get(f"/health-records?patientId={ana.id}", headers=eve.auth).status_code == 404
    assert client.get("/health-records", headers=bob.auth).json() == []
    # A forged or expired link does not open the file.
    parsed = urlparse(made["fileUri"])
    assert client.get(f"{parsed.path}?{parsed.query}".replace("sig=", "sig=0")).status_code == 404
    assert client.get(f"{parsed.path}?expires={int(time.time()) + 999}&sig=abc").status_code == 404


def test_link_expires(client, people, monkeypatch):
    made = upload(client, people[0], pdf_bytes()).json()
    monkeypatch.setattr(time, "time", lambda: 10**10)
    assert open_link(client, made["fileUri"]).status_code == 404


def test_ending_the_link_ends_caregiver_access(client, people):
    ana, _, sam, _ = people
    [row] = client.get("/care-links", headers=ana.auth).json()
    client.delete(f"/care-links/{row['id']}", headers=ana.auth)
    assert client.get("/health-records", headers=sam.auth).json() == []
    assert upload(client, sam, pdf_bytes(), patientId=ana.id).status_code == 404


def test_permissions_switch_uploads_and_viewing_off(client, people):
    ana, _, sam, _ = people
    adm = staff(client, "admin", "Al")
    roles = {r["name"]: r for r in client.get("/admin/roles", headers=adm.auth).json()}
    caregiver = roles["Caregiver"]
    codes = [c for c in caregiver["permissions"] if c not in ("documents.upload", "documents.view")]
    client.patch(f"/admin/roles/{caregiver['id']}", json={"permissions": codes}, headers=adm.auth)
    assert upload(client, sam, pdf_bytes()).status_code == 403
    assert client.get("/health-records", headers=sam.auth).status_code == 403
    assert upload(client, ana, pdf_bytes()).status_code == 201  # patients unaffected


def test_waiting_accounts_cannot_upload(client):
    body = client.post("/auth/sign-up", json={"name": "Pat", "email": "pat@test.example",
                                              "password": "correct-horse-1"}).json()
    response = client.post("/health-records", data={"title": "x", "category": "other"},
                           files={"file": ("a.pdf", io.BytesIO(pdf_bytes()), "application/pdf")},
                           headers={"Authorization": f"Bearer {body['accessToken']}"})
    assert response.status_code == 403


# --- delete ---------------------------------------------------------------------------

def test_delete_rules_and_staff_still_see_it(client, people):
    ana, bob, sam, _ = people
    by_ana = upload(client, ana, pdf_bytes(), title="Ana's own").json()
    by_sam = upload(client, sam, pdf_bytes(), title="From Sam").json()
    assert client.delete(f"/health-records/{by_ana['id']}", headers=sam.auth).status_code == 403
    assert client.delete(f"/health-records/{by_ana['id']}", headers=bob.auth).status_code == 404
    assert client.delete(f"/health-records/{by_sam['id']}", headers=sam.auth).status_code == 204
    assert [d["title"] for d in client.get("/health-records", headers=ana.auth).json()] == ["Ana's own"]
    assert open_link(client, by_sam["fileUri"]).status_code == 404
    assert client.delete(f"/health-records/{by_ana['id']}", headers=ana.auth).status_code == 204

    from tests.helpers import join_company
    sue = staff(client, "supervisor", "Sue")
    join_company(ana)
    docs = client.get(f"/admin/patients/{ana.id}/documents", headers=sue.auth).json()
    assert {d["title"]: bool(d["deletedAt"]) for d in docs} == {"Ana's own": True, "From Sam": True}


def test_storage_refuses_paths_outside_its_folder(tmp_path):
    storage = LocalStorage(tmp_path)
    for bad in ("../escape.pdf", "/etc/passwd", "a/../../b", "UPPER.pdf"):
        with pytest.raises(ValueError):
            storage.save(bad, b"x")
    storage.save("documents/ok.pdf", b"x")
    assert storage.read("documents/ok.pdf") == b"x"


def test_file_checks_directly():
    assert uploads.detect(image_bytes("HEIF")) == "heic"
    assert uploads.clean(pdf_bytes()).content_type == "application/pdf"
    with pytest.raises(uploads.RejectedFile):
        uploads.clean(b"MZ\x90\x00 windows program")
