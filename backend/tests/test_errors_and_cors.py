"""The error shape and CORS rules from api-contract.md."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import Field

from app.core.config import Settings
from app.core.errors import ApiError
from app.main import create_app
from app.schemas.base import CamelModel


class _Note(CamelModel):
    notes: str = Field(max_length=10)
    occurred_at: str


@pytest.fixture
def app_with_test_routes() -> FastAPI:
    app = create_app()

    @app.get("/_test/forbidden")
    def forbidden():
        raise ApiError(403)

    @app.post("/_test/note")
    def note(body: _Note):
        return body.model_dump(by_alias=True)

    @app.get("/_test/crash")
    def crash():
        raise RuntimeError("secret patient detail")

    return app


@pytest.fixture
def test_client(app_with_test_routes) -> TestClient:
    return TestClient(app_with_test_routes, raise_server_exceptions=False)


def test_unknown_route_uses_contract_shape(client):
    response = client.get("/does-not-exist")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found", "message": "Not found."}}


def test_api_error_uses_contract_shape(test_client):
    response = test_client.get("/_test/forbidden")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_validation_error_lists_camel_case_fields_without_echoing_values(test_client):
    response = test_client.post("/_test/note", json={"notes": "far too long text"})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "invalid"
    assert set(error["fields"]) == {"notes", "occurredAt"}
    assert "far too long text" not in response.text


def test_unknown_fields_are_rejected(test_client):
    response = test_client.post("/_test/note", json={"notes": "ok", "occurredAt": "x", "role": "admin"})
    assert response.status_code == 422
    assert "role" in response.json()["error"]["fields"]


def test_camel_case_in_and_out(test_client):
    response = test_client.post("/_test/note", json={"notes": "ok", "occurredAt": "2026-10-15"})
    assert response.json() == {"notes": "ok", "occurredAt": "2026-10-15"}


def test_unexpected_error_hides_details(test_client, caplog):
    response = test_client.get("/_test/crash")
    assert response.status_code == 500
    assert response.json() == {"error": {"code": "internal", "message": "Something went wrong."}}
    assert "secret patient detail" not in response.text
    assert "secret patient detail" not in caplog.text


def test_cors_allows_the_admin_panel(client):
    response = client.options(
        "/health",
        headers={"Origin": "http://localhost:5500", "Access-Control-Request-Method": "GET"},
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5500"


def test_cors_blocks_other_sites(client):
    response = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in response.headers


def test_cors_origins_parsed_from_comma_list(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://a.test, http://b.test")
    assert Settings().cors_origins == ["http://a.test", "http://b.test"]


def test_wildcard_cors_rejected_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CORS_ORIGINS", "*")
    with pytest.raises(ValueError):
        Settings()


def test_docs_hidden_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    prod = TestClient(create_app(Settings()))
    assert prod.get("/docs").status_code == 404
    assert prod.get("/openapi.json").status_code == 404
