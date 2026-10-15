"""A small in-memory rate limiter for sign-in, sign-up and password reset.

Counts requests per key in a sliding window. It lives in one process, which is
fine for one API server; with several servers, move the counts to Redis.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import ApiError


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: int) -> int | None:
        """Record one request. Returns seconds to wait if over the limit, else None."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] <= now - window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                return max(1, int(hits[0] + window_seconds - now) + 1)
            hits.append(now)
            return None


def client_ip(request: Request) -> str:
    if get_settings().trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce(request: Request, name: str, limit: int, window_seconds: int, *extra_keys: str) -> None:
    """Raise 429 when this IP (or any extra key, such as an email) is over the limit."""
    if not get_settings().rate_limit_enabled:
        return
    limiter: RateLimiter = request.app.state.rate_limiter
    keys = [f"{name}:ip:{client_ip(request)}", *(f"{name}:{k}" for k in extra_keys if k)]
    for key in keys:
        wait = limiter.hit(key, limit, window_seconds)
        if wait is not None:
            raise ApiError(429, headers={"Retry-After": str(wait)})
