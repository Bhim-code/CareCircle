"""Shortcuts for tests: make people, sign them in, call the API as them."""

from dataclasses import dataclass

from fastapi.testclient import TestClient

from app.cli import create_staff

PASSWORD = "correct-horse-1"


@dataclass
class Person:
    id: str
    email: str
    name: str
    role: str
    access_token: str
    refresh_token: str

    @property
    def auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}


def _person(body: dict) -> Person:
    user = body["user"]
    return Person(user["id"], user["email"], user["name"], user["role"],
                  body["accessToken"], body["refreshToken"])


def sign_up(client: TestClient, name: str, role: str, email: str | None = None,
            timezone: str = "UTC") -> Person:
    email = email or f"{name.lower().replace(' ', '.')}@test.example"
    response = client.post("/auth/sign-up", json={"name": name, "email": email, "password": PASSWORD,
                                                  "role": role, "timezone": timezone})
    assert response.status_code == 201, response.text
    return _person(response.json())


def sign_in(client: TestClient, email: str, password: str = PASSWORD) -> Person:
    response = client.post("/auth/sign-in", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return _person(response.json())


def staff(client: TestClient, role: str, name: str | None = None,
          organization: str | None = "Harbour Care") -> Person:
    """Admins are global; supervisors get a company (created if needed)."""
    from sqlalchemy import func, select
    from sqlalchemy.orm import Session

    from app.cli import create_org
    from app.db.models import Organization
    from app.db.session import get_engine

    name = name or role.title()
    email = f"{role}.{name.lower().replace(' ', '.')}@test.example"
    org = organization if role == "supervisor" else None
    if org:
        with Session(get_engine()) as db:
            exists = db.scalar(select(Organization.id).where(func.lower(Organization.name) == org.lower()))
        if not exists:
            create_org(org)
    create_staff(email, name, role, PASSWORD, organization=org)
    return sign_in(client, email)


def join_company(person: "Person", organization: str = "Harbour Care") -> None:
    from app.cli import set_company
    set_company(person.email, organization)


def link(client: TestClient, patient: Person, caregiver: Person) -> str:
    """Patient invites caregiver by email; caregiver accepts. Returns the link id."""
    invite = client.post("/care-links/invitations", json={"email": caregiver.email}, headers=patient.auth)
    assert invite.status_code == 201, invite.text
    link_id = invite.json()["id"]
    accepted = client.post(f"/care-links/invitations/{link_id}/accept", headers=caregiver.auth)
    assert accepted.status_code == 200, accepted.text
    return link_id
