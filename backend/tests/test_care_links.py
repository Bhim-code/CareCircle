"""Issue 4: caregiver links."""

from tests.helpers import link, sign_up


def test_invite_accept_and_both_sides_see_the_link(client):
    ana = sign_up(client, "Ana", "patient")
    sam = sign_up(client, "Sam", "caregiver")
    invite = client.post("/care-links/invitations", json={"email": "SAM@test.example"}, headers=ana.auth)
    assert invite.status_code == 201
    assert invite.json()["status"] == "pending" and invite.json()["invitedEmail"] == "sam@test.example"

    pending = client.get("/care-links", headers=sam.auth).json()
    assert [p["id"] for p in pending] == [invite.json()["id"]]

    accepted = client.post(f"/care-links/invitations/{invite.json()['id']}/accept", headers=sam.auth)
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "active" and accepted.json()["caregiver"]["id"] == sam.id
    assert client.get("/care-links", headers=ana.auth).json()[0]["status"] == "active"


def test_invitation_waits_for_a_caregiver_who_signs_up_later(client):
    ana = sign_up(client, "Ana", "patient")
    invite = client.post("/care-links/invitations", json={"email": "new@test.example"}, headers=ana.auth)
    newbie = sign_up(client, "New", "caregiver", email="new@test.example")
    assert client.post(f"/care-links/invitations/{invite.json()['id']}/accept",
                       headers=newbie.auth).status_code == 200


def test_only_patients_invite_and_only_the_invited_caregiver_accepts(client):
    ana = sign_up(client, "Ana", "patient")
    sam = sign_up(client, "Sam", "caregiver")
    eve = sign_up(client, "Eve", "caregiver")
    assert client.post("/care-links/invitations", json={"email": "ana@test.example"},
                       headers=sam.auth).status_code == 403
    invite = client.post("/care-links/invitations", json={"email": sam.email}, headers=ana.auth).json()
    # Another caregiver cannot accept someone else's invitation; they get 404, not 403.
    assert client.post(f"/care-links/invitations/{invite['id']}/accept", headers=eve.auth).status_code == 404
    assert client.get("/care-links", headers=eve.auth).json() == []
    # A patient cannot accept (role check).
    bob = sign_up(client, "Bob", "patient", email="bob@test.example")
    invite2 = client.post("/care-links/invitations", json={"email": "bob@test.example"}, headers=ana.auth)
    assert client.post(f"/care-links/invitations/{invite2.json()['id']}/accept",
                       headers=bob.auth).status_code == 403


def test_cannot_invite_self_or_twice(client):
    ana = sign_up(client, "Ana", "patient")
    assert client.post("/care-links/invitations", json={"email": ana.email}, headers=ana.auth).status_code == 422
    client.post("/care-links/invitations", json={"email": "sam@test.example"}, headers=ana.auth)
    again = client.post("/care-links/invitations", json={"email": "sam@test.example"}, headers=ana.auth)
    assert again.status_code == 409


def test_either_side_can_end_a_link_and_strangers_cannot(client):
    ana = sign_up(client, "Ana", "patient")
    sam = sign_up(client, "Sam", "caregiver")
    eve = sign_up(client, "Eve", "caregiver")
    link_id = link(client, ana, sam)
    assert client.delete(f"/care-links/{link_id}", headers=eve.auth).status_code == 404
    assert client.delete(f"/care-links/{link_id}", headers=sam.auth).status_code == 204
    assert client.get("/care-links", headers=ana.auth).json() == []
    ended = client.get("/care-links?includeEnded=true", headers=ana.auth).json()
    assert ended[0]["status"] == "ended"
    # After ending, the pair can be linked again.
    link(client, ana, sam)


def test_accepted_invitation_cannot_be_accepted_again(client):
    ana = sign_up(client, "Ana", "patient")
    sam = sign_up(client, "Sam", "caregiver")
    link_id = link(client, ana, sam)
    assert client.post(f"/care-links/invitations/{link_id}/accept", headers=sam.auth).status_code == 404
