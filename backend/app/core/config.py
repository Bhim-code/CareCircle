"""All settings come from environment variables (or a local .env file).

Nothing secret is ever written in the code. See .env.example for the full list.
"""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # "development" shows the API docs page; "production" hides it.
    environment: Literal["development", "test", "production"] = "development"

    # PostgreSQL connection, for example:
    # postgresql+psycopg://carecircle:carecircle@localhost:5432/carecircle
    database_url: str

    # Web origins allowed to call the API from a browser (the admin panel).
    # Comma-separated in the environment variable.
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5500"]

    log_level: str = "INFO"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("cors_origins")
    @classmethod
    def _no_wildcard_in_production(cls, value: list[str], info) -> list[str]:
        if info.data.get("environment") == "production" and "*" in value:
            raise ValueError("CORS_ORIGINS cannot be '*' in production")
        return value

    @property
    def show_docs(self) -> bool:
        return self.environment != "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
