"""Supervisors see all clients and caregivers of their own company, and nothing else."""

import uuid

import pytest
from sqlalchemy import select

from app.db.models import AccessLog
from tests.helpers import join_company, link, sign_up, staff
from tests.test_entries import entry


@pytest.fixture
def two_companies(client):
    # Harbour Care: Ana (client), Sam (caregiver), Sue (supervisor)
    # Northside Care: Cara (client), Dan (caregiver), Nina (supervisor)
    ana, sam = sign_up(client, "Ana", "patient"), sign_up(client, "Sam", "caregiver")
    cara, dan = sign_up(client, "Cara", "patient"), sign_up(client, "Dan", "caregiver")
    loner = sign_up(client, "Lou", "patient")  # in no company
    link(client, ana, sam)
    link(client, cara, dan)
    client.post("/entries", json=entry("medical"), headers=ana.auth)
    client.post("/entries", json=entry("medical"), headers=cara.auth)
    sue = staff(client, "supervisor", "Sue", organization="Harbour Care")
    nina = staff(client, "supervisor", "Nina", organization="Northside Care")
    adm = staff(client, "admin", "Al")
    for p in (ana, sam):
        join_company(p, "Harbour Care")
    for p in (cara, dan):
        join_company(p, "Northside Care")
    return dict(ana=ana, sam=sam, cara=cara, dan=dan, loner=loner, sue=sue, nina=nina, adm=adm)


def _names(client, person, **params):
    body = client.get("/admin/users", params={"pageSize": 200, **params}, headers=person.auth).json()
    return sorted(u["name"] for u in body["items"])


def test_supervisor_sees_all_clients_and_caregivers_of_own_company_only(client, two_companies):
    w = two_companies
    assert _names(client, w["sue"], role="patient") == ["Ana"]
    assert _names(client, w["sue"], role="caregiver") == ["Sam"]
    assert _names(client, w["nina"], role="patient") == ["Cara"]
    assert _names(client, w["nina"], role="caregiver") == ["Dan"]
    # Searching for another company's people finds nothing.
    assert _names(client, w["sue"], q="cara") == []
    # The admin sees everyone, in every company and none.
    assert {"Ana", "Cara", "Lou", "Sam", "Dan"} <= set(_names(client, w["adm"]))
    item = client.get("/admin/users", params={"q": "ana"}, headers=w["sue"].auth).json()["items"][0]
    assert item["company"]["name"] == "Harbour Care"


@pytest.mark.parametrize("suffix", ["", "/reminders", "/documents", "/entries", "/entries.csv",
                                    "/reminders.csv"])
def test_other_company_patient_is_404_by_id_and_logged(client, db, two_companies, suffix):
    w = two_companies
    url = f"/admin/patients/{w['cara'].id}{suffix}"
    assert client.get(url, headers=w["sue"].auth).status_code == 404
    assert client.get(url, headers=w["nina"].auth).status_code == 200
    assert client.get(f"/admin/patients/{w['loner'].id}{suffix}", headers=w["sue"].auth).status_code == 404
    denied = db.scalars(select(AccessLog).where(AccessLog.outcome == "denied",
                                                AccessLog.patient_id == uuid.UUID(w["cara"].id))).all()
    assert len(denied) == 1


def test_overview_counts_only_own_company(client, two_companies):
    w = two_companies
    sue = client.get("/admin/overview", headers=w["sue"].auth).json()
    assert sue["company"]["name"] == "Harbour Care"
    assert (sue["patients"], sue["caregivers"], sue["activeLinks"], sue["entriesLast7Days"]) == (1, 1, 1, 1)
    everyone = client.get("/admin/overview", headers=w["adm"].auth).json()
    assert everyone["company"] is None and everyone["patients"] == 3


def test_caregiver_page_shows_their_clients_within_the_company(client, two_companies):
    w = two_companies
    link(client, w["cara"], w["sam"])  # Sam also helps a Northside client
    page = client.get(f"/admin/caregivers/{w['sam'].id}", headers=w["sue"].auth).json()
    assert [p["name"] for p in page["patients"]] == ["Ana"]
    assert page["otherCompanyPatients"] == 1  # counted, but Cara's name is not shown to Sue
    assert client.get(f"/admin/caregivers/{w['dan'].id}", headers=w["sue"].auth).status_code == 404
    assert client.get(f"/admin/caregivers/{w['ana'].id}", headers=w["sue"].auth).status_code == 404


def test_access_log_is_limited_to_own_company(client, two_companies):
    w = two_companies
    client.get(f"/admin/patients/{w['ana'].id}", headers=w["sue"].auth)
    client.get(f"/admin/patients/{w['cara'].id}", headers=w["nina"].auth)
    seen = client.get("/admin/access-log", headers=w["sue"].auth).json()["items"]
    assert {i["viewer"]["name"] for i in seen} == {"Sue"}
    assert all((i["patient"] or {}).get("name") != "Cara" for i in seen)


def test_only_admin_creates_companies_and_assigns_people(client, two_companies):
    w = two_companies
    assert client.post("/admin/organizations", json={"name": "Bay Care"}, headers=w["sue"].auth).status_code == 403
    created = client.post("/admin/organizations", json={"name": "Bay Care"}, headers=w["adm"].auth)
    assert created.status_code == 201
    assert client.post("/admin/organizations", json={"name": "bay care"}, headers=w["adm"].auth).status_code == 409
    bay = created.json()["id"]

    # Supervisors cannot move people: someone outside their company is a 404,
    # and even their own caregiver cannot be moved (403).
    move = client.patch(f"/admin/users/{w['loner'].id}", json={"organizationId": bay}, headers=w["sue"].auth)
    assert move.status_code == 404
    own = client.patch(f"/admin/users/{w['sam'].id}", json={"organizationId": bay}, headers=w["sue"].auth)
    assert own.status_code == 403
    moved = client.patch(f"/admin/users/{w['loner'].id}", json={"organizationId": bay}, headers=w["adm"].auth)
    assert moved.status_code == 200 and moved.json()["company"]["name"] == "Bay Care"
    removed = client.patch(f"/admin/users/{w['loner'].id}", json={"organizationId": None}, headers=w["adm"].auth)
    assert removed.json()["company"] is None

    bad = client.patch(f"/admin/users/{w['adm'].id}", json={"organizationId": bay}, headers=w["adm"].auth)
    assert bad.status_code == 422
    orphan = client.patch(f"/admin/users/{w['sue'].id}", json={"organizationId": None}, headers=w["adm"].auth)
    assert orphan.status_code == 422
    unknown = client.patch(f"/admin/users/{w['ana'].id}", json={"organizationId": str(uuid.uuid4())},
                           headers=w["adm"].auth)
    assert unknown.status_code == 422


def test_moving_a_client_moves_them_out_of_the_old_supervisors_view(client, two_companies):
    w = two_companies
    orgs = {o["name"]: o["id"] for o in client.get("/admin/organizations", headers=w["adm"].auth).json()}
    client.patch(f"/admin/users/{w['ana'].id}", json={"organizationId": orgs["Northside Care"]},
                 headers=w["adm"].auth)
    assert client.get(f"/admin/patients/{w['ana'].id}", headers=w["sue"].auth).status_code == 404
    assert client.get(f"/admin/patients/{w['ana'].id}", headers=w["nina"].auth).status_code == 200


def test_supervisor_sees_only_own_company_in_company_list(client, two_companies):
    w = two_companies
    mine = client.get("/admin/organizations", headers=w["sue"].auth).json()
    assert [(o["name"], o["patients"], o["caregivers"], o["supervisors"]) for o in mine] == [
        ("Harbour Care", 1, 1, 1)]
    assert len(client.get("/admin/organizations", headers=w["adm"].auth).json()) == 2


def test_supervisor_cannot_exist_without_a_company(client):
    from app.cli import create_staff
    with pytest.raises(SystemExit):
        create_staff("x@test.example", "X", "supervisor", "password-123")
    with pytest.raises(SystemExit):
        create_staff("y@test.example", "Y", "admin", "password-123", organization="Anything")


# --- supervisor switches caregivers on and off --------------------------------

def test_supervisor_switches_own_caregiver_off_and_on(client, db, two_companies):
    w = two_companies
    off = client.patch(f"/admin/users/{w['sam'].id}", json={"isActive": False}, headers=w["sue"].auth)
    assert off.status_code == 200 and off.json()["isActive"] is False
    # Signed out at once, and cannot sign in.
    assert client.get("/me", headers=w["sam"].auth).status_code == 401
    assert client.post("/auth/sign-in", json={"email": w["sam"].email, "password": "correct-horse-1"}
                       ).status_code == 401
    on = client.patch(f"/admin/users/{w['sam'].id}", json={"isActive": True}, headers=w["sue"].auth)
    assert on.json()["isActive"] is True
    assert client.post("/auth/sign-in", json={"email": w["sam"].email, "password": "correct-horse-1"}
                       ).status_code == 200
    actions = db.scalars(select(AccessLog.action).where(AccessLog.viewer_id == uuid.UUID(w["sue"].id),
                                                        AccessLog.action.like("user.%"))).all()
    assert actions == ["user.deactivate", "user.activate"]


def test_supervisor_cannot_switch_others(client, db, two_companies):
    w = two_companies
    sue = w["sue"].auth
    # Another company's caregiver: 404, and logged as refused.
    assert client.patch(f"/admin/users/{w['dan'].id}", json={"isActive": False}, headers=sue).status_code == 404
    # Own company's patient, or another supervisor: 403.
    assert client.patch(f"/admin/users/{w['ana'].id}", json={"isActive": False}, headers=sue).status_code == 403
    assert client.patch(f"/admin/users/{w['nina'].id}", json={"isActive": False}, headers=sue).status_code == 404
    assert client.get("/me", headers=w["dan"].auth).status_code == 200
    assert client.get("/me", headers=w["ana"].auth).status_code == 200
    denied = db.scalars(select(AccessLog).where(AccessLog.viewer_id == uuid.UUID(w["sue"].id),
                                                AccessLog.outcome == "denied")).all()
    assert len(denied) == 3
