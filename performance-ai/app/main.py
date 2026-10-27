"""Internal-only performance AI API; Express integration is a later step."""
import hmac
import os
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from .model import AdaptivePrefetchModel

app = FastAPI(title="MILAN Performance AI", version="0.1.0")
model = AdaptivePrefetchModel()


class FeaturePayload(BaseModel):
    media_kind: Literal["image", "video", "audio", "other"] = "other"
    distance_viewports: float = Field(default=0, ge=0, le=10)
    size_bytes: int = Field(default=0, ge=0, le=1073741824)
    effective_type: Literal["slow-2g", "2g", "3g", "4g", "wifi", "unknown"] = "unknown"
    save_data: bool = False
    last_load_ms: float = Field(default=0, ge=0, le=120000)


class Candidate(FeaturePayload):
    record_id: str = Field(min_length=1, max_length=256)


class ScoreRequest(BaseModel):
    candidates: list[Candidate]

    @field_validator("candidates")
    @classmethod
    def validate_candidates(cls, value):
        if not 1 <= len(value) <= 100:
            raise ValueError("Provide between 1 and 100 candidates.")
        return value


class TrainingExample(BaseModel):
    feature: FeaturePayload
    label: int = Field(ge=0, le=1)


class TrainingRequest(BaseModel):
    samples: list[TrainingExample]

    @field_validator("samples")
    @classmethod
    def validate_samples(cls, value):
        if not 32 <= len(value) <= 512:
            raise ValueError("Provide between 32 and 512 feature-only samples.")
        return value


async def require_internal_key(x_milan_ai_key: str | None = Header(default=None)):
    expected = os.environ.get("PERFORMANCE_AI_SHARED_SECRET", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Internal AI key is not configured.")
    if not x_milan_ai_key or not hmac.compare_digest(x_milan_ai_key, expected):
        raise HTTPException(status_code=403, detail="Forbidden.")
    return True


@app.get("/health")
async def health():
    return {
        "ok": True,
        "service": "milan-performance-ai",
        "model_trained": model.trained,
        "neural_enabled": os.environ.get("PERFORMANCE_AI_ENABLE_NEURAL", "").lower() == "true",
    }


@app.post("/v1/prefetch/score", dependencies=[Depends(require_internal_key)])
async def score_candidates(request: ScoreRequest):
    features = [
        candidate.model_dump(exclude={"record_id"})
        for candidate in request.candidates
    ]
    predictions = model.recommend_batch(features)
    return {
        "results": [
            {"record_id": candidate.record_id, **prediction}
            for candidate, prediction in zip(request.candidates, predictions)
        ]
    }


@app.post("/v1/train", dependencies=[Depends(require_internal_key)])
async def train_model(request: TrainingRequest):
    examples = [
        {"feature": row.feature.model_dump(), "label": row.label}
        for row in request.samples
    ]
    return model.train_batch(examples)
