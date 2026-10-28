"""Isolated service-logic smoke test using only temporary test data."""
import json
from fastapi import HTTPException
from app import SEQUENCES_FILE, SHARED_SECRET, PredictRequest, ViewEvent, predict_next, record_view


def main():
    assert SHARED_SECRET, "Smoke test must set a test-only shared secret."
    try:
        record_view(ViewEvent(user_id="smoke-user", record_id="record-a"),
                    x_milan_ai_key="incorrect-test-key")
        raise AssertionError("Wrong internal key unexpectedly accepted.")
    except HTTPException as exc:
        assert exc.status_code == 401

    for record_id in ["record-a", "record-b", "record-c", "record-a"]:
        result = record_view(ViewEvent(user_id="smoke-user", record_id=record_id),
                             x_milan_ai_key=SHARED_SECRET)
        assert result["ok"] is True

    stored = json.loads(SEQUENCES_FILE.read_text(encoding="utf-8"))
    assert "smoke-user" not in json.dumps(stored)
    assert len(stored["sequences"]) == 1
    prediction = predict_next(PredictRequest(user_id="smoke-user"), x_milan_ai_key=SHARED_SECRET)
    assert prediction["model_ready"] is False
    assert prediction["reason"] == "model_not_trained"
    assert prediction["predictions"] == []
    print("PASS: internal shared-key authentication.")
    print("PASS: viewing sequences stored under a pseudonymous key.")
    print("PASS: record sequence persistence.")
    print("PASS: service safely handles an untrained model.")
    print("ALL WEB4 AI SMOKE TESTS PASSED.")


if __name__ == "__main__":
    main()
