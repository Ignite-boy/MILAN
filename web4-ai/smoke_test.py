"""Isolated Web4 AI smoke test using temporary data and model paths."""
import json
import os
import tempfile
from pathlib import Path


def main():
    secret = os.environ.get("MILAN_WEB4_AI_SECRET", "").strip()
    assert secret, "The internal AI secret must be supplied through the environment."

    env_keys = ("MILAN_WEB4_DATA_DIR", "MILAN_WEB4_MODEL_PATH")
    previous = {key: os.environ.get(key) for key in env_keys}

    try:
        with tempfile.TemporaryDirectory(prefix="milan-web4-ai-smoke-") as temporary:
            test_root = Path(temporary).resolve()
            data_dir = test_root / "data"
            model_path = test_root / "next_item_gru.pt"

            os.environ["MILAN_WEB4_DATA_DIR"] = str(data_dir)
            os.environ["MILAN_WEB4_MODEL_PATH"] = str(model_path)

            # Import only after the test-specific paths are set.
            from fastapi import HTTPException
            from app import (
                DATA_DIR, MODEL_PATH, SEQUENCES_FILE, SHARED_SECRET,
                PredictRequest, ViewEvent, predict_next, record_view,
            )

            assert SHARED_SECRET == secret
            assert Path(DATA_DIR).resolve().is_relative_to(test_root)
            assert Path(SEQUENCES_FILE).resolve().is_relative_to(test_root)
            assert Path(MODEL_PATH).resolve().is_relative_to(test_root)

            try:
                record_view(
                    ViewEvent(user_id="smoke-user", record_id="record-a"),
                    x_milan_ai_key="incorrect-test-key",
                )
                raise AssertionError("Wrong internal key unexpectedly accepted.")
            except HTTPException as exc:
                assert exc.status_code == 401

            for record_id in ("record-a", "record-b", "record-c", "record-a"):
                result = record_view(
                    ViewEvent(user_id="smoke-user", record_id=record_id),
                    x_milan_ai_key=SHARED_SECRET,
                )
                assert result["ok"] is True

            stored = json.loads(Path(SEQUENCES_FILE).read_text(encoding="utf-8"))
            assert "smoke-user" not in json.dumps(stored)
            assert len(stored["sequences"]) == 1

            prediction = predict_next(
                PredictRequest(user_id="smoke-user"),
                x_milan_ai_key=SHARED_SECRET,
            )
            assert prediction["model_ready"] is False
            assert prediction["reason"] == "model_not_trained"
            assert prediction["predictions"] == []

            print("PASS: internal shared-key authentication.")
            print("PASS: pseudonymous sequence storage.")
            print("PASS: sequence persistence in temporary storage.")
            print("PASS: safe handling of an untrained model.")
            print("PASS: data and model paths isolated to a temporary directory.")
            print("ALL WEB4 AI SMOKE TESTS PASSED.")
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if __name__ == "__main__":
    main()
