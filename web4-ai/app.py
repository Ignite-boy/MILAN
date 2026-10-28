"""Internal-only FastAPI service for Milan Web4 AI."""
import hashlib
import hmac
import json
import os
import tempfile
import threading
from pathlib import Path

import torch
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from model import NextItemGRU

ROOT = Path(__file__).resolve().parent

DATA_DIR = Path(os.environ.get(
    "MILAN_WEB4_DATA_DIR",
    str(Path.home() / ".local" / "share" / "milan-web4-ai"),
)).expanduser()

SEQUENCES_FILE = DATA_DIR / "sequences.json"

MODEL_PATH = Path(os.environ.get(
    "MILAN_WEB4_MODEL_PATH",
    str(ROOT / "next_item_gru.pt"),
)).expanduser()

SHARED_SECRET = os.environ.get("MILAN_WEB4_AI_SECRET", "").strip()

MAX_ACTIVE_USERS = 2000
MAX_SEQUENCE_LENGTH = 100
MAX_ID_LENGTH = 256
DEFAULT_CONTEXT_LENGTH = 16

DATA_DIR.mkdir(parents=True, exist_ok=True)

LOCK = threading.RLock()
MODEL_LOCK = threading.Lock()


class ViewEvent(BaseModel):
    user_id: str = Field(min_length=1, max_length=MAX_ID_LENGTH)
    record_id: str = Field(min_length=1, max_length=MAX_ID_LENGTH)


class PredictRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=MAX_ID_LENGTH)
    top_k: int = Field(default=3, ge=1, le=10)


def _valid_id(value):
    return (
        isinstance(value, str)
        and bool(value.strip())
        and len(value.strip()) <= MAX_ID_LENGTH
        and not any(ord(ch) < 32 for ch in value)
    )


def _require_secret(candidate):
    if not SHARED_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Internal AI service secret is not configured",
        )

    if not candidate or not hmac.compare_digest(
        candidate, SHARED_SECRET
    ):
        raise HTTPException(status_code=401, detail="Invalid internal key")


def _user_key(user_id):
    # Persist a keyed pseudonymous identifier, not a raw account ID.
    value = SHARED_SECRET + "|" + user_id
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _load_sequences():
    try:
        raw = json.loads(SEQUENCES_FILE.read_text(encoding="utf-8"))
        stored = raw.get("sequences", {}) if isinstance(raw, dict) else {}
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        print("[WEB4 AI] Could not read sequence store; starting empty.")
        return {}

    result = {}

    if not isinstance(stored, dict):
        return result

    for key, items in list(stored.items())[-MAX_ACTIVE_USERS:]:
        if not isinstance(key, str) or not isinstance(items, list):
            continue

        clean_items = [
            item.strip()
            for item in items
            if _valid_id(item)
        ][-MAX_SEQUENCE_LENGTH:]

        result[key] = clean_items

    return result


sequences = _load_sequences()


def _save_sequences_locked():
    """Atomically persist bounded sequences; caller must hold LOCK."""
    handle = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=str(DATA_DIR),
        prefix="sequences-",
        suffix=".tmp",
        delete=False,
    )
    temporary_path = Path(handle.name)

    try:
        with handle:
            json.dump(
                {"format_version": 1, "sequences": sequences},
                handle,
                separators=(",", ":"),
            )

        os.replace(temporary_path, SEQUENCES_FILE)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


_model_bundle = None
_model_mtime = -1.0


def _get_model_bundle():
    """Load or reload a trained checkpoint only when its file changes."""
    global _model_bundle, _model_mtime

    try:
        mtime = MODEL_PATH.stat().st_mtime
    except FileNotFoundError:
        return None

    with MODEL_LOCK:
        if _model_bundle is not None and _model_mtime == mtime:
            return _model_bundle

        try:
            checkpoint = torch.load(
                MODEL_PATH,
                map_location="cpu",
                weights_only=True,
            )

            vocab = checkpoint["vocab"]
            if not isinstance(vocab, dict) or len(vocab) < 5:
                raise ValueError("Invalid model vocabulary")

            config = checkpoint.get("model_config", {})
            embedding_dim = int(config.get("embedding_dim", 32))
            hidden_dim = int(config.get("hidden_dim", 64))

            model = NextItemGRU(
                vocab_size=max(vocab.values()) + 1,
                embedding_dim=embedding_dim,
                hidden_dim=hidden_dim,
            )
            model.load_state_dict(checkpoint["state_dict"])
            model.eval()

            reverse_vocab = {
                int(index): item for item, index in vocab.items()
            }

            _model_bundle = (
                model,
                vocab,
                reverse_vocab,
                int(checkpoint.get(
                    "max_sequence_length", DEFAULT_CONTEXT_LENGTH
                )),
                checkpoint.get("metrics", {}),
            )
            _model_mtime = mtime

            print("[WEB4 AI] Trained GRU model loaded.")
            return _model_bundle

        except Exception as exc:
            _model_bundle = None
            _model_mtime = mtime
            print(
                "[WEB4 AI] Checkpoint unavailable:",
                type(exc).__name__,
            )
            return None


app = FastAPI(
    title="Milan Web4 AI",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
)


@app.get("/health")
def health():
    bundle = _get_model_bundle()

    with LOCK:
        user_count = len(sequences)

    return {
        "ok": True,
        "service": "milan-web4-ai",
        "device": "cpu",
        "model_ready": bundle is not None,
        "stored_user_sequences": user_count,
        "torch_version": torch.__version__,
    }


@app.post("/internal/v1/view")
def record_view(
    payload: ViewEvent,
    x_milan_ai_key: str | None = Header(
        default=None, alias="X-Milan-AI-Key"
    ),
):
    _require_secret(x_milan_ai_key)

    user_id = payload.user_id.strip()
    record_id = payload.record_id.strip()

    if not _valid_id(user_id) or not _valid_id(record_id):
        raise HTTPException(status_code=422, detail="Invalid identifier")

    key = _user_key(user_id)

    with LOCK:
        recent = sequences.pop(key, [])
        recent.append(record_id)

        sequences[key] = recent[-MAX_SEQUENCE_LENGTH:]

        while len(sequences) > MAX_ACTIVE_USERS:
            sequences.pop(next(iter(sequences)))

        _save_sequences_locked()
        length = len(sequences[key])

    return {"ok": True, "sequence_length": length}


@app.post("/internal/v1/predict")
def predict_next(
    payload: PredictRequest,
    x_milan_ai_key: str | None = Header(
        default=None, alias="X-Milan-AI-Key"
    ),
):
    _require_secret(x_milan_ai_key)

    user_id = payload.user_id.strip()
    if not _valid_id(user_id):
        raise HTTPException(status_code=422, detail="Invalid user identifier")

    with LOCK:
        history = list(sequences.get(_user_key(user_id), []))

    if not history:
        return {
            "model_ready": False,
            "predictions": [],
            "reason": "no_viewing_history",
        }

    bundle = _get_model_bundle()

    if bundle is None:
        return {
            "model_ready": False,
            "predictions": [],
            "reason": "model_not_trained",
        }

    model, vocab, reverse_vocab, max_length, metrics = bundle

    # Keep the most recent context. Unseen items map to the padding/unknown
    # index, so a newly-created record does not break inference.
    context_items = history[-max(2, max_length):]
    encoded = [vocab.get(item, 0) for item in context_items]

    if sum(index != 0 for index in encoded) < 2:
        return {
            "model_ready": True,
            "predictions": [],
            "reason": "insufficient_known_history",
            "metrics": metrics,
        }

    input_ids = torch.tensor([encoded], dtype=torch.long)
    lengths = torch.tensor([len(encoded)], dtype=torch.long)

    with torch.inference_mode():
        logits = model(input_ids, lengths)
        logits[:, 0] = -1e9
        probabilities = torch.softmax(logits, dim=-1)[0]

        k = min(len(vocab), max(payload.top_k * 4, payload.top_k))
        values, indices = torch.topk(probabilities, k=k)

    seen = set(history)
    predictions = []

    for score, index in zip(values.tolist(), indices.tolist()):
        record_id = reverse_vocab.get(index)

        if not record_id or record_id in seen:
            continue

        predictions.append({
            "record_id": record_id,
            "score": round(float(score), 6),
        })

        if len(predictions) >= payload.top_k:
            break

    return {
        "model_ready": True,
        "predictions": predictions,
        "metrics": metrics,
    }
