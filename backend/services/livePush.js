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

let heartbeatTimer = null;
let webSocketServer = null;
let upgradeServer = null;
let upgradeHandler = null;
let shuttingDown = false;
let shutdownPromise = null;
const pendingUpgradeSockets = new Set();

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
heartbeatTimer = setInterval(() => {
  for (const set of sseClients.values()) {
    for (const res of set) { try { res.write(': ping\n\n'); } catch (_) {} }
  }
  for (const set of wsClients.values()) {
    for (const ws of set) { try { if (ws.readyState === 1) ws.ping(); } catch (_) {} }
  }
}, 25000).unref();

/* ── WebSocket transport (optional — only if `ws` is installed) ─────────── */
function attachWs(server) {
  if (shuttingDown) return false;
  let WebSocketServer;
  try { ({ WebSocketServer } = require('ws')); }
  catch (_) { return false; } // ws not installed: SSE remains the only transport
  const jwt = require('jsonwebtoken');
  const { getAuthoritativeUserById } = require('./authoritativeUser');
  const { tokenVersionMatches } = require('./sessionTokens');
  const wss = new WebSocketServer({ noServer: true });
  webSocketServer = wss;
  upgradeServer = server;

  upgradeHandler = (req, socket, head) => {
    if (!String(req.url || '').startsWith('/ws')) return;
    if (shuttingDown) { socket.destroy(); return; }
    pendingUpgradeSockets.add(socket);
    socket.once('close', () => pendingUpgradeSockets.delete(socket));

    const reject = () => {
      if (socket.destroyed) return;
      try { socket.write('HTTP/1.1 401 Unauthorized\\r\\nConnection: close\\r\\n\\r\\n'); } catch (_) {}
      socket.destroy();
    };

    void (async () => {
      let decoded;
      try {
        const token = new URL(req.url, 'http://x').searchParams.get('token') || '';
        decoded = jwt.verify(token, require('../utils/jwtSecret'));
        if (!decoded.userId) return reject();

        const account = await getAuthoritativeUserById(decoded.userId);
        if (!account || !tokenVersionMatches(decoded.tv, account.auth_token_version)) {
          return reject();
        }
      } catch (_) {
        return reject();
      }

      if (socket.destroyed || shuttingDown) {
        if (!socket.destroyed) socket.destroy();
        return;
      }
      pendingUpgradeSockets.delete(socket);
      wss.handleUpgrade(req, socket, head, (ws) => {
        addTo(wsClients, decoded.userId, ws);
        ws.on('close', () => removeFrom(wsClients, decoded.userId, ws));
        ws.on('error', () => removeFrom(wsClients, decoded.userId, ws));
        try { ws.send(JSON.stringify({ type: 'hello' })); } catch (_) {}
      });
    })();
  };
  server.on('upgrade', upgradeHandler);
  return true;
}

function shutdown() {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    shuttingDown = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    // End SSE connections cleanly; EventSource clients can reconnect.
    for (const set of [...sseClients.values()]) {
      for (const res of [...set]) {
        try { res.end(); } catch (_) {}
      }
    }

    if (upgradeServer && upgradeHandler) {
      upgradeServer.off('upgrade', upgradeHandler);
    }
    upgradeServer = null;
    upgradeHandler = null;

    for (const socket of pendingUpgradeSockets) {
      try { socket.destroy(); } catch (_) {}
    }
    pendingUpgradeSockets.clear();

    const wss = webSocketServer;
    webSocketServer = null;
    if (!wss) return;

    const clients = [...wss.clients];
    const allClosed = Promise.all(clients.map(ws => new Promise(resolve => {
      if (ws.readyState === 3) return resolve();
      const done = () => resolve();
      ws.once('close', done);
      ws.once('error', done);
      try {
        if (ws.readyState === 0) ws.terminate();
        else ws.close(1001, 'Server shutting down');
      } catch (_) {
        try { ws.terminate(); } catch (_) {}
        resolve();
      }
    })));

    await Promise.race([
      allClosed,
      new Promise(resolve => setTimeout(resolve, 1200))
    ]);

    for (const ws of clients) {
      if (ws.readyState !== 3) {
        try { ws.terminate(); } catch (_) {}
      }
    }

    await new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 500);
      try { wss.close(finish); } catch (_) { finish(); }
    });
  })();

  return shutdownPromise;
}

function stats() {
  return { sseUsers: sseClients.size, wsUsers: wsClients.size };
}

module.exports = { push, sseHandler, attachWs, shutdown, stats };
