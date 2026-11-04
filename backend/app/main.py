"""CareCircle API. Start with:  uvicorn app.main:app --reload"""

import logging

import email_validator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    admin,
    auth,
    care_links,
    entries,
    health,
    health_records,
    me,
    medicines,
    people,
    tasks,
)
from app.core.config import Settings, get_settings
from app.core.errors import install_error_handlers
from app.core.https import HttpsOnlyMiddleware, SecurityHeadersMiddleware
from app.core.rate_limit import RateLimiter


def allow_demo_email_domain(settings: Settings) -> None:
    """The demo accounts use @demo.carecircle.test. ".test" is a reserved name that the
    email check refuses, so outside production it is allowed; otherwise a demo patient
    could not invite the demo caregiver. Production keeps refusing it."""
    reserved = email_validator.SPECIAL_USE_DOMAIN_NAMES
    if settings.environment == "production":
        if "test" not in reserved:
            reserved.append("test")
    elif "test" in reserved:
        reserved.remove("test")


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
    app.state.rate_limiter = RateLimiter()
    allow_demo_email_domain(settings)

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,  # we use Bearer tokens, not cookies
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["Content-Disposition", "Retry-After"],
    )
    if settings.force_https:
        app.add_middleware(HttpsOnlyMiddleware,  # added last = runs first
                           trust_proxy_headers=settings.trust_proxy_headers)

    install_error_handlers(app)
    for router in (health.router, auth.router, me.router, care_links.router, medicines.router,
                   health_records.router, entries.router, entries.files_router, admin.router,
                   people.router, people.files_router, health_records.files_router,
                   tasks.router, tasks.admin_router):
        app.include_router(router)
    return app


app = create_app()
