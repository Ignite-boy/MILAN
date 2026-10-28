# Milan Web4 AI

Experimental, internal Python service for sequential feed prediction.

- `app.py`: FastAPI health, internal view recording, and prediction APIs.
- `model.py`: GRU architecture for next-item prediction.
- `train.py`: offline training from genuine viewing sequences.
- `smoke_test.py`: isolated service-logic tests.

The service requires `MILAN_WEB4_AI_SECRET` for internal routes. Never expose this secret in frontend code. By default, viewing sequences are stored outside the repository under `~/.local/share/milan-web4-ai`.

The Node.js backend communicates with the Python service using `MILAN_WEB4_AI_URL`. A remote/serverless deployment must configure a reachable private AI service URL; loopback on a remote host does not reach a service on a developer's laptop.

Install CPU PyTorch separately, then install `requirements.txt`. Train only after sufficient genuine viewing history has been collected. The GRU is not trained by default, and no production performance improvement is claimed until measured.
