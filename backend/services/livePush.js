'use strict';

/**
 * Live push hub — one in-process pub/sub feeding two transports:
 *   - SSE       GET /api/events   (EventSource; primary — auto-reconnects,
 *                                  works through proxies, zero dependencies)
 *   - WebSocket GET /ws           (`ws` library; secondary transport for
 *                                  clients that prefer a socket, e.g. the APK)
 *
 * Purpose: the app used to discover new notifications only by polling.
 * Pushing events lets the frontend skip periodic heavy work — a notification
 * arrives, the client refreshes exactly once, immediately.
 *
 * Single-process safe by design: MILAN uses one application process (cluster is
 * forbidden — JSON stores + LevelDB lock to one process, see
 * not used), so an in-memory client map needs no Redis.
 */

const sseClients = new Map(); // userId -> Set<res>
const wsClients = new Map();  // userId -> Set<ws>

function addTo(map, userId, conn) {
  if (!map.has(userId)) map.set(userId, new Set());
  map.get(userId).add(conn);
}
function removeFrom(map, userId, conn) {
  const set = map.get(userId);
  if (!set) return;
  set.delete(conn);
  if (!set.size) map.delete(userId);
}

/** Push an event to every live connection of one user. Fire-and-forget. */
function push(userId, type, data) {
  const payload = JSON.stringify({ type, ...data, at: Date.now() });
  const frame = 'data: ' + payload + '\n\n';
  for (const res of sseClients.get(userId) || []) {
    try { res.write(frame); } catch (_) {}
  }
  for (const ws of wsClients.get(userId) || []) {
    try { if (ws.readyState === 1) ws.send(payload); } catch (_) {}
  }
}

/* ── SSE endpoint (mount behind the normal auth middleware) ─────────────── */
function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 5000\n\n');
  res.write('data: {"type":"hello"}\n\n');
  addTo(sseClients, req.userId, res);
  req.on('close', () => removeFrom(sseClients, req.userId, res));
}

/* Heartbeat: keeps idle connections alive through proxies/timeouts. */
setInterval(() => {
  for (const set of sseClients.values()) {
    for (const res of set) { try { res.write(': ping\n\n'); } catch (_) {} }
  }
  for (const set of wsClients.values()) {
    for (const ws of set) { try { if (ws.readyState === 1) ws.ping(); } catch (_) {} }
  }
}, 25000).unref();

/* ── WebSocket transport (optional — only if `ws` is installed) ─────────── */
function attachWs(server) {
  let WebSocketServer;
  try { ({ WebSocketServer } = require('ws')); }
  catch (_) { return false; } // ws not installed: SSE remains the only transport
  const jwt = require('jsonwebtoken');
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!String(req.url || '').startsWith('/ws')) return; // not ours
    let userId = null;
    try {
      const token = new URL(req.url, 'http://x').searchParams.get('token') || '';
      userId = jwt.verify(token, require('../utils/jwtSecret')).userId;
    } catch (_) {}
    if (!userId) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      addTo(wsClients, userId, ws);
      ws.on('close', () => removeFrom(wsClients, userId, ws));
      ws.on('error', () => removeFrom(wsClients, userId, ws));
      try { ws.send(JSON.stringify({ type: 'hello' })); } catch (_) {}
    });
  });
  return true;
}

function stats() {
  return { sseUsers: sseClients.size, wsUsers: wsClients.size };
}

module.exports = { push, sseHandler, attachWs, stats };
