"""Issue 3: sign-up, sign-in, refresh, sign-out, password reset, /me."""

import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.db.models import User
from app.main import create_app
from app.services import mailer
from tests.helpers import PASSWORD, sign_in, sign_up, staff


@pytest.fixture(autouse=True)
def _clear_outbox():
    mailer.outbox.clear()


def test_sign_up_patient_returns_tokens_and_user(client):
    response = client.post("/auth/sign-up", json={
        "name": " Ana Patient ", "email": "Ana@Test.example", "password": PASSWORD, "role": "patient"})
    assert response.status_code == 201
    body = response.json()
    assert body["user"]["role"] == "patient"
    assert body["user"]["email"] == "ana@test.example"
    assert body["user"]["name"] == "Ana Patient"
    assert body["accessToken"] and body["refreshToken"] and body["expiresIn"] == 900
    assert "password" not in response.text.lower()


@pytest.mark.parametrize("role", ["admin", "supervisor", "superuser", ""])
def test_sign_up_cannot_create_staff_or_unknown_roles(client, role):
    response = client.post("/auth/sign-up", json={
        "name": "Eve", "email": "eve@test.example", "password": PASSWORD, "role": role})
    assert response.status_code == 422
    assert "role" in response.json()["error"]["fields"]


def test_sign_up_rejects_extra_fields_like_is_active(client):
    response = client.post("/auth/sign-up", json={
        "name": "Eve", "email": "eve@test.example", "password": PASSWORD, "role": "patient",
        "isActive": True})
    assert response.status_code == 422


def test_password_is_hashed_with_argon2(client, db):
    sign_up(client, "Ana", "patient")
    stored = db.scalar(select(User.password_hash))
    assert stored.startswith("$argon2id$") and PASSWORD not in stored


def test_short_password_and_duplicate_email_rejected(client):
    short = client.post("/auth/sign-up", json={"name": "A", "email": "a@test.example",
                                                "password": "short", "role": "patient"})
    assert short.status_code == 422 and "password" in short.json()["error"]["fields"]
    sign_up(client, "Ana", "patient", email="ana@test.example")
    again = client.post("/auth/sign-up", json={"name": "Ana", "email": "ANA@test.example",
                                                "password": PASSWORD, "role": "caregiver"})
    assert again.status_code == 409


def test_wrong_password_and_unknown_email_look_the_same(client):
    sign_up(client, "Ana", "patient", email="ana@test.example")
    wrong = client.post("/auth/sign-in", json={"email": "ana@test.example", "password": "nope-nope"})
    unknown = client.post("/auth/sign-in", json={"email": "who@test.example", "password": "nope-nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_me_needs_a_valid_token(client):
    ana = sign_up(client, "Ana", "patient")
    assert client.get("/me").status_code == 401
    assert client.get("/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
    me = client.get("/me", headers=ana.auth)
    assert me.status_code == 200
    assert me.json() == {"id": ana.id, "email": ana.email, "name": "Ana", "role": "patient",
                         "timezone": "UTC"}


def test_token_signed_with_another_secret_is_refused(client):
    import jwt
    ana = sign_up(client, "Ana", "patient")
    claims = jwt.decode(ana.access_token, options={"verify_signature": False})
    claims["role"] = "admin"
    forged = jwt.encode(claims, "some-other-secret-that-is-long-enough!!", algorithm="HS256")
    assert client.get("/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_patch_me_cannot_change_role_or_email(client):
    ana = sign_up(client, "Ana", "patient")
    assert client.patch("/me", json={"role": "admin"}, headers=ana.auth).status_code == 422
    assert client.patch("/me", json={"email": "x@test.example"}, headers=ana.auth).status_code == 422
    ok = client.patch("/me", json={"name": "Ana P", "timezone": "America/St_Johns"}, headers=ana.auth)
    assert ok.json()["name"] == "Ana P" and ok.json()["timezone"] == "America/St_Johns"
    bad_tz = client.patch("/me", json={"timezone": "Mars/Base"}, headers=ana.auth)
    assert bad_tz.status_code == 422


def test_refresh_rotates_and_old_token_stops_working(client):
    ana = sign_up(client, "Ana", "patient")
    first = client.post("/auth/refresh", json={"refreshToken": ana.refresh_token})
    assert first.status_code == 200
    new = first.json()
    assert new["refreshToken"] != ana.refresh_token
    assert client.get("/me", headers={"Authorization": f"Bearer {new['accessToken']}"}).status_code == 200
    # Second use of the old refresh token = stolen copy: the whole sign-in ends.
    assert client.post("/auth/refresh", json={"refreshToken": ana.refresh_token}).status_code == 401
    assert client.post("/auth/refresh", json={"refreshToken": new["refreshToken"]}).status_code == 401
    assert client.get("/me", headers={"Authorization": f"Bearer {new['accessToken']}"}).status_code == 401


def test_sign_out_ends_this_session_only(client):
    ana = sign_up(client, "Ana", "patient", email="ana@test.example")
    other_phone = sign_in(client, "ana@test.example")
    assert client.post("/auth/sign-out", headers=ana.auth).status_code == 204
    assert client.get("/me", headers=ana.auth).status_code == 401
    assert client.post("/auth/refresh", json={"refreshToken": ana.refresh_token}).status_code == 401
    assert client.get("/me", headers=other_phone.auth).status_code == 200


def test_deactivated_account_is_locked_out_at_once(client, db):
    from app.cli import set_active
    ana = sign_up(client, "Ana", "patient", email="ana@test.example")
    set_active("ana@test.example", False)
    assert client.get("/me", headers=ana.auth).status_code == 401
    response = client.post("/auth/sign-in", json={"email": "ana@test.example", "password": PASSWORD})
    assert response.status_code == 401


def test_password_reset_never_reveals_if_email_exists(client):
    sign_up(client, "Ana", "patient", email="ana@test.example")
    known = client.post("/auth/password-reset", json={"email": "ana@test.example"})
    unknown = client.post("/auth/password-reset", json={"email": "nobody@test.example"})
    assert known.status_code == unknown.status_code == 204
    assert known.content == unknown.content == b""
    assert len(mailer.outbox) == 1


def test_password_reset_flow_changes_password_and_signs_out_everywhere(client):
    ana = sign_up(client, "Ana", "patient", email="ana@test.example")
    client.post("/auth/password-reset", json={"email": "ana@test.example"})
    token = re.search(r"token=([\w-]+)", mailer.outbox[-1].get_content()).group(1)

    weak = client.post("/auth/password-reset/confirm", json={"token": token, "newPassword": "x"})
    assert weak.status_code == 422
    done = client.post("/auth/password-reset/confirm", json={"token": token, "newPassword": "new-pass-123"})
    assert done.status_code == 204
    assert client.get("/me", headers=ana.auth).status_code == 401
    sign_in(client, "ana@test.example", "new-pass-123")
    reused = client.post("/auth/password-reset/confirm", json={"token": token, "newPassword": "again-123"})
    assert reused.status_code == 422


def test_reset_email_contains_no_health_information(client):
    sign_up(client, "Ana", "patient", email="ana@test.example")
    client.post("/auth/password-reset", json={"email": "ana@test.example"})
    body = mailer.outbox[-1].get_content().lower()
    assert "medicine" not in body and "dose" not in body


def test_staff_accounts_can_sign_in(client):
    sup = staff(client, "supervisor")
    assert client.get("/me", headers=sup.auth).json()["role"] == "supervisor"


def test_sign_in_is_rate_limited(client):
    sign_up(client, "Ana", "patient", email="ana@test.example")
    codes = [client.post("/auth/sign-in", json={"email": "ana@test.example", "password": "wrong-pass"})
             .status_code for _ in range(7)]
    assert codes[:5] == [401] * 5
    assert codes[5] == 429
    limited = client.post("/auth/sign-in", json={"email": "ana@test.example", "password": PASSWORD})
    assert limited.status_code == 429 and "Retry-After" in limited.headers


def test_https_required_when_forced(monkeypatch):
    monkeypatch.setenv("FORCE_HTTPS", "true")
    app = create_app(Settings())
    plain = TestClient(app, base_url="http://api.test")
    secure = TestClient(app, base_url="https://api.test")
    assert plain.get("/me").status_code == 403
    assert plain.get("/me").json()["error"]["code"] == "https_required"
    assert plain.get("/health").status_code in (200, 503)
    response = secure.get("/me")
    assert response.status_code == 401
    assert "max-age" in response.headers["strict-transport-security"]


def test_production_refuses_placeholder_secret(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("JWT_SECRET", "change-me-change-me-change-me-change-me")
    with pytest.raises(ValueError):
        Settings()
