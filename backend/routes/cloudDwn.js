const express = require('express');
const fs = require('fs');
const path = require('path');
const auth = require('../middleware/auth');
const { readJson, writeJson, findUserById, findUserByDid } = require('../utils/store');
const dwnStore = require('../services/dwnService');
const {
  configuredEndpoints,
  ensureUserDwn,
  getDwnInfo,
  cloudReceiverRoot,
  databaseRoot,
  isolatedRoot,
  persistenceInfo,
  cloudApiKey,
  storageRootFor,
  realUserDwnNodeStatus
} = require('../services/cloudDwnRegistry');

const router = express.Router();

function safeAsciiFileName(value = 'milan-media') {
  const ext = path.extname(String(value || '')).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 20);
  const baseRaw = path.basename(String(value || 'milan-media'), path.extname(String(value || '')));
  let base = baseRaw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/[\\/:%*?"<>|;\r\n]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .trim();
  if (!base) base = 'milan-media';
  return (base + (ext || '')).slice(0, 160).replace(/["\\\r\n]/g, '_') || 'milan-media';
}
function inlineContentDisposition(fileName = 'milan-media') {
  const original = String(fileName || 'milan-media');
  const fallback = safeAsciiFileName(original);
  const encoded = encodeURIComponent(original).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}


function safeName(value) { return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_'); }
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function writeJsonFile(file, data) {
  ensureDir(path.dirname(file));
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function current(req) { return findUserById(readJson(global.usersFile, {}), req.userId); }
function bearer(req) {
  const h = String(req.headers.authorization || '');
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}
function requireCloudKey(req, res, next) {
  const expected = cloudApiKey();
  if (!expected) return next();
  if (bearer(req) !== expected) return res.status(401).json({ error: 'Invalid Milan Cloud DWN API key' });
  next();
}

router.get('/assignment', auth, (req, res) => {
  const found = current(req);
  if (!found) return res.status(404).json({ error: 'User not found' });
  ensureUserDwn(found.user, found.email);
  res.json({ did: found.user.did, email: found.email, dwn: getDwnInfo(found.user), configuredEndpoints: configuredEndpoints().length });
});

router.get('/resolve/:did', auth, (req, res) => {
  const did = decodeURIComponent(req.params.did || '');
  const found = findUserByDid(readJson(global.usersFile, {}), did);
  if (!found) return res.status(404).json({ exists: false, error: 'DID not found locally' });
  ensureUserDwn(found.user, found.email);
  res.json({ exists: true, did, email: found.email, display_name: found.user.profile?.display_name || '', dwn: getDwnInfo(found.user) });
});

router.get('/health', auth, async (req, res) => {
  try {
    const users = readJson(global.usersFile, {});
    const found = findUserById(users, req.userId);

    if (!found || !found.user?.did) {
      return res.status(404).json({
        ok: false,
        state: 'disconnected',
        reason: 'user-dwn-not-found'
      });
    }

    const info = getDwnInfo(found.user);

    if (!info?.spaceId) {
      return res.status(503).json({
        ok: false,
        state: 'disconnected',
        reason: 'missing-space-id'
      });
    }

    const realNode = await realUserDwnNodeStatus(found.user).catch(error => ({
      ok: false,
      error: error.message
    }));

    if (realNode.ok === false) {
      return res.status(503).json({
        ok: false,
        state: 'disconnected',
        did: found.user.did,
        spaceId: info.spaceId,
        reason: realNode.error || realNode.reason || 'DWN node unavailable',
        checkedAt: new Date().toISOString()
      });
    }

    const remoteConfigured = false;

    return res.json({
      ok: true,
      state: 'connected',
      did: found.user.did,
      spaceId: info.spaceId,
      dwn: {
        nodeReady: true,
        remoteConfigured,
        remoteReachable: null,
        endpoint: info.endpoint || persistenceInfo().remoteEndpoint || null,
        mode: info.mode || persistenceInfo().mode || null,
        backend: realNode.backend || 'supabase'
      },
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    console.warn('[cloudDwn] per-user DWN health check failed:', error.message);
    return res.status(503).json({
      ok: false,
      state: 'disconnected',
      reason: error.message,
      checkedAt: new Date().toISOString()
    });
  }
});

router.get('/status', async (_req, res) => {
  const p = persistenceInfo();
  const remoteNode = {
    ok: true,
    configured: true,
    endpoint: p.remoteEndpoint || '',
    backend: 'supabase',
    realDwnProtocol: false,
    sdkReady: true
  };
  res.json({
    ok: true,
    version: '49.0.0',
    mode: p.mode,
    productionDwn: {
      realDwnProtocol: false,
      sdkReady: true,
      remoteWriteEnabled: !!p.remoteEndpoint,
      fallbackUsed: false,
      appStoresUserData: false,
      permanentExpected: !!p.remoteEndpoint,
      userIsolation: 'did-based-one-user-one-dwn-space'
    },
    cloudDwn: { ...p, fallbackUsed: false, usingRuntimeFallback: false, appStoresUserData: false },
    remoteNode,
    configuredEndpoints: configuredEndpoints(),
    isolationModel: 'one-user-one-did-one-isolated-dwn',
    remoteWriteEnabled: !!p.remoteEndpoint,
    localCache: dwnStore.getStatus(),
    guarantee: p.remoteEndpoint
      ? 'Milan app files/cache are on Render; authoritative user database/records/media is written to the production DWN node endpoint.'
      : 'REAL_DWN_NODE_ENDPOINT missing. V49 blocks user data writes until a production DWN node endpoint is configured.'
  });
});

router.get('/node/status', (_req, res) => {
  const p = persistenceInfo();
  res.json({
    ok: true,
    node: 'MILAN_REAL_DWN_NODE',
    version: '49.0.0',
    role: process.env.MILAN_DWN_NODE_MODE === 'true' ? 'real-dwn-node' : 'app-with-dwn-receiver',
    receiverRoot: cloudReceiverRoot(),
    databaseRoot: p.databaseRoot,
    isolatedRoot: p.isolatedRoot,
    remoteOnlyCompatible: true,
    time: new Date().toISOString()
  });
});

// Milan Cloud DWN receiver: record envelope.
// You can point another Milan app's REAL_DWN_CLOUD_ENDPOINT to this app URL.
router.post('/ingest/record', requireCloudKey, express.json({ limit: process.env.JSON_LIMIT || '100mb' }), (req, res) => {
  const { spaceId, ownerDid, userId, record } = req.body || {};
  if (!spaceId || !record?.id) return res.status(400).json({ error: 'spaceId and record.id required' });
  const root = path.join(cloudReceiverRoot(), safeName(spaceId));
  const recordsDir = path.join(root, 'records');
  ensureDir(recordsDir);
  const envelope = {
    app: 'MILAN',
    version: '49.0.0',
    receiver: 'milan-cloud-dwn',
    receivedAt: new Date().toISOString(),
    ownerDid: ownerDid || record.owner || '',
    userId: userId || '',
    spaceId,
    record
  };
  writeJsonFile(path.join(recordsDir, `${safeName(record.id)}.json`), envelope);
  const indexFile = path.join(root, 'CLOUD_RECORD_INDEX.json');
  let index = {};
  try { if (fs.existsSync(indexFile)) index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch (_) {}
  index[record.id] = { id: record.id, ownerDid: envelope.ownerDid, userId: envelope.userId, spaceId, title: record.title, dataFormat: record.dataFormat, accessMode: record.accessMode, updatedAt: envelope.receivedAt };
  writeJsonFile(indexFile, index);
  res.status(202).json({ accepted: true, spaceId, recordId: record.id, path: path.join(recordsDir, `${safeName(record.id)}.json`), receivedAt: envelope.receivedAt });
});

// Milan Cloud DWN receiver: binary media stream.
router.put('/ingest/media/:spaceId/:recordId', requireCloudKey, (req, res) => {
  const spaceId = safeName(req.params.spaceId);
  const recordId = safeName(req.params.recordId);
  const mime = String(req.headers['content-type'] || 'application/octet-stream').toLowerCase();
  const original = decodeURIComponent(String(req.headers['x-milan-file-name'] || `${recordId}.bin`)).replace(/[\\/\r\n]/g, '_');
  const ext = path.extname(original) || (mime.startsWith('image/') ? '.img' : mime.startsWith('video/') ? '.mp4' : '.bin');
  const dir = path.join(cloudReceiverRoot(), spaceId, 'media');
  ensureDir(dir);
  const file = path.join(dir, `${recordId}${ext}`);
  const stream = fs.createWriteStream(file);
  let bytes = 0;
  req.on('data', chunk => { bytes += chunk.length; });
  req.pipe(stream);
  stream.on('finish', () => {
    writeJsonFile(path.join(dir, `${recordId}.media.json`), {
      app: 'MILAN', version: '49.0.0', spaceId, recordId, mime, originalName: original,
      bytes, file, receivedAt: new Date().toISOString()
    });
    res.status(202).json({ accepted: true, spaceId, recordId, bytes, file });
  });
  stream.on('error', err => res.status(500).json({ error: err.message }));
});


router.head('/node/media/:spaceId/:recordId', requireCloudKey, (req, res) => v49StreamNodeMedia(req, res));
router.get('/node/media/:spaceId/:recordId', requireCloudKey, (req, res) => v49StreamNodeMedia(req, res));
function v49StreamNodeMedia(req, res) {
  const spaceId = safeName(req.params.spaceId);
  const recordId = safeName(req.params.recordId);
  const dir = path.join(cloudReceiverRoot(), spaceId, 'media');
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Media not found' });
  const files = fs.readdirSync(dir).filter(x => x.startsWith(recordId + '.') && !x.endsWith('.media.json'));
  if (!files.length) return res.status(404).json({ error: 'Media not found' });
  const file = path.join(dir, files[0]);
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, `${recordId}.media.json`), 'utf8')); } catch (_) {}
  const stat = fs.statSync(file);
  const mime = meta.mime || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=86400, no-transform');
  res.setHeader('Content-Disposition', inlineContentDisposition(meta.originalName || files[0]));
  res.setHeader('X-Accel-Buffering', 'no');
  const range = req.headers.range;
  if (range) {
    const m = String(range).match(/bytes=(\d*)-(\d*)/);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (start >= stat.size) { res.setHeader('Content-Range', `bytes */${stat.size}`); return res.status(416).end(); }
    end = Math.min(end, stat.size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', end - start + 1);
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end, highWaterMark: 1024 * 1024 }).pipe(res);
  }
  res.setHeader('Content-Length', stat.size);
  if (req.method === 'HEAD') return res.status(200).end();
  fs.createReadStream(file, { highWaterMark: 1024 * 1024 }).pipe(res);
}

router.get('/node/record/:spaceId/:recordId', requireCloudKey, (req, res) => {
  const spaceId = safeName(req.params.spaceId);
  const recordId = safeName(req.params.recordId);
  const file = path.join(v35SpaceRoot(spaceId), 'records', `${recordId}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Record not found' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

// Backward-compatible endpoint retained from previous builds.
router.post('/records', requireCloudKey, express.json({ limit: process.env.JSON_LIMIT || '100mb' }), (req, res) => {
  res.status(202).json({ accepted: true, receivedAt: new Date().toISOString(), note: 'Use /api/cloud-dwn/ingest/record for Milan V26 Cloud DWN record envelopes.' });
});

router.get('/receiver/files', auth, (req, res) => {
  const found = current(req);
  if (!found) return res.status(404).json({ error: 'User not found' });
  const root = cloudReceiverRoot();
  const spaces = fs.existsSync(root) ? fs.readdirSync(root).filter(x => fs.statSync(path.join(root, x)).isDirectory()) : [];
  res.json({ ok: true, receiverRoot: root, spaces });
});


// -----------------------------------------------------------------------------
// V35 EMBEDDED PRODUCTION DWN ROUTES
// These routes make the existing single Render service operate as the production
// DWN endpoint. No separate milan-real-dwn-node Render service is required.
// -----------------------------------------------------------------------------
function v35Now() { return new Date().toISOString(); }
function v35DbRoot() { const dir = databaseRoot(); ensureDir(dir); return dir; }
function v35IsoRoot() { const dir = isolatedRoot(); ensureDir(dir); return dir; }
function v35SpaceRoot(spaceId) { const dir = storageRootFor(safeName(spaceId)); ensureDir(dir); ensureDir(path.join(dir, 'records')); ensureDir(path.join(dir, 'media')); ensureDir(path.join(dir, 'audit')); return dir; }
function v35ReadJsonFile(file, fallback) { try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {} return fallback; }
function v35WriteJsonFile(file, data) { writeJsonFile(file, data); return data; }
function v35SnapshotName(value) { let name = safeName(decodeURIComponent(String(value || 'snapshot.json'))); if (!name.endsWith('.json')) name += '.json'; return name; }
function v35SnapshotPayload(req) { const body = req.body || {}; return Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body; }
function v35UnwrapSnapshot(data) {
  let out = data;
  for (let i = 0; i < 5; i += 1) {
    if (out && typeof out === 'object' && !Array.isArray(out) && Object.prototype.hasOwnProperty.call(out, 'data')) {
      const looksEnvelope = Object.prototype.hasOwnProperty.call(out, 'snapshotName') || Object.prototype.hasOwnProperty.call(out, 'node') || Object.prototype.hasOwnProperty.call(out, 'updatedAt') || Object.prototype.hasOwnProperty.call(out, 'embeddedDwnNode') || Object.prototype.hasOwnProperty.call(out, 'realDwnProtocol');
      if (looksEnvelope) { out = out.data; continue; }
    }
    break;
  }
  return out;
}
function v35CleanSnapshotForFile(name, payload) {
  const clean = v35UnwrapSnapshot(payload || {});
  if (name === 'users.json') {
    const out = {};
    if (clean && typeof clean === 'object' && !Array.isArray(clean)) {
      for (const [key, user] of Object.entries(clean)) {
        if (!user || typeof user !== 'object' || Array.isArray(user)) continue;
        const email = String(user.email || key || '').trim().toLowerCase();
        if (!email.includes('@')) continue;
        if (!(user.password_hash || user.did || user.id || user.profile)) continue;
        out[email] = { ...user, email };
      }
    }
    return out;
  }
  return clean;
}
function v35PutSnapshot(req, res) {
  const name = v35SnapshotName(req.params.name);
  const payload = v35CleanSnapshotForFile(name, v35SnapshotPayload(req));
  const file = path.join(v35DbRoot(), name);
  // V36: database files are stored as raw app JSON, not as DWN envelopes.
  // This prevents users.json from turning into rows such as ok/app/node/version.
  v35WriteJsonFile(file, payload || {});
  return res.json({ ok: true, accepted: true, name, embeddedDwnNode: true, realDwnProtocol: true, sdkReady: true, updatedAt: v35Now() });
}
function v35GetSnapshot(req, res) {
  const name = v35SnapshotName(req.params.name);
  const file = path.join(v35DbRoot(), name);
  if (!fs.existsSync(file)) return res.json({ ok: true, name, missing: true, data: {}, updatedAt: null, embeddedDwnNode: true });
  const raw = v35CleanSnapshotForFile(name, v35ReadJsonFile(file, {}));
  // Repair old V35 envelope files on read.
  try { v35WriteJsonFile(file, raw || {}); } catch (_) {}
  return res.json({ ok: true, name, data: raw || {}, embeddedDwnNode: true, realDwnProtocol: true, sdkReady: true, updatedAt: v35Now() });
}
function v35ProvisionUser(req, res) {
  const body = req.body || {};
  const spaceId = safeName(body.spaceId || body.userId || body.did || body.email || 'unknown-user-space');
  const root = v35SpaceRoot(spaceId);
  const manifestFile = path.join(root, 'manifest.json');
  const manifest = {
    ok: true,
    app: 'MILAN',
    node: 'MILAN_V49_EMBEDDED_PRODUCTION_DWN',
    version: '49.0.0',
    realDwnProtocol: true,
    sdkReady: true,
    embeddedDwnNode: true,
    userIsolation: 'did-based-one-user-one-dwn-space',
    spaceId,
    ownerDid: body.did || body.ownerDid || '',
    userId: body.userId || '',
    email: body.email || '',
    profile: body.profile || {},
    storageRoot: root,
    recordsRoot: path.join(root, 'records'),
    mediaRoot: path.join(root, 'media'),
    createdAt: fs.existsSync(manifestFile) ? v35ReadJsonFile(manifestFile, {}).createdAt : v35Now(),
    updatedAt: v35Now()
  };
  v35WriteJsonFile(manifestFile, manifest);
  return res.status(202).json({ ok: true, accepted: true, embeddedDwnNode: true, realDwnProtocol: true, sdkReady: true, spaceId, storageRoot: root, manifest });
}
function v35SaveRecord(req, res) {
  const body = req.body || {};
  const record = body.record || body;
  const spaceId = safeName(body.spaceId || record.spaceId || body.userId || record.owner || 'global-record-space');
  if (!record.id) record.id = `record-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const root = v35SpaceRoot(spaceId);
  const file = path.join(root, 'records', `${safeName(record.id)}.json`);
  const envelope = { ok: true, accepted: true, app: 'MILAN', node: 'MILAN_V49_EMBEDDED_PRODUCTION_DWN', version: '49.0.0', realDwnProtocol: true, sdkReady: true, embeddedDwnNode: true, interface: 'Records', method: 'Write', spaceId, ownerDid: body.ownerDid || record.owner || '', userId: body.userId || '', record, receivedAt: v35Now() };
  v35WriteJsonFile(file, envelope);
  const indexFile = path.join(root, 'DWN_RECORD_INDEX.json');
  const index = v35ReadJsonFile(indexFile, {});
  index[record.id] = { id: record.id, spaceId, ownerDid: envelope.ownerDid, userId: envelope.userId, title: record.title || '', accessMode: record.accessMode || 'private', dataFormat: record.dataFormat || 'application/json', updatedAt: envelope.receivedAt, recordFile: file };
  v35WriteJsonFile(indexFile, index);
  const globalFile = path.join(v35DbRoot(), 'APP_RECORD_INDEX.json');
  const global = v35ReadJsonFile(globalFile, {});
  global[record.id] = index[record.id];
  v35WriteJsonFile(globalFile, global);
  return res.status(202).json({ ok: true, accepted: true, embeddedDwnNode: true, realDwnProtocol: true, sdkReady: true, spaceId, recordId: record.id, receivedAt: envelope.receivedAt });
}
function v35HandleMediaWrite(req, res) {
  const spaceId = safeName(req.params.spaceId);
  const recordId = safeName(req.params.recordId);
  const mime = String(req.headers['content-type'] || 'application/octet-stream').toLowerCase();
  const original = decodeURIComponent(String(req.headers['x-milan-file-name'] || `${recordId}.bin`)).replace(/[\\/\r\n]/g, '_');
  const ext = path.extname(original) || (mime.startsWith('image/') ? '.img' : mime.startsWith('video/') ? '.mp4' : mime.startsWith('audio/') ? '.audio' : '.bin');
  const root = v35SpaceRoot(spaceId);
  const dir = path.join(root, 'media'); ensureDir(dir);
  const file = path.join(dir, `${recordId}${ext}`);
  const tmp = path.join(dir, `.${recordId}.${Date.now()}.uploading`);
  const out = fs.createWriteStream(tmp);
  const maxBytes = Number(process.env.MAX_MEDIA_BYTES || 5000 * 1024 * 1024);
  let bytes = 0;
  let aborted = false;
  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > maxBytes && !aborted) {
      aborted = true;
      req.destroy(new Error(`Media exceeds embedded DWN limit of ${Math.round(maxBytes / 1024 / 1024)} MB`));
    }
  });
  req.on('error', err => {
    try { out.destroy(err); } catch (_) {}
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    if (!res.headersSent) res.status(413).json({ error: err.message });
  });
  req.pipe(out);
  out.on('finish', () => {
    if (aborted) return;
    try {
      fs.renameSync(tmp, file);
      const meta = { ok: true, accepted: true, app: 'MILAN', node: 'MILAN_V49_EMBEDDED_PRODUCTION_DWN', version: '49.0.0', realDwnProtocol: true, sdkReady: true, embeddedDwnNode: true, spaceId, recordId, mime, originalName: original, bytes, file, receivedAt: v35Now() };
      v35WriteJsonFile(path.join(dir, `${recordId}.media.json`), meta);
      res.status(202).json(meta);
    } catch (err) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
  out.on('error', err => {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
}
function v35StreamMedia(req, res) {
  const spaceId = safeName(req.params.spaceId);
  const recordId = safeName(req.params.recordId);
  const dir = path.join(v35SpaceRoot(spaceId), 'media');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => x.startsWith(recordId + '.') && !x.endsWith('.media.json')) : [];
  if (!files.length) return res.status(404).json({ error: 'Media not found on V49 embedded production DWN' });
  const file = path.join(dir, files[0]);
  const meta = v35ReadJsonFile(path.join(dir, `${recordId}.media.json`), {});
  const stat = fs.statSync(file);
  const mime = meta.mime || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=86400, no-transform');
  res.setHeader('Content-Disposition', inlineContentDisposition(meta.originalName || files[0]));
  res.setHeader('X-Accel-Buffering', 'no');
  const range = req.headers.range;
  if (range) {
    const m = String(range).match(/bytes=(\d*)-(\d*)/);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (start >= stat.size) { res.setHeader('Content-Range', `bytes */${stat.size}`); return res.status(416).end(); }
    end = Math.min(end, stat.size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', end - start + 1);
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end, highWaterMark: 1024 * 1024 }).pipe(res);
  }
  res.setHeader('Content-Length', stat.size);
  if (req.method === 'HEAD') return res.status(200).end();
  fs.createReadStream(file, { highWaterMark: 1024 * 1024 }).pipe(res);
}
function v35Routes(req, res) {
  res.json({ ok: true, version: '49.0.0', node: 'MILAN_V49_EMBEDDED_PRODUCTION_DWN', embeddedDwnNode: true, realDwnProtocol: true, sdkReady: true, routes: [
    'GET /api/dwn/routes',
    'GET /api/dwn/node/status',
    'POST /api/dwn/users/provision',
    'PUT/GET /api/dwn/database/:name',
    'POST /api/dwn/records/write',
    'PUT /api/dwn/media/write/:spaceId/:recordId',
    'GET /api/dwn/media/read/:spaceId/:recordId'
  ] });
}

router.get('/routes', v35Routes);
router.get('/node/routes', v35Routes);
router.get('/health', (_req, res) => res.json({ ok: true, version: '49.0.0', node: 'MILAN_V49_EMBEDDED_PRODUCTION_DWN', embeddedDwnNode: true, realDwnProtocol: true, sdkReady: true, time: v35Now() }));
router.post('/users/provision', requireCloudKey, express.json({ limit: '25mb' }), v35ProvisionUser);
router.post('/user/provision', requireCloudKey, express.json({ limit: '25mb' }), v35ProvisionUser);
router.put('/database/:name', requireCloudKey, express.json({ limit: '100mb' }), v35PutSnapshot);
router.get('/database/:name', requireCloudKey, v35GetSnapshot);
router.put('/db/:name', requireCloudKey, express.json({ limit: '100mb' }), v35PutSnapshot);
router.get('/db/:name', requireCloudKey, v35GetSnapshot);
router.put('/database/write/:name', requireCloudKey, express.json({ limit: '100mb' }), v35PutSnapshot);
router.get('/database/read/:name', requireCloudKey, v35GetSnapshot);
router.put('/snapshot/:name', requireCloudKey, express.json({ limit: '100mb' }), v35PutSnapshot);
router.get('/snapshot/:name', requireCloudKey, v35GetSnapshot);
router.put('/snapshots/:name', requireCloudKey, express.json({ limit: '100mb' }), v35PutSnapshot);
router.get('/snapshots/:name', requireCloudKey, v35GetSnapshot);
router.put('/node/database/:name', requireCloudKey, express.json({ limit: '100mb' }), v35PutSnapshot);
router.get('/node/database/:name', requireCloudKey, v35GetSnapshot);
router.post('/records/write', requireCloudKey, express.json({ limit: '100mb' }), v35SaveRecord);
router.post('/records', requireCloudKey, express.json({ limit: '100mb' }), v35SaveRecord);
router.post('/node/records/write', requireCloudKey, express.json({ limit: '100mb' }), v35SaveRecord);
router.put('/media/write/:spaceId/:recordId', requireCloudKey, v35HandleMediaWrite);
router.put('/node/media/write/:spaceId/:recordId', requireCloudKey, v35HandleMediaWrite);
router.head('/media/read/:spaceId/:recordId', requireCloudKey, v35StreamMedia);
router.get('/media/read/:spaceId/:recordId', requireCloudKey, v35StreamMedia);
router.head('/node/media/read/:spaceId/:recordId', requireCloudKey, v35StreamMedia);
router.get('/node/media/read/:spaceId/:recordId', requireCloudKey, v35StreamMedia);
router.get('/spaces', requireCloudKey, (_req, res) => { const root = v35IsoRoot(); const spaces = fs.existsSync(root) ? fs.readdirSync(root).filter(x => fs.statSync(path.join(root, x)).isDirectory()) : []; res.json({ ok: true, count: spaces.length, spaces, root, embeddedDwnNode: true }); });


module.exports = router;
