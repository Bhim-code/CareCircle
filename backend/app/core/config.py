"""All settings come from environment variables (or a local .env file).

Nothing secret is ever written in the code. See .env.example for the full list.
"""

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    # env_ignore_empty: a blank line like "FORCE_HTTPS=" means "use the default".
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore",
                                      env_ignore_empty=True)

    # "development" shows the API docs page; "production" hides it.
    environment: Literal["development", "test", "production"] = "development"

    # PostgreSQL connection, for example:
    # postgresql+psycopg://carecircle:carecircle@localhost:5432/carecircle
    database_url: str

    # Web origins allowed to call the API from a browser (the admin panel).
    # Comma-separated in the environment variable.
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5500"]

    log_level: str = "INFO"

    # --- Sign-in -------------------------------------------------------------
    # Signs the access tokens. Long and random; different in every environment.
    jwt_secret: str = Field(min_length=32)
    access_token_minutes: int = Field(default=15, ge=1, le=60)
    refresh_token_days: int = Field(default=30, ge=1, le=90)
    password_reset_minutes: int = Field(default=30, ge=5, le=120)
    # Where the "choose a new password" link in the reset email points.
    password_reset_url: str = "carecircle://reset-password"

    # --- Protection ----------------------------------------------------------
    rate_limit_enabled: bool = True
    # Behind a proxy (Render, Railway, nginx) trust X-Forwarded-For / -Proto.
    trust_proxy_headers: bool = False
    # Refuse plain HTTP (except /health). Defaults to on in production.
    force_https: bool | None = None

    # --- Files ---------------------------------------------------------------
    photo_dir: Path = Path("storage/photos")
    photo_link_minutes: int = Field(default=15, ge=1, le=1440)
    # Public base URL of this API, used to build photo links. Empty = relative links.
    public_base_url: str = ""

    # --- Email and notifications (background jobs) ---------------------------
    smtp_host: str = ""  # empty = emails are written to the log instead of sent
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "CareCircle <no-reply@carecircle.local>"
    smtp_starttls: bool = True
    # "log" writes push notifications to the log; "expo" sends them via Expo.
    push_provider: Literal["log", "expo"] = "log"
    missed_dose_after_minutes: int = Field(default=60, ge=1)

    @field_validator("database_url")
    @classmethod
    def _psycopg_driver(cls, value: str) -> str:
        """Hosts like Render and Railway give postgres://... ; SQLAlchemy needs the driver named."""
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix):]
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def _production_rules(self) -> "Settings":
        if self.environment == "production":
            if "*" in self.cors_origins:
                raise ValueError("CORS_ORIGINS cannot be '*' in production")
            if "change-me" in self.jwt_secret:
                raise ValueError("Set a real JWT_SECRET in production")
        if self.force_https is None:
            self.force_https = self.environment == "production"
        return self

    @property
    def show_docs(self) -> bool:
        return self.environment != "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
