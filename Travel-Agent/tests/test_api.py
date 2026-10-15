from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage

import app.main as main_module
from app.auth import require_identity


class FakeGraph:
    def get_state(self, config):
        return None

    def invoke(self, payload, config):
        return {"messages": payload["messages"] + [AIMessage(content="Here is your Tokyo itinerary: Day 1 ...")]}


def test_health_endpoint():
    client = TestClient(main_module.app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_chat_asks_for_clarification_when_intent_unclear(monkeypatch):
    monkeypatch.setattr(main_module, "get_graph", lambda: FakeGraph())
    monkeypatch.setattr(main_module, "get_llm", lambda: object())
    monkeypatch.setattr(
        main_module,
        "extract_intent",
        lambda message, history, llm: {
            "city": None,
            "days": None,
            "budget": None,
            "clear": False,
            "clarification_question": "Which city ke liye plan banau?",
        },
    )

    monkeypatch.setitem(
        main_module.app.dependency_overrides,
        require_identity,
        lambda: {"user_id": "u1"},
    )
    client = TestClient(main_module.app)
    resp = client.post(
        "/chat", json={"user_id": "u1", "session_id": "s1", "message": "plan a trip"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["needs_clarification"] is True
    assert "Which city" in body["response"]


def test_chat_full_flow_when_intent_clear(monkeypatch):
    monkeypatch.setattr(main_module, "get_graph", lambda: FakeGraph())
    monkeypatch.setattr(main_module, "get_llm", lambda: object())
    monkeypatch.setattr(
        main_module,
        "extract_intent",
        lambda message, history, llm: {
            "city": "Tokyo",
            "days": 2,
            "budget": "medium",
            "clear": True,
            "clarification_question": None,
        },
    )
    monkeypatch.setattr(main_module, "get_preferences", lambda user_id, query: ["vegetarian"])
    monkeypatch.setattr(
        main_module,
        "plan_trip",
        lambda city, llm, days, budget: ["Check weather", "Find attractions", "Estimate budget"],
    )
    monkeypatch.setattr(main_module, "extract_and_save_preferences", lambda *a, **k: [])

    monkeypatch.setitem(
        main_module.app.dependency_overrides,
        require_identity,
        lambda: {"user_id": "u1"},
    )
    client = TestClient(main_module.app)
    resp = client.post(
        "/chat", json={"user_id": "u1", "session_id": "s2", "message": "Plan my Tokyo trip"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["needs_clarification"] is False
    assert "itinerary" in body["response"].lower()
    assert body["session_id"] == "s2"


def test_chat_requires_bearer_token():
    client = TestClient(main_module.app)
    resp = client.post(
        "/chat",
        json={"user_id": "u1", "session_id": "auth-1", "message": "plan a trip"},
    )
    assert resp.status_code == 401


def test_chat_rejects_mismatched_user_id(monkeypatch):
    monkeypatch.setitem(
        main_module.app.dependency_overrides,
        require_identity,
        lambda: {"user_id": "verified-user"},
    )
    client = TestClient(main_module.app)
    resp = client.post(
        "/chat",
        json={
            "user_id": "different-user",
            "session_id": "auth-2",
            "message": "plan a trip",
        },
    )
    assert resp.status_code == 403
