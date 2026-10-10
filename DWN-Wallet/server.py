from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "10000"))

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload, content_type="application/json"):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "service": "natively-dwn-wallet"})
        if self.path in ("/", "/index.html"):
            p = ROOT / "frontend" / "index.html"
        elif self.path == "/wallet.html":
            p = ROOT / "frontend" / "wallet.html"
        else:
            return self._send(404, {"error": "not found"})
        if not p.exists():
            return self._send(404, {"error": "frontend not found"})
        self._send(200, p.read_bytes(), "text/html; charset=utf-8")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization")
        self.end_headers()

ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
