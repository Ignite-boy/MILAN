import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import main
from app.model import AdaptivePrefetchModel


class PerformanceApiTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "PERFORMANCE_AI_SHARED_SECRET": "unit-test-secret",
            "PERFORMANCE_AI_ENABLE_NEURAL": "false",
        })
        self.env.start()
        self.original_model = main.model
        main.model = AdaptivePrefetchModel()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        main.model = self.original_model
        self.env.stop()

    def test_health_is_public_and_reports_model_state(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertFalse(response.json()["model_trained"])

    def test_scoring_rejects_missing_or_invalid_key(self):
        payload = {"candidates": [{
            "record_id": "test-record",
            "media_kind": "image",
            "distance_viewports": 1,
            "size_bytes": 250000,
            "effective_type": "4g",
        }]}
        self.assertEqual(
            self.client.post("/v1/prefetch/score", json=payload).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                "/v1/prefetch/score",
                json=payload,
                headers={"X-Milan-AI-Key": "wrong-key"},
            ).status_code,
            403,
        )

    def test_authorized_scoring_uses_safe_rules_by_default(self):
        response = self.client.post(
            "/v1/prefetch/score",
            headers={"X-Milan-AI-Key": "unit-test-secret"},
            json={"candidates": [
                {
                    "record_id": "image-1",
                    "media_kind": "image",
                    "distance_viewports": 1,
                    "size_bytes": 250000,
                    "effective_type": "4g",
                },
                {
                    "record_id": "video-1",
                    "media_kind": "video",
                    "distance_viewports": 1,
                    "size_bytes": 100000,
                    "effective_type": "4g",
                },
            ]},
        )
        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        self.assertTrue(results[0]["prefetch"])
        self.assertEqual(results[0]["mode"], "rules")
        self.assertFalse(results[1]["prefetch"])
        self.assertFalse(main.model.trained)

    def test_training_requires_key_and_accepts_feature_only_samples(self):
        samples = []
        for index in range(32):
            image = index % 2 == 0
            samples.append({
                "feature": {
                    "media_kind": "image" if image else "video",
                    "distance_viewports": 1,
                    "size_bytes": 200000 if image else 20000000,
                    "effective_type": "4g",
                    "save_data": False,
                    "last_load_ms": 300,
                },
                "label": int(image),
            })

        payload = {"samples": samples}
        self.assertEqual(
            self.client.post("/v1/train", json=payload).status_code,
            403,
        )

        response = self.client.post(
            "/v1/train",
            headers={"X-Milan-AI-Key": "unit-test-secret"},
            json=payload,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["trained"])
        self.assertEqual(response.json()["samples_seen"], 32)
        self.assertFalse(response.json()["neural_enabled"])


if __name__ == "__main__":
    unittest.main()
