"""Developer mode authentication gating using X-Dev-Token and hmac comparison."""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header, Request

from app.core.errors import APIError


def is_dev_request(request: Request) -> bool:
    """Verifies whether the incoming request carries a valid X-Dev-Token header.
    When DEV_TOKEN is unset or empty, developer features are open (local / demo mode).
    """
    settings = getattr(request.app.state, "settings", None)
    if settings is None:
        return True
    configured_token: str | None = getattr(settings, "DEV_TOKEN", None)
    if not configured_token:
        # Open access in local/demo environment
        return True

    header_token = request.headers.get("X-Dev-Token")
    if not header_token:
        return False

    return hmac.compare_digest(
        header_token.strip().encode("utf-8"),
        configured_token.strip().encode("utf-8"),
    )


def require_dev_token(request: Request) -> None:
    """FastAPI dependency to enforce developer mode access."""
    if not is_dev_request(request):
        raise APIError(
            403,
            "forbidden",
            "Chức năng này yêu cầu quyền nhà phát triển (X-Dev-Token hợp lệ).",
        )
