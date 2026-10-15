"""CareCircle API. Start with:  uvicorn app.main:app --reload"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import health
from app.core.config import Settings, get_settings
from app.core.errors import install_error_handlers


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level)

    app = FastAPI(
        title="CareCircle API",
        version="0.1.0",
        description="Backend for the CareCircle app and admin panel. See api-contract.md.",
        docs_url="/docs" if settings.show_docs else None,
        redoc_url="/redoc" if settings.show_docs else None,
        openapi_url="/openapi.json" if settings.show_docs else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,  # we use Bearer tokens, not cookies
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    install_error_handlers(app)
    app.include_router(health.router)
    return app


app = create_app()
