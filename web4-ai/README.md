# Milan Web4 AI

This service records minimal feed-view sequences and exposes internal
GRU next-item inference. It is a separate process from the Node.js app.

- `app.py`: FastAPI health, internal view recording and prediction APIs.
- `model.py`: GRU architecture.
- `train.py`: offline training from recorded sequence data.
- `smoke_test.py`: isolated service-logic tests.

The service requires `MILAN_WEB4_AI_SECRET` to accept internal requests.
Never expose the internal endpoints publicly or embed this secret in browser code.

By default, sequence data is saved under:
`~/.local/share/milan-web4-ai/sequences.json`

For a CPU installation, install PyTorch from its CPU wheel index separately.
Train only after enough real view history has been collected.

Run locally with the project's dedicated virtual environment:
`uvicorn app:app --app-dir web4-ai --host 127.0.0.1 --port 8787`

The Python service is not yet wired into Node.js in this stage.
