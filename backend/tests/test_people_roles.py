"""People, roles and permissions managed by supervisors."""

import re
import uuid
from io import BytesIO
from urllib.parse import urlparse

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.db.models import AccountChange, RecordEntry
from app.services import mailer
from tests.helpers import PASSWORD, join_company, link, sign_in, sign_up, staff
from tests.test_entries import PNG, entry


@pytest.fixture(autouse=True)
def _clear_outbox():
    mailer.outbox.clear()


@pytest.fixture
def team(client):
    sue = staff(client, "supervisor", "Sue")          # company "Harbour Care" (the only one)
    adm = staff(client, "admin", "Al")
    return sue, adm


def _raw_sign_up(client, name, role=None):
    body = {"name": name, "email": f"{name.lower()}@test.example", "password": PASSWORD}
    if role:
        body["role"] = role
    response = client.post("/auth/sign-up", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _roles(client, who):
    return {r["name"]: r for r in client.get("/admin/roles", headers=who.auth).json()}


def _auth(body):
    return {"Authorization": f"Bearer {body['accessToken']}"}


# --- sign-up waits for a role --------------------------------------------------

def test_new_sign_up_waits_for_a_role_and_can_do_nothing(client, team):
    body = _raw_sign_up(client, "Pat", role="caregiver")
    assert body["user"]["role"] == "pending"
    me = client.get("/me", headers=_auth(body)).json()
    assert me["role"] == "pending" and me["permissions"] == [] and me["roleName"] is None
    for url in ("/medicines", "/entries", "/health-records", "/admin/overview"):
        assert client.get(url, headers=_auth(body)).status_code == 403, url
    assert client.post("/care-links/invitations", json={"email": "x@test.example"},
                       headers=_auth(body)).status_code == 403


def test_supervisor_sees_waiting_people_with_their_request(client, team):
    sue, _ = team
    _raw_sign_up(client, "Pat", role="patient")
    waiting = client.get("/admin/users?role=pending", headers=sue.auth).json()["items"]
    assert [(p["name"], p["requestedRole"], p["company"]["name"]) for p in waiting] == [
        ("Pat", "patient", "Harbour Care")]


def test_assigning_a_role_unlocks_the_app_and_needs_a_fresh_sign_in(client, team):
    sue, _ = team
    body = _raw_sign_up(client, "Pat")
    pid = body["user"]["id"]
    roles = _roles(client, sue)
    done = client.put(f"/admin/users/{pid}/role", json={"roleId": roles["Patient"]["id"]}, headers=sue.auth)
    assert done.status_code == 200
    assert done.json()["person"]["role"] == "patient" and done.json()["person"]["roleName"] == "Patient"
    assert client.get("/me", headers=_auth(body)).status_code == 401  # signed out to load the new role
    pat = sign_in(client, "pat@test.example")
    assert client.get("/medicines", headers=pat.auth).status_code == 200


# --- full control for supervisors, with guardrails -----------------------------

def test_supervisor_can_make_another_supervisor(client, team):
    sue, _ = team
    body = _raw_sign_up(client, "Kim")
    roles = _roles(client, sue)
    client.put(f"/admin/users/{body['user']['id']}/role", json={"roleId": roles["Supervisor"]["id"]},
               headers=sue.auth)
    kim = sign_in(client, "kim@test.example")
    assert client.get("/admin/overview", headers=kim.auth).status_code == 200


def test_nobody_changes_their_own_role_or_permissions(client, team):
    sue, adm = team
    roles = _roles(client, sue)
    me = client.put(f"/admin/users/{sue.id}/role", json={"roleId": roles["Patient"]["id"]}, headers=sue.auth)
    assert me.status_code == 403 and me.json()["error"]["code"] == "not_self"
    mine = client.put(f"/admin/users/{sue.id}/permissions", json={"permissions": ["roles.manage"]},
                      headers=sue.auth)
    assert mine.status_code == 403
    own_role = client.patch(f"/admin/roles/{roles['Supervisor']['id']}",
                            json={"permissions": ["panel.access"]}, headers=sue.auth)
    assert own_role.status_code == 403
    assert client.delete(f"/admin/users/{sue.id}", headers=sue.auth).status_code == 422


def test_last_supervisor_cannot_be_demoted_or_turned_off(client, team):
    sue, adm = team
    roles = _roles(client, adm)
    demote = client.put(f"/admin/users/{sue.id}/role", json={"roleId": roles["Caregiver"]["id"]}, headers=adm.auth)
    assert demote.status_code == 409 and demote.json()["error"]["code"] == "last_supervisor"
    assert client.delete(f"/admin/users/{sue.id}", headers=adm.auth).status_code == 409
    # With a second supervisor it is allowed.
    staff(client, "supervisor", "Tom")
    assert client.delete(f"/admin/users/{sue.id}", headers=adm.auth).status_code == 204


def test_only_admin_gives_the_admin_role(client, team):
    sue, adm = team
    body = _raw_sign_up(client, "Eve")
    admin_role = _roles(client, adm)["Admin"]["id"]
    assert "Admin" not in _roles(client, sue)  # supervisors don't even see it
    response = client.put(f"/admin/users/{body['user']['id']}/role", json={"roleId": admin_role},
                          headers=sue.auth)
    assert response.status_code == 403


def test_changing_patient_to_caregiver_ends_links_but_keeps_records(client, db, team):
    sue, _ = team
    ana, sam = sign_up(client, "Ana", "patient"), sign_up(client, "Sam", "caregiver")
    for p in (ana, sam):
        join_company(p)
    link(client, ana, sam)
    client.post("/entries", json=entry("medical"), headers=ana.auth)
    roles = _roles(client, sue)
    client.put(f"/admin/users/{ana.id}/role", json={"roleId": roles["Caregiver"]["id"]}, headers=sue.auth)
    profile = client.get(f"/admin/users/{ana.id}", headers=sue.auth).json()
    assert profile["person"]["role"] == "caregiver" and profile["activeLinks"] == 0
    assert db.scalar(select(RecordEntry.id).where(RecordEntry.patient_id == uuid.UUID(ana.id)))


# --- dynamic permissions ---------------------------------------------------------

def test_extra_permission_for_one_person(client, team):
    sue, _ = team
    ana = sign_up(client, "Ana", "patient")
    join_company(ana)
    assert client.post("/entries", json=entry("behavioural"), headers=ana.auth).status_code == 403
    given = client.put(f"/admin/users/{ana.id}/permissions", json={"permissions": ["entries.write.behavioural"]},
                       headers=sue.auth)
    assert given.json()["extraPermissions"] == ["entries.write.behavioural"]
    assert client.post("/entries", json=entry("behavioural"), headers=ana.auth).status_code == 201
    client.put(f"/admin/users/{ana.id}/permissions", json={"permissions": []}, headers=sue.auth)
    assert client.post("/entries", json=entry("behavioural"), headers=ana.auth).status_code == 403
    bad = client.put(f"/admin/users/{ana.id}/permissions", json={"permissions": ["fly.to.moon"]}, headers=sue.auth)
    assert bad.status_code == 422
    panel = client.put(f"/admin/users/{ana.id}/permissions", json={"permissions": ["panel.access"]}, headers=sue.auth)
    assert panel.status_code == 422  # a patient cannot open the admin panel anyway


def test_role_permissions_change_what_everyone_with_the_role_can_do(client, team):
    sue, adm = team
    ana = sign_up(client, "Ana", "patient")
    join_company(ana)
    supervisor_role = _roles(client, adm)["Supervisor"]
    codes = [c for c in supervisor_role["permissions"] if c != "records.export"]
    assert client.patch(f"/admin/roles/{supervisor_role['id']}", json={"permissions": codes},
                        headers=adm.auth).status_code == 200
    export = client.get(f"/admin/patients/{ana.id}/entries.csv", headers=sue.auth)
    assert export.status_code == 403 and export.json()["error"]["code"] == "missing_permission"
    assert client.get(f"/admin/patients/{ana.id}", headers=sue.auth).status_code == 200


def test_custom_role_lifecycle(client, team):
    sue, adm = team
    made = client.post("/admin/roles", json={"name": "Night nurse", "kind": "caregiver",
                                              "permissions": ["entries.write.behavioural", "entries.write.medical"]},
                       headers=sue.auth)
    assert made.status_code == 201 and made.json()["permissions"] == ["entries.write.behavioural",
                                                                       "entries.write.medical"]
    nurse_role = made.json()["id"]
    assert client.post("/admin/roles", json={"name": "night NURSE", "kind": "caregiver"},
                       headers=sue.auth).status_code == 409
    body = _raw_sign_up(client, "Nia")
    client.put(f"/admin/users/{body['user']['id']}/role", json={"roleId": nurse_role}, headers=sue.auth)
    nia = sign_in(client, "nia@test.example")
    ana = sign_up(client, "Ana", "patient")
    link(client, ana, nia)
    assert client.post("/entries", json=entry("medical"), headers=nia.auth).status_code == 201
    assert client.post("/entries", json=entry("incident"), headers=nia.auth).status_code == 403
    assert client.delete(f"/admin/roles/{nurse_role}", headers=sue.auth).status_code == 409  # in use
    caregiver = _roles(client, sue)["Caregiver"]["id"]
    client.put(f"/admin/users/{body['user']['id']}/role", json={"roleId": caregiver}, headers=sue.auth)
    assert client.delete(f"/admin/roles/{nurse_role}", headers=sue.auth).status_code == 204
    builtin = client.delete(f"/admin/roles/{caregiver}", headers=sue.auth)
    assert builtin.status_code == 422


def test_a_limited_supervisor_role_is_enforced(client, team):
    sue, adm = team
    made = client.post("/admin/roles", json={"name": "Coordinator", "kind": "supervisor",
                                              "permissions": ["panel.access", "people.view"]}, headers=adm.auth)
    cora = staff(client, "supervisor", "Cora")
    client.put(f"/admin/users/{cora.id}/role", json={"roleId": made.json()["id"]}, headers=adm.auth)
    cora = sign_in(client, cora.email)
    ana = sign_up(client, "Ana", "patient")
    join_company(ana)
    assert client.get("/admin/users", headers=cora.auth).status_code == 200
    assert client.delete(f"/admin/users/{ana.id}", headers=cora.auth).status_code == 403
    assert client.get(f"/admin/patients/{ana.id}", headers=cora.auth).status_code == 403
    me = client.get("/admin/me", headers=cora.auth).json()
    assert me["permissions"] == ["panel.access", "people.view"]


# --- create, edit, photo, delete, history ------------------------------------------

def test_create_person_who_then_chooses_a_password(client, team):
    sue, _ = team
    roles = _roles(client, sue)
    made = client.post("/admin/users", json={"name": "Ben", "email": "Ben@Test.example",
                                              "roleId": roles["Caregiver"]["id"], "phone": "709 555 0100"},
                       headers=sue.auth)
    assert made.status_code == 201
    assert made.json()["person"]["roleName"] == "Caregiver" and made.json()["phone"] == "709 555 0100"
    token = re.search(r"token=([\w-]+)", mailer.outbox[-1].get_content()).group(1)
    assert client.post("/auth/password-reset/confirm", json={"token": token, "newPassword": "ben-pass-1"}
                       ).status_code == 204
    sign_in(client, "ben@test.example", "ben-pass-1")
    assert client.post("/admin/users", json={"name": "Ben2", "email": "ben@test.example"},
                       headers=sue.auth).status_code == 409


def test_profile_edit_photo_and_history(client, db, team):
    sue, _ = team
    ana = sign_up(client, "Ana", "patient")
    join_company(ana)
    edited = client.patch(f"/admin/users/{ana.id}", json={
        "name": "Ana Patient", "dateOfBirth": "1950-03-04", "address": "1 Water St",
        "emergencyContactName": "Mia", "emergencyContactPhone": "+1 709 555 0199"}, headers=sue.auth)
    assert edited.status_code == 200 and edited.json()["dateOfBirth"] == "1950-03-04"
    assert client.patch(f"/admin/users/{ana.id}", json={"phone": "call me maybe"},
                        headers=sue.auth).status_code == 422

    upload = client.post(f"/admin/users/{ana.id}/photo", files={"file": ("a.png", BytesIO(PNG), "image/png")},
                         headers=sue.auth)
    uri = upload.json()["person"]["photoUri"]
    parsed = urlparse(uri)
    assert client.get(f"{parsed.path}?{parsed.query}").content == PNG
    forged = f"{parsed.path}?{parsed.query}".replace("sig=", "sig=0")
    assert client.get(forged).status_code == 404
    assert client.post(f"/admin/users/{ana.id}/photo", files={"file": ("a.gif", BytesIO(b"GIF89a"), "image/gif")},
                       headers=sue.auth).status_code == 415

    history = client.get(f"/admin/users/{ana.id}", headers=sue.auth).json()["history"]
    assert [h["change"] for h in history] == ["photo", "details"]
    assert history[1]["before"]["name"] == "Ana" and history[1]["after"]["name"] == "Ana Patient"
    assert history[1]["by"]["name"] == "Sue"
    with pytest.raises(DBAPIError, match="append-only"):
        db.execute(text("DELETE FROM account_changes"))


def test_delete_turns_off_and_keeps_records(client, db, team):
    sue, _ = team
    ana = sign_up(client, "Ana", "patient")
    join_company(ana)
    client.post("/entries", json=entry("medical"), headers=ana.auth)
    assert client.delete(f"/admin/users/{ana.id}", headers=sue.auth).status_code == 204
    assert client.get("/me", headers=ana.auth).status_code == 401
    assert db.scalar(select(RecordEntry.id))
    profile = client.get(f"/admin/users/{ana.id}", headers=sue.auth).json()
    assert profile["person"]["isActive"] is False


def test_other_companies_people_are_out_of_reach(client, team):
    sue, _ = team
    staff(client, "supervisor", "Nina", organization="Northside")
    cara = sign_up(client, "Cara", "patient")
    join_company(cara, "Northside")
    roles = _roles(client, sue)
    for call in (lambda: client.get(f"/admin/users/{cara.id}", headers=sue.auth),
                 lambda: client.patch(f"/admin/users/{cara.id}", json={"name": "X"}, headers=sue.auth),
                 lambda: client.put(f"/admin/users/{cara.id}/role", json={"roleId": roles["Caregiver"]["id"]},
                                    headers=sue.auth),
                 lambda: client.delete(f"/admin/users/{cara.id}", headers=sue.auth)):
        assert call().status_code == 404


def test_every_change_is_recorded_with_who_and_what(client, db, team):
    sue, _ = team
    body = _raw_sign_up(client, "Pat")
    roles = _roles(client, sue)
    client.put(f"/admin/users/{body['user']['id']}/role", json={"roleId": roles["Patient"]["id"]}, headers=sue.auth)
    change = db.scalars(select(AccountChange).where(AccountChange.change == "role")).one()
    assert str(change.changed_by) == sue.id
    assert change.before["kind"] == "pending" and change.after["role"]["name"] == "Patient"
