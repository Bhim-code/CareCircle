import os

# Tests use their own database so they can never touch development data.
# Always overwrite DATABASE_URL, even if it is set in the shell or .env.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://carecircle:carecircle@localhost:5432/carecircle_test",
)
os.environ["ENVIRONMENT"] = "test"
os.environ["CORS_ORIGINS"] = "http://localhost:5500"
os.environ["JWT_SECRET"] = "test-secret-that-is-long-enough-0123456789"
os.environ["PHOTO_DIR"] = os.path.join(os.path.dirname(__file__), ".photos")

from collections.abc import Iterator  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db.models import Base  # noqa: E402
from app.db.session import get_engine  # noqa: E402
from app.main import create_app  # noqa: E402

BACKEND = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session", autouse=True)
def _migrated_database() -> None:
    """Build the test database from the migrations, exactly as production would be."""
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    command.downgrade(config, "base")
    command.upgrade(config, "head")


@pytest.fixture(autouse=True)
def _empty_tables() -> None:
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with get_engine().begin() as connection:
        # TRUNCATE does not fire the access_log row trigger, so tests can reset it.
        connection.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
def db() -> Iterator[Session]:
    with Session(get_engine(), expire_on_commit=False) as session:
        yield session


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(), raise_server_exceptions=False)
