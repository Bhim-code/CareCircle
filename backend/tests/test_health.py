from app.api.routes import health as health_module


def test_health_ok_when_database_is_up(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_health_503_when_database_is_down(client, monkeypatch):
    monkeypatch.setattr(health_module, "database_is_reachable", lambda: False)
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "database": "unavailable"}


def test_health_needs_no_sign_in(client):
    assert client.get("/health").status_code != 401


def test_docs_page_is_available_outside_production(client):
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200
