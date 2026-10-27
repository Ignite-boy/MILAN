"""Small CPU-only model for conservative feed-prefetch decisions."""
from collections import deque
import math
import os
import threading

import torch
from torch import nn

# Avoid oversubscribing the small WSL/production CPU.
torch.set_num_threads(1)

NETWORK_SCORE = {
    "slow-2g": 0.0,
    "2g": 0.2,
    "3g": 0.65,
    "4g": 1.0,
    "wifi": 1.0,
    "unknown": 0.5,
}
MAX_IMAGE_BYTES = 4 * 1024 * 1024
FEATURE_COUNT = 8


def encode_features(item):
    """Encode only performance metadata; never content, account or record IDs."""
    kind = str(item.get("media_kind", "other")).lower()
    size = max(0, int(item.get("size_bytes", 0) or 0))
    distance = max(0.0, min(float(item.get("distance_viewports", 0) or 0), 10.0))
    network = str(item.get("effective_type", "unknown")).lower()
    load_ms = max(0.0, min(float(item.get("last_load_ms", 0) or 0), 120000.0))

    values = [
        distance / 10.0,
        float(kind == "image"),
        float(kind == "video"),
        float(kind == "audio"),
        min(math.log1p(size) / math.log1p(256 * 1024 * 1024), 1.0),
        NETWORK_SCORE.get(network, NETWORK_SCORE["unknown"]),
        float(bool(item.get("save_data", False))),
        load_ms / 120000.0,
    ]
    return torch.tensor(values, dtype=torch.float32)


class PrefetchNetwork(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(FEATURE_COUNT, 16),
            nn.ReLU(),
            nn.Linear(16, 8),
            nn.ReLU(),
            nn.Linear(8, 1),
        )

    def forward(self, features):
        return self.layers(features).squeeze(-1)


class AdaptivePrefetchModel:
    """Experimental neural scorer with safe rules until trained and enabled."""

    def __init__(self):
        self.network = PrefetchNetwork()
        self.optimizer = torch.optim.Adam(self.network.parameters(), lr=0.003)
        self.loss_fn = nn.BCEWithLogitsLoss()
        self.samples = deque(maxlen=2048)
        self.trained = False
        self.last_loss = None
        self._lock = threading.RLock()

    @staticmethod
    def rules_recommend(item):
        # Never prefetch full video/audio resources through this pilot.
        # Preserve bandwidth on Data Saver, slow connections and large images.
        kind = str(item.get("media_kind", "other")).lower()
        network = str(item.get("effective_type", "unknown")).lower()
        distance = max(0.0, float(item.get("distance_viewports", 0) or 0))
        size = max(0, int(item.get("size_bytes", 0) or 0))

        if bool(item.get("save_data", False)):
            return False
        if kind != "image" or size > MAX_IMAGE_BYTES:
            return False
        if network in ("slow-2g", "2g"):
            return False
        if network == "unknown" and distance > 1.0:
            return False
        return distance <= 1.75

    def recommend(self, item):
        with self._lock:
            enabled = (
                self.trained
                and os.environ.get("PERFORMANCE_AI_ENABLE_NEURAL", "").lower() == "true"
            )
            safe = (
                not bool(item.get("save_data", False))
                and str(item.get("media_kind", "")).lower() == "image"
                and int(item.get("size_bytes", 0) or 0) <= MAX_IMAGE_BYTES
                and str(item.get("effective_type", "unknown")).lower() not in ("slow-2g", "2g")
            )

            score = None
            if enabled:
                self.network.eval()
                with torch.no_grad():
                    score = float(torch.sigmoid(self.network(encode_features(item))).item())
                should_prefetch = safe and score >= 0.65
                mode = "neural"
            else:
                should_prefetch = self.rules_recommend(item)
                mode = "rules"

            return {
                "prefetch": bool(should_prefetch),
                "mode": mode,
                "score": round(score, 4) if score is not None else None,
            }

    def recommend_batch(self, items):
        """Score a candidate batch with one vectorized neural forward pass."""
        if not items:
            return []

        with self._lock:
            enabled = (
                self.trained
                and os.environ.get("PERFORMANCE_AI_ENABLE_NEURAL", "").lower() == "true"
            )

            if not enabled:
                return [
                    {
                        "prefetch": self.rules_recommend(item),
                        "mode": "rules",
                        "score": None,
                    }
                    for item in items
                ]

            features = torch.stack([encode_features(item) for item in items])
            self.network.eval()
            with torch.no_grad():
                scores = torch.sigmoid(self.network(features)).tolist()

            results = []
            for item, score in zip(items, scores):
                safe = (
                    not bool(item.get("save_data", False))
                    and str(item.get("media_kind", "")).lower() == "image"
                    and int(item.get("size_bytes", 0) or 0) <= MAX_IMAGE_BYTES
                    and str(item.get("effective_type", "unknown")).lower()
                    not in ("slow-2g", "2g")
                )
                results.append({
                    "prefetch": bool(safe and score >= 0.65),
                    "mode": "neural",
                    "score": round(float(score), 4),
                })
            return results

    def train_batch(self, examples):
        # The caller supplies feature-only examples, with no user or content IDs.
        with self._lock:
            for example in examples:
                self.samples.append((example["feature"], int(example["label"])))

            x = torch.stack([encode_features(row) for row, _ in self.samples])
            y = torch.tensor([label for _, label in self.samples], dtype=torch.float32)

            self.network.train()
            loss_value = 0.0
            for _ in range(5):
                self.optimizer.zero_grad(set_to_none=True)
                loss = self.loss_fn(self.network(x), y)
                loss.backward()
                self.optimizer.step()
                loss_value = float(loss.detach().item())

            self.trained = True
            self.last_loss = round(loss_value, 6)
            return {
                "trained": True,
                "samples_seen": len(self.samples),
                "training_loss": self.last_loss,
                "neural_enabled": os.environ.get("PERFORMANCE_AI_ENABLE_NEURAL", "").lower() == "true",
            }
