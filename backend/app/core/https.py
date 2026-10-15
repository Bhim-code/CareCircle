"""HTTPS only when deployed (FORCE_HTTPS, on by default in production).

Plain-HTTP requests are refused (not redirected: a redirect would already have
sent the token in clear text). /health stays reachable for the host's checks.
Every response tells browsers to use HTTPS from now on (HSTS).
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.errors import error_body


class HttpsOnlyMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, trust_proxy_headers: bool = False) -> None:
        super().__init__(app)
        self.trust_proxy_headers = trust_proxy_headers

    async def dispatch(self, request: Request, call_next) -> Response:
        scheme = request.url.scheme
        if self.trust_proxy_headers:
            scheme = request.headers.get("x-forwarded-proto", scheme).split(",")[0].strip()
        if scheme != "https" and request.url.path != "/health":
            return JSONResponse(error_body("https_required", "Use HTTPS."), status_code=403)
        response = await call_next(request)
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Small, safe defaults for every response. API responses are never cached."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Cache-Control", "no-store")
        return response
