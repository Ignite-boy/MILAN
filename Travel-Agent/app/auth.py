"""Authenticate Travel Agent requests against MILAN's existing JWT verifier.

The shared token is validated by the MILAN API itself, avoiding a second copy
of JWT secrets across independent services. User identity is never trusted from
the request body.
"""
import os
from typing import Optional

import requests
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer(auto_error=False)
_DEFAULT_MILAN_AUTH_URL = "https://milan-api-4n3n.onrender.com/api/auth/me"


def require_identity(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials.strip():
        raise HTTPException(status_code=401, detail="A valid MILAN Bearer token is required.")

    auth_url = os.getenv("MILAN_AUTH_URL", _DEFAULT_MILAN_AUTH_URL).strip()
    if not auth_url.startswith("https://"):
        raise HTTPException(status_code=503, detail="MILAN_AUTH_URL must use HTTPS.")

    try:
        response = requests.get(
            auth_url,
            headers={"Authorization": f"Bearer {credentials.credentials.strip()}"},
            timeout=(3.0, 8.0),
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=503, detail="MILAN identity verification is temporarily unavailable.") from exc

    if response.status_code in (401, 403, 404):
        raise HTTPException(status_code=401, detail="MILAN token is invalid, expired, or no longer associated with an account.")
    if response.status_code < 200 or response.status_code >= 300:
        raise HTTPException(status_code=503, detail="MILAN identity verification could not be completed.")

    try:
        account = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="MILAN identity service returned invalid JSON.") from exc

    user_id = str(account.get("id") or "").strip() if isinstance(account, dict) else ""
    if not user_id:
        raise HTTPException(status_code=401, detail="MILAN identity response did not contain a verified user ID.")

    return {
        "user_id": user_id,
        "did": str(account.get("did") or ""),
        "email": str(account.get("email") or ""),
    }
