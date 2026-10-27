# MILAN Performance AI (pilot)

A separate FastAPI + PyTorch CPU service for conservative, feature-only media-prefetch decisions.

- `/health` is public and contains no user or media data.
- `/v1/prefetch/score` and `/v1/train` require `X-Milan-AI-Key`, configured with `PERFORMANCE_AI_SHARED_SECRET`.
- Training accepts performance feature vectors and binary outcomes only; it does not accept user IDs, record IDs, captions, CIDs, or URLs.
- The pilot only recommends small image prefetches. It does not prefetch full video/audio resources and respects Data Saver and slow-network signals.
- The neural scorer remains disabled unless `PERFORMANCE_AI_ENABLE_NEURAL=true`. Keep it disabled until real telemetry and a held-out benchmark show it beats the rule baseline.
- This service is not yet wired into Express or production. Do not expose it publicly without the internal key and network-level access controls.

Local test command after installing requirements and CPU PyTorch:

`python -m unittest discover -s tests -v`
