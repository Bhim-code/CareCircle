"""Every error leaves the API in the shape agreed in api-contract.md:

    { "error": { "code": "...", "message": "..." } }

plus "fields" for 422. Messages never contain request data, so no health
information can leak into a response or a log through an error.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("carecircle")

# HTTP status -> contract error code
_CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "too_large",
    415: "unsupported_media_type",
    422: "invalid",
    429: "too_many_requests",
}

_DEFAULT_MESSAGES = {
    401: "Please sign in.",
    403: "You are not allowed to do this.",
    404: "Not found.",
    405: "This method is not allowed here.",
    429: "Too many requests. Please wait and try again.",
}


class ApiError(Exception):
    """Raise this from any endpoint to return a contract-shaped error."""

    def __init__(self, status: int, message: str | None = None, *, code: str | None = None,
                 fields: dict[str, str] | None = None,
                 headers: dict[str, str] | None = None) -> None:
        self.status = status
        self.headers = headers
        self.code = code or _CODES.get(status, "error")
        self.message = message or _DEFAULT_MESSAGES.get(status, "Something went wrong.")
        self.fields = fields
        super().__init__(self.message)


def error_body(code: str, message: str, fields: dict[str, str] | None = None) -> dict:
    error: dict = {"code": code, "message": message}
    if fields:
        error["fields"] = fields
    return {"error": error}


def _field_name(location: tuple) -> str:
    # ("body", "notes") -> "notes"; ("query", "day") -> "day"
    parts = [str(p) for p in location if p not in ("body", "query", "path", "header")]
    return ".".join(parts) or "request"


def _friendly(err: dict) -> str:
    """Plain-language messages for the common cases; pydantic's text otherwise."""
    kind, ctx = err.get("type", ""), err.get("ctx") or {}
    if kind == "string_too_long":
        return f"Please keep this under {ctx.get('max_length')} characters."
    if kind == "string_too_short":
        return "This is required." if ctx.get("min_length") == 1 else \
            f"Please use at least {ctx.get('min_length')} characters."
    if kind == "missing":
        return "This is required."
    if kind in ("literal_error", "enum"):
        return f"Choose one of: {ctx.get('expected', 'the allowed values')}."
    if kind == "extra_forbidden":
        return "This field is not allowed."
    message = str(err.get("msg", "Invalid value."))
    return message.removeprefix("Value error, ")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, exc.message, exc.fields), status_code=exc.status,
                            headers=exc.headers)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        status = exc.status_code
        message = _DEFAULT_MESSAGES.get(status) or (exc.detail if isinstance(exc.detail, str) else "Error.")
        return JSONResponse(
            error_body(_CODES.get(status, "error"), message),
            status_code=status,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields: dict[str, str] = {}
        for err in exc.errors():
            # Use pydantic's message only; never echo the submitted value back.
            fields.setdefault(_field_name(tuple(err.get("loc", ()))), _friendly(err))
        return JSONResponse(
            error_body("invalid", "Some fields need attention.", fields), status_code=422
        )

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        # Log the type and route only. No bodies, no values.
        logger.error("Unhandled %s on %s %s", type(exc).__name__, request.method, request.url.path)
        return JSONResponse(error_body("internal", "Something went wrong."), status_code=500)
