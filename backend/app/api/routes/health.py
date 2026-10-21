from typing import Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.db.session import database_is_reachable
from app.schemas.base import CamelModel

router = APIRouter(tags=["health"])


class HealthResponse(CamelModel):
    status: Literal["ok", "degraded"]
    database: Literal["ok", "unavailable"]


@router.get(
    "/health",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse, "description": "The database cannot be reached."}},
    summary="Is the API up, and can it reach the database?",
)
def health() -> HealthResponse | JSONResponse:
    """No sign-in needed. Reveals nothing about users or data."""
    if database_is_reachable():
        return HealthResponse(status="ok", database="ok")
    body = HealthResponse(status="degraded", database="unavailable")
    return JSONResponse(body.model_dump(by_alias=True), status_code=503)
