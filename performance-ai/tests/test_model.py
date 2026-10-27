import math
import unittest

from app.model import AdaptivePrefetchModel, encode_features


class PrefetchModelTests(unittest.TestCase):
    def setUp(self):
        self.model = AdaptivePrefetchModel()

    def test_feature_vector_is_bounded_and_finite(self):
        values = encode_features({
            "media_kind": "image",
            "distance_viewports": 1.0,
            "size_bytes": 250_000,
            "effective_type": "4g",
            "save_data": False,
            "last_load_ms": 250,
        })
        self.assertEqual(values.numel(), 8)
        self.assertTrue(all(math.isfinite(float(value)) for value in values))

    def test_rules_avoid_bandwidth_heavy_prefetches(self):
        self.assertTrue(self.model.recommend({
            "media_kind": "image", "distance_viewports": 1,
            "size_bytes": 250_000, "effective_type": "4g",
            "save_data": False,
        })["prefetch"])
        for candidate in (
            {"media_kind": "video", "distance_viewports": 1, "size_bytes": 100_000, "effective_type": "4g"},
            {"media_kind": "image", "distance_viewports": 1, "size_bytes": 10_000_000, "effective_type": "4g"},
            {"media_kind": "image", "distance_viewports": 1, "size_bytes": 100_000, "effective_type": "4g", "save_data": True},
            {"media_kind": "image", "distance_viewports": 1, "size_bytes": 100_000, "effective_type": "2g"},
        ):
            self.assertFalse(self.model.recommend(candidate)["prefetch"])

    def test_batch_rules_match_individual_rules(self):
        candidates = [
            {
                "media_kind": "image",
                "distance_viewports": 1,
                "size_bytes": 250_000,
                "effective_type": "4g",
                "save_data": False,
            },
            {
                "media_kind": "video",
                "distance_viewports": 1,
                "size_bytes": 250_000,
                "effective_type": "4g",
                "save_data": False,
            },
        ]
        batch = self.model.recommend_batch(candidates)
        individual = [self.model.recommend(item) for item in candidates]
        self.assertEqual([row["prefetch"] for row in batch],
                         [row["prefetch"] for row in individual])
        self.assertTrue(all(row["mode"] == "rules" for row in batch))

    def test_neural_batch_scores_are_finite_and_respect_safety_gate(self):
        import os
        from unittest.mock import patch

        candidates = [
            {
                "media_kind": "image",
                "distance_viewports": 1,
                "size_bytes": 250_000,
                "effective_type": "4g",
                "save_data": False,
            },
            {
                "media_kind": "video",
                "distance_viewports": 1,
                "size_bytes": 250_000,
                "effective_type": "4g",
                "save_data": False,
            },
        ]
        self.model.trained = True
        with patch.dict(os.environ, {"PERFORMANCE_AI_ENABLE_NEURAL": "true"}):
            results = self.model.recommend_batch(candidates)

        self.assertEqual(len(results), 2)
        self.assertTrue(all(row["mode"] == "neural" for row in results))
        self.assertTrue(all(math.isfinite(row["score"]) for row in results))
        self.assertFalse(results[1]["prefetch"])

    def test_training_uses_feature_only_samples(self):
        examples = []
        for index in range(32):
            positive = index % 2 == 0
            examples.append({
                "feature": {
                    "media_kind": "image" if positive else "video",
                    "distance_viewports": 1,
                    "size_bytes": 200_000 if positive else 20_000_000,
                    "effective_type": "4g",
                    "save_data": False,
                    "last_load_ms": 300,
                },
                "label": int(positive),
            })
        result = self.model.train_batch(examples)
        self.assertTrue(self.model.trained)
        self.assertEqual(result["samples_seen"], 32)
        self.assertTrue(math.isfinite(result["training_loss"]))


if __name__ == "__main__":
    unittest.main()
