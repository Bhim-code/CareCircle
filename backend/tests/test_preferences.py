"""Issue 9: settings and push tokens."""

from sqlalchemy import select

from app.db.models import PushToken
from tests.helpers import sign_in, sign_up

DEFAULTS = {"largerText": False, "reminderNotifications": True, "missedDoseEmail": True,
            "missedDoseCall": False}


def test_defaults_then_saved_and_seen_on_another_phone(client):
    ana = sign_up(client, "Ana", "patient", email="ana@test.example")
    assert client.get("/me/preferences", headers=ana.auth).json() == DEFAULTS
    new = {**DEFAULTS, "largerText": True, "missedDoseCall": True}
    assert client.put("/me/preferences", json=new, headers=ana.auth).json() == new
    other_phone = sign_in(client, "ana@test.example")
    assert client.get("/me/preferences", headers=other_phone.auth).json() == new


def test_preferences_are_per_person_and_validated(client):
    ana = sign_up(client, "Ana", "patient")
    bob = sign_up(client, "Bob", "patient")
    client.put("/me/preferences", json={**DEFAULTS, "largerText": True}, headers=ana.auth)
    assert client.get("/me/preferences", headers=bob.auth).json() == DEFAULTS
    assert client.put("/me/preferences", json={"largerText": True}, headers=ana.auth).status_code == 422
    assert client.put("/me/preferences", json={**DEFAULTS, "largerText": "yes please"},
                      headers=ana.auth).status_code == 422
    assert client.get("/me/preferences").status_code == 401


def test_push_token_saved_moved_and_removed(client, db):
    ana = sign_up(client, "Ana", "patient")
    sam = sign_up(client, "Sam", "caregiver")
    token = {"token": "ExponentPushToken[abc123]"}
    assert client.put("/me/push-token", json=token, headers=ana.auth).status_code == 204
    assert client.put("/me/push-token", json=token, headers=ana.auth).status_code == 204
    # Sam signs in on the same phone: the token now belongs to Sam only.
    client.put("/me/push-token", json=token, headers=sam.auth)
    rows = db.scalars(select(PushToken)).all()
    assert [(str(r.user_id), r.token) for r in rows] == [(sam.id, token["token"])]
    # Ana cannot remove Sam's token.
    client.request("DELETE", "/me/push-token", json=token, headers=ana.auth)
    assert len(db.scalars(select(PushToken)).all()) == 1
    client.request("DELETE", "/me/push-token", json=token, headers=sam.auth)
    db.expire_all()
    assert db.scalars(select(PushToken)).all() == []
    assert client.put("/me/push-token", json={"token": ""}, headers=ana.auth).status_code == 422
