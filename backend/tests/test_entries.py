"""Issues 7 and 8: written records and photos."""

import uuid
from datetime import UTC, datetime, timedelta
from io import BytesIO
from urllib.parse import urlparse

import pytest
from sqlalchemy import select

from app.db.models import AccessLog, EntryPhoto, RecordEntryHistory
from app.services import photos
from tests.helpers import link, sign_up

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 100


def _past(minutes=30) -> str:
    return (datetime.now(UTC) - timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")


def entry(kind="incident", **overrides) -> dict:
    body = {"kind": kind, "clientName": "Ana Patient", "title": f"{kind.title()}: test",
            "notes": "Some notes.", "occurredAt": _past(), "witnessName": None, "location": None,
            "severity": None, "actionTaken": None, "mood": None, "medicineName": None, "photoUri": None}
    if kind == "incident":
        body.update(severity="moderate", location="Bathroom", actionTaken="Helped her up.")
    if kind == "behavioural":
        body["mood"] = "calm"
    if kind == "medication":
        body["medicineName"] = "Metformin"
    body.update(overrides)
    return body


@pytest.fixture
def people(client):
    ana = sign_up(client, "Ana", "patient")
    bob = sign_up(client, "Bob", "patient")
    sam = sign_up(client, "Sam", "caregiver")   # Ana's caregiver
    eve = sign_up(client, "Eve", "caregiver")   # Bob's caregiver
    link(client, ana, sam)
    link(client, bob, eve)
    return ana, bob, sam, eve


def test_contract_shape_and_server_set_fields(client, people):
    ana, _, sam, _ = people
    response = client.post("/entries", json=entry(recordedBy={"id": "x"}), headers=sam.auth)
    assert response.status_code == 422  # the app may not send recordedBy

    saved = client.post("/entries", json=entry(), headers=sam.auth)
    assert saved.status_code == 201
    body = saved.json()
    assert body["patientId"] == ana.id  # only one linked patient, so it is implied
    assert body["recordedBy"] == {"id": sam.id, "name": "Sam", "role": "caregiver"}
    assert body["recordedAt"].endswith("Z") and body["editedAt"] is None and body["editedBy"] is None
    assert set(entry()) <= set(body)


@pytest.mark.parametrize("role_index,kind,allowed", [
    (0, "medical", True), (0, "behavioural", False), (0, "incident", True), (0, "medication", True),
    (2, "medical", False), (2, "behavioural", True), (2, "incident", True), (2, "medication", True),
])
def test_who_may_write_which_kind(client, people, role_index, kind, allowed):
    person = people[role_index]
    status = client.post("/entries", json=entry(kind), headers=person.auth).status_code
    assert status == (201 if allowed else 403)


def test_fields_that_do_not_apply_are_rejected(client, people):
    ana = people[0]
    response = client.post("/entries", json=entry("medical", mood="calm"), headers=ana.auth)
    assert response.status_code == 422 and "mood" in response.json()["error"]["fields"]
    response = client.post("/entries", json=entry("incident", medicineName="X"), headers=ana.auth)
    assert "medicineName" in response.json()["error"]["fields"]


def test_future_time_and_length_limits(client, people):
    ana = people[0]
    soon = (datetime.now(UTC) + timedelta(seconds=30)).isoformat()
    later = (datetime.now(UTC) + timedelta(minutes=5)).isoformat()
    assert client.post("/entries", json=entry(occurredAt=soon), headers=ana.auth).status_code == 201
    future = client.post("/entries", json=entry(occurredAt=later), headers=ana.auth)
    assert future.status_code == 422 and "occurredAt" in future.json()["error"]["fields"]
    too_long = client.post("/entries", json=entry(notes="x" * 2001, title="t" * 101), headers=ana.auth)
    fields = too_long.json()["error"]["fields"]
    assert fields["notes"] == "Please keep this under 2000 characters."
    assert "title" in fields
    no_zone = client.post("/entries", json=entry(occurredAt="2026-10-14T12:40:00"), headers=ana.auth)
    assert no_zone.status_code == 422


def test_nobody_reads_someone_elses_records(client, people):
    ana, bob, sam, eve = people
    client.post("/entries", json=entry("medical"), headers=ana.auth)
    client.post("/entries", json=entry("behavioural"), headers=sam.auth)
    client.post("/entries", json=entry("medical"), headers=bob.auth)

    assert len(client.get("/entries", headers=ana.auth).json()) == 2
    assert len(client.get("/entries", headers=sam.auth).json()) == 2
    assert len(client.get("/entries", headers=bob.auth).json()) == 1
    assert len(client.get("/entries", headers=eve.auth).json()) == 1
    # Asking for someone else's patient by id: 404, not an empty list or 403.
    assert client.get(f"/entries?patientId={ana.id}", headers=eve.auth).status_code == 404
    assert client.get(f"/entries?patientId={ana.id}", headers=bob.auth).status_code == 404


def test_caregiver_cannot_write_for_an_unlinked_patient(client, people):
    ana, bob, sam, _ = people
    response = client.post("/entries", json=entry(patientId=bob.id), headers=sam.auth)
    assert response.status_code == 404
    response = client.post("/entries", json=entry(patientId=bob.id), headers=ana.auth)
    assert response.status_code == 404


def test_caregiver_with_two_patients_must_choose(client, people):
    ana, bob, sam, _ = people
    link(client, bob, sam)
    assert client.post("/entries", json=entry(), headers=sam.auth).status_code == 422
    assert client.post("/entries", json=entry(patientId=bob.id), headers=sam.auth).status_code == 201


def test_only_the_author_edits_and_history_is_kept(client, db, people):
    ana, bob, sam, _ = people
    saved = client.post("/entries", json=entry(), headers=sam.auth).json()
    url = f"/entries/{saved['id']}"

    assert client.put(url, json=entry(notes="changed"), headers=ana.auth).status_code == 403
    assert client.put(url, json=entry(notes="changed"), headers=bob.auth).status_code == 404

    edited = client.put(url, json=entry(notes="Updated notes."), headers=sam.auth)
    assert edited.status_code == 200
    body = edited.json()
    assert body["notes"] == "Updated notes."
    assert body["editedBy"]["id"] == sam.id and body["editedAt"]
    assert body["recordedAt"] == saved["recordedAt"] and body["recordedBy"] == saved["recordedBy"]

    [history] = db.scalars(select(RecordEntryHistory)).all()
    assert history.version == 1 and history.snapshot["notes"] == "Some notes."
    assert client.put(url, json=entry("medication"), headers=sam.auth).status_code == 422


def test_ending_a_link_removes_read_and_edit_access_at_once(client, people):
    ana, _, sam, _ = people
    saved = client.post("/entries", json=entry(), headers=sam.auth).json()
    [link_row] = client.get("/care-links", headers=ana.auth).json()
    client.delete(f"/care-links/{link_row['id']}", headers=ana.auth)
    assert client.get("/entries", headers=sam.auth).json() == []
    assert client.put(f"/entries/{saved['id']}", json=entry(), headers=sam.auth).status_code == 404


def test_turned_off_patient_cannot_be_read_or_edited_by_caregiver(client, people):
    from app.cli import set_active
    ana, _, sam, _ = people
    saved = client.post("/entries", json=entry(), headers=sam.auth).json()
    set_active(ana.email, False)
    assert client.get("/entries", headers=sam.auth).json() == []
    assert client.put(f"/entries/{saved['id']}", json=entry(), headers=sam.auth).status_code == 404
    assert client.post("/entries", json=entry(patientId=ana.id), headers=sam.auth).status_code == 404


def test_caregiver_reads_are_logged(client, db, people):
    ana, _, sam, _ = people
    client.get("/entries", headers=sam.auth)
    client.get("/entries", headers=ana.auth)  # own data: not logged
    rows = db.scalars(select(AccessLog)).all()
    assert [(str(r.viewer_id), str(r.patient_id), r.action) for r in rows] == [
        (sam.id, ana.id, "entries.list")]


def test_filters(client, people):
    ana = people[0]
    client.post("/entries", json=entry("medical"), headers=ana.auth)
    client.post("/entries", json=entry("incident", occurredAt="2026-01-05T10:00:00Z"), headers=ana.auth)
    assert len(client.get("/entries?kind=medical", headers=ana.auth).json()) == 1
    assert len(client.get("/entries?from=2026-01-01&to=2026-01-31", headers=ana.auth).json()) == 1


# --- photos -----------------------------------------------------------------

def _upload(client, person, data=PNG, name="p.png", content_type="image/png"):
    return client.post("/entries/photo", files={"file": (name, BytesIO(data), content_type)},
                       headers=person.auth)


def _path(uri: str) -> str:
    parsed = urlparse(uri)
    return f"{parsed.path}?{parsed.query}"


def test_photo_upload_attach_and_view(client, people):
    ana, _, sam, eve = people
    uploaded = _upload(client, sam, JPEG, "x.jpg", "image/jpeg")
    assert uploaded.status_code == 201
    uri = uploaded.json()["photoUri"]
    saved = client.post("/entries", json=entry(photoUri=uri), headers=sam.auth).json()
    assert saved["photoUri"]

    # Ana (the patient) gets a fresh, working link when she lists her records.
    [listed] = client.get("/entries", headers=ana.auth).json()
    fetched = client.get(_path(listed["photoUri"]))
    assert fetched.status_code == 200 and fetched.content == JPEG
    assert fetched.headers["content-type"] == "image/jpeg"
    # Eve (unlinked) never receives a link at all.
    assert client.get("/entries", headers=eve.auth).json() == []


def test_photo_links_expire_and_cannot_be_forged(client, people, monkeypatch):
    sam = people[2]
    uri = _upload(client, sam).json()["photoUri"]
    photo_id = photos.id_from_uri(uri)
    assert client.get(_path(uri)).status_code == 200
    assert client.get(_path(uri).replace("sig=", "sig=0")).status_code == 404
    other = f"/files/photos/{uuid.uuid4()}?" + urlparse(uri).query
    assert client.get(other).status_code == 404
    import time
    monkeypatch.setattr(time, "time", lambda: 10**10)
    assert client.get(_path(uri)).status_code == 404
    assert photo_id is not None


@pytest.mark.parametrize("data,status", [
    (b"GIF89a" + b"\x00" * 50, 415),            # wrong type
    (b"<script>alert(1)</script>", 415),         # pretending to be an image
    (b"", 415),
    (b"\xff\xd8\xff" + b"\x00" * (5 * 1024 * 1024), 413),  # over 5 MB
])
def test_photo_type_and_size_checked_on_server(client, people, data, status):
    sam = people[2]
    assert _upload(client, sam, data, "evil.png", "image/png").status_code == status


def test_cannot_attach_someone_elses_photo(client, people):
    ana, bob, sam, eve = people
    eves_photo = _upload(client, eve).json()["photoUri"]
    response = client.post("/entries", json=entry(photoUri=eves_photo), headers=sam.auth)
    assert response.status_code == 422
    bogus = client.post("/entries", json=entry(photoUri="https://evil.example/x.png"), headers=sam.auth)
    assert bogus.status_code == 422


def test_replacing_a_photo_deletes_the_old_file(client, db, people):
    sam = people[2]
    first = _upload(client, sam).json()["photoUri"]
    saved = client.post("/entries", json=entry(photoUri=first), headers=sam.auth).json()
    old = db.get(EntryPhoto, photos.id_from_uri(first))
    old_file = photos.file_path(old)
    assert old_file.exists()

    second = _upload(client, sam).json()["photoUri"]
    client.put(f"/entries/{saved['id']}", json=entry(photoUri=second), headers=sam.auth)
    assert not old_file.exists()
    edited = client.put(f"/entries/{saved['id']}", json=entry(photoUri=None), headers=sam.auth).json()
    assert edited["photoUri"] is None
    assert db.scalars(select(EntryPhoto)).all() == []


def test_unused_uploads_are_cleaned_up(client, db, people):
    sam = people[2]
    _upload(client, sam)
    assert photos.cleanup(db, older_than_hours=0) >= 1
    assert db.scalars(select(EntryPhoto)).all() == []
