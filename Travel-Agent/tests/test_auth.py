from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.auth import require_identity


def creds(token="signed-milan-token"):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_identity_comes_from_milan_auth_response(monkeypatch):
    monkeypatch.setenv("MILAN_AUTH_URL", "https://milan.example.test/api/auth/me")
    response = Mock(status_code=200)
    response.json.return_value = {"id": "user-123", "did": "did:key:test", "email": "user@example.test"}
    request = Mock(return_value=response)
    monkeypatch.setattr("app.auth.requests.get", request)

    identity = require_identity(creds())

    assert identity["user_id"] == "user-123"
    assert identity["did"] == "did:key:test"
    request.assert_called_once_with(
        "https://milan.example.test/api/auth/me",
        headers={"Authorization": "Bearer signed-milan-token"},
        timeout=(3.0, 8.0),
    )


def test_missing_bearer_token_is_rejected():
    with pytest.raises(HTTPException) as exc:
        require_identity(None)
    assert exc.value.status_code == 401


def test_invalid_token_is_rejected(monkeypatch):
    response = Mock(status_code=401)
    monkeypatch.setattr("app.auth.requests.get", Mock(return_value=response))
    with pytest.raises(HTTPException) as exc:
        require_identity(creds("bad-token"))
    assert exc.value.status_code == 401


def test_identity_provider_outage_fails_closed(monkeypatch):
    import requests
    monkeypatch.setattr("app.auth.requests.get", Mock(side_effect=requests.Timeout("timeout")))
    with pytest.raises(HTTPException) as exc:
        require_identity(creds())
    assert exc.value.status_code == 503


def test_auth_endpoint_requires_https(monkeypatch):
    monkeypatch.setenv("MILAN_AUTH_URL", "http://identity.example.test/api/auth/me")
    with pytest.raises(HTTPException) as exc:
        require_identity(creds())
    assert exc.value.status_code == 503
