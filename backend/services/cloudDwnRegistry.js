const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const realDwn = require('./realDwnNodeClient');
const realDwnEngine = require('./realDwnEngine');

// MILAN V49 PRODUCTION DWN RULE:
// 1 user = 1 DID = 1 isolated production DWN space.
// Render milan-app stores only app files and temporary cache.
// Authoritative user profile/database snapshots/records/media are pushed to REAL_DWN_NODE_ENDPOINT.
// If REAL_DWN_NODE_ENDPOINT is not set, V49 blocks user data writes.

function sanitizeEndpoint(url = '') {
  const value = String(url || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function safeName(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function shortHash(seed) {
  return crypto.createHash('sha256').update(String(seed || '')).digest('hex').slice(0, 16);
}

function isRenderRuntime() {
  return !!(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
}

function publicBase() {
  return sanitizeEndpoint(
    process.env.APP_PUBLIC_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ''
  ) || '';
}

function cloudRemoteBase() {
  return realDwn.endpoint() || sanitizeEndpoint(
    process.env.REAL_DWN_CLOUD_ENDPOINT ||
    process.env.MILAN_CLOUD_DWN_ENDPOINT ||
    process.env.DWN_CLOUD_ENDPOINT ||
    process.env.DWN_CLOUD_ENDPOINTS ||
    ''
  );
}

function cloudApiKey() {
  return realDwn.apiKey() || String(process.env.REAL_DWN_CLOUD_API_KEY || process.env.MILAN_CLOUD_DWN_API_KEY || process.env.DWN_CLOUD_API_KEY || '').trim();
}


function isEmbeddedSelfEndpoint(remote = cloudRemoteBase()) {
  if (String(process.env.REAL_DWN_EMBEDDED || 'true').toLowerCase() === 'false') return false;
  try {
    const u = new URL(String(remote || ''));
    const appPort = String(process.env.PORT || process.env.REAL_DWN_EMBEDDED_PORT || '10000');
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return ['127.0.0.1', 'localhost', '::1'].includes(u.hostname) && port === appPort;
  } catch (_) {
    return false;
  }
}

function directJsonWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function normalizeSnapshotNameLocal(value) {
  let name = safeName(decodeURIComponent(String(value || 'snapshot.json'))).replace(/\.+/g, '.');
  if (!name.endsWith('.json')) name += '.json';
  return name;
}

function directPutDatabaseSnapshot(name, payload) {
  const safe = normalizeSnapshotNameLocal(name);
  const file = path.join(databaseRoot(), safe);
  // Embedded DWN uses the same database files as the app runtime. Store raw app JSON,
  // not an envelope, otherwise APP_RECORD_INDEX/users.json can become wrapped and break feed/login.
  directJsonWrite(file, payload || {});
  return { ok: true, embeddedDwnNode: true, name: safe, storedAt: file, rawAppJson: true, updatedAt: new Date().toISOString() };
}

function directPullDatabaseSnapshot(name) {
  const safe = normalizeSnapshotNameLocal(name);
  const file = path.join(databaseRoot(), safe);
  if (!fs.existsSync(file)) return { ok: true, name: safe, missing: true, data: {}, updatedAt: null, embeddedDwnNode: true };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const looksEnvelope = raw && typeof raw === 'object' && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, 'data') && (raw.snapshotName || raw.node || raw.embeddedDwnNode || raw.realDwnProtocol);
    const data = looksEnvelope ? raw.data : raw;
    return { ok: true, name: safe, data, updatedAt: raw.updatedAt || null, embeddedDwnNode: true };
  } catch (err) {
    return { ok: false, name: safe, error: err.message, data: {}, embeddedDwnNode: true };
  }
}

function remoteOnlyRequired() {
  return realDwn.remoteOnly();
}

function renderCloudDiskRoot() {
  return path.resolve(
    process.env.RENDER_DISK_MOUNT_PATH ||
    process.env.RENDER_PERSISTENT_DWN_ROOT ||
    '/opt/render/project/src/dwn-data/milan-app-cache'
  );
}

function renderProjectWritableRoot() {
  // This path is writable on Render even when no persistent disk is attached.
  // It prevents the app from crashing with EACCES. For permanent storage,
  // attach a Render Disk and keep MILAN_CLOUD_DWN_ROOT/RENDER_DISK_MOUNT_PATH on that mount.
  const base = process.env.RENDER_PROJECT_DIR || process.env.PWD || path.join(__dirname, '..');
  return path.resolve(base, 'milan-cloud-dwn-runtime');
}

function localDevelopmentRoot() {
  return path.resolve(process.env.MILAN_LOCAL_DWN_ROOT || path.join(__dirname, '..', 'dwn'));
}

function unique(values) {
  const out = [];
  for (const value of values) {
    const v = String(value || '').trim();
    if (!v) continue;
    const resolved = path.resolve(v);
    if (!out.includes(resolved)) out.push(resolved);
  }
  return out;
}

function isVercelRuntime() {
  return !!(process.env.VERCEL || process.env.VERCEL_ENV);
}

function candidateRoots() {
  if (isVercelRuntime()) {
    return unique([
      process.env.MILAN_CLOUD_DWN_ROOT,
      process.env.MILAN_DATA_ROOT,
      path.join('/tmp', 'milan-dwn')
    ]);
  }
  if (!isRenderRuntime()) {
    return unique([
      process.env.MILAN_CLOUD_DWN_ROOT,
      process.env.MILAN_DATA_ROOT,
      process.env.RENDER_DISK_MOUNT_PATH,
      process.env.RENDER_PERSISTENT_DWN_ROOT,
      localDevelopmentRoot()
    ]);
  }
  return unique([
    process.env.MILAN_CLOUD_DWN_ROOT,
    process.env.MILAN_DATA_ROOT,
    process.env.RENDER_DISK_MOUNT_PATH,
    process.env.RENDER_PERSISTENT_DWN_ROOT,
    '/opt/render/project/src/dwn-data/milan-app-cache',
    '/var/data/milan-dwn',
    renderProjectWritableRoot(),
    path.join('/tmp', 'milan-dwn')
  ]);
}
function testWritable(root) {
  try {
    fs.mkdirSync(root, { recursive: true });
    const probe = path.join(root, '.milan-write-test');
    fs.writeFileSync(probe, String(Date.now()));
    fs.unlinkSync(probe);
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err.code || 'ERROR', message: err.message };
  }
}

let selectedRootCache = null;
function selectedLocalDwnRoot() {
  if (selectedRootCache) return selectedRootCache;
  const attempts = [];
  for (const candidate of candidateRoots()) {
    const result = testWritable(candidate);
    attempts.push({ root: candidate, ...result });
    if (result.ok) {
      const render = isRenderRuntime();
      const normalized = candidate.replace(/\\/g, '/');
      const configuredRoot = String(process.env.MILAN_CLOUD_DWN_ROOT || process.env.MILAN_DATA_ROOT || '').trim();
      const configuredDisk = String(process.env.RENDER_DISK_MOUNT_PATH || process.env.RENDER_PERSISTENT_DWN_ROOT || '').trim();
      const persistentByConfig = !!configuredRoot || !!configuredDisk;
      const looksLikeRenderDisk = render && (
        normalized.startsWith('/var/data') ||
        normalized.startsWith('/mnt/') ||
        normalized.startsWith('/opt/render/project/.data') ||
    normalized.includes('/opt/render/project/src/dwn-data')
      );
      selectedRootCache = {
        root: candidate,
        attempts,
        fallbackUsed: attempts.length > 1,
        selectedBy: attempts.length === 1 ? 'configured-root' : 'first-writable-root',
        permanentExpected: !render || persistentByConfig || looksLikeRenderDisk,
        warning: render && !(persistentByConfig || looksLikeRenderDisk)
          ? 'Using Render writable runtime fallback. App will run, but attach a Render persistent disk or configure REAL_DWN_CLOUD_ENDPOINT for durable storage.'
          : ''
      };
      return selectedRootCache;
    }
  }
  // Last-resort error with every attempted path, so Render logs are actionable.
  const detail = attempts.map(a => `${a.root} => ${a.code || 'ERROR'} ${a.message || ''}`).join(' | ');
  throw new Error(`No writable Milan Cloud DWN root found. Attempts: ${detail}`);
}

function dwnRoot() {
  return selectedLocalDwnRoot().root;
}

function databaseRoot() {
  return path.resolve(process.env.MILAN_DATABASE_DIR || path.join(dwnRoot(), 'database'));
}

function isolatedRoot() {
  return path.join(dwnRoot(), 'isolated-users');
}

function cloudReceiverRoot() {
  return path.resolve(process.env.MILAN_CLOUD_RECEIVER_ROOT || path.join(dwnRoot(), 'cloud-receiver'));
}

function userSpaceId(userId = '', did = '', email = '', preassigned = '') {
  if (preassigned && /^milan-/.test(String(preassigned))) return String(preassigned);
  const seed = `${userId}|${email}`;
  return `milan-${safeName(userId || shortHash(seed)).slice(0, 40)}-${shortHash(seed).slice(0, 8)}`;
}

function storageRootFor(spaceId) {
  return path.join(isolatedRoot(), safeName(spaceId));
}

function endpointForSpace(spaceId) {
  const remote = cloudRemoteBase();
  const base = remote || publicBase();
  const pathPart = `/api/isolated-dwn/${encodeURIComponent(spaceId)}`;
  return base ? `${base}${pathPart}` : pathPart;
}

function configuredEndpoints() {
  const endpoints = [
    process.env.REAL_DWN_CLOUD_ENDPOINT,
    process.env.MILAN_CLOUD_DWN_ENDPOINT,
    process.env.DWN_CLOUD_ENDPOINT,
    ...(String(process.env.DWN_CLOUD_ENDPOINTS || '').split(','))
  ].map(sanitizeEndpoint).filter(Boolean);
  return [...new Set(endpoints)];
}

function persistenceInfo() {
  const selected = selectedLocalDwnRoot();
  const root = selected.root;
  const remote = cloudRemoteBase();
  const render = isRenderRuntime();
  const normalized = root.replace(/\\/g, '/');
  const usingRenderDiskPath = render && (
    normalized.startsWith('/var/data') ||
    normalized.startsWith('/mnt/') ||
    normalized.startsWith('/opt/render/project/.data') ||
    normalized.includes('/opt/render/project/src/dwn-data')
  );
  const usingRuntimeFallback = remote ? false : (render && !usingRenderDiskPath);
  const required = String(process.env.MILAN_REQUIRE_CLOUD_DWN || process.env.MILAN_REQUIRE_REAL_DWN || 'true').toLowerCase() !== 'false';
  const mode = remote ? 'production-remote-dwn' : (render ? (usingRenderDiskPath ? 'render-persistent-cloud-dwn' : 'render-writable-cache-only') : 'local-development-dwn');
  const permanent = !!remote || selected.permanentExpected || !render;
  return {
    mode,
    remoteOnly: remoteOnlyRequired(),
    root,
    databaseRoot: databaseRoot(),
    isolatedRoot: isolatedRoot(),
    remoteEndpoint: remote,
    apiKeyConfigured: !!cloudApiKey(),
    renderRuntime: render,
    usingRenderDiskPath,
    usingRuntimeFallback,
    fallbackUsed: remote ? false : selected.fallbackUsed,
    appStoresUserData: false,
    remoteWriteEnabled: !!remote,
    realDwnProtocol: !!remote,
    sdkReady: !!remote,
    selectedBy: remote ? 'production-real-dwn-node-endpoint' : selected.selectedBy,
    candidateAttempts: selected.attempts,
    permanentExpected: permanent,
    requiresCloudDwn: required,
    warning: remote
      ? ''
      : 'V49 embedded production DWN is active on the same Render service.'
  };
}

function provisionIsolatedDwn({ userId = '', did = '', email = '', spaceId: preassigned = '' } = {}) {
  const spaceId = userSpaceId(userId, did, email, preassigned);
  const storageRoot = storageRootFor(spaceId);
  fs.mkdirSync(path.join(storageRoot, 'records'), { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'media'), { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'audit'), { recursive: true });
  const manifestFile = path.join(storageRoot, 'manifest.json');
  const p = persistenceInfo();
  const manifest = {
    app: 'MILAN',
    version: '49.0.0',
    realDwnProtocol: !!p.remoteEndpoint,
    sdkReady: !!p.remoteEndpoint,
    appStoresUserData: false,
    model: 'production-dwn-node-one-user-one-did-one-isolated-space',
    isolation: 'single-user',
    spaceId,
    userId,
    ownerDid: did,
    email,
    endpoint: endpointForSpace(spaceId),
    storageRoot,
    cloudStorageRoot: p.root,
    cloudDatabaseRoot: p.databaseRoot,
    cloudMode: p.mode,
    remoteEndpoint: p.remoteEndpoint || '',
    permanentExpected: p.permanentExpected,
    createdAt: fs.existsSync(manifestFile) ? undefined : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    accessPolicy: {
      ownerOnlyByDefault: true,
      sharingRequiresExplicitDIDPermission: true,
      adminCanSeePrivatePayloads: false,
      isolatedPerUser: true,
      cloudAuthoritative: true
    }
  };
  let existing = {};
  try { if (fs.existsSync(manifestFile)) existing = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch (_) {}
  fs.writeFileSync(manifestFile, JSON.stringify({ ...existing, ...manifest, createdAt: existing.createdAt || manifest.createdAt || new Date().toISOString() }, null, 2));
  return {
    endpoint: endpointForSpace(spaceId),
    mode: p.mode,
    realDwnConfigured: p.permanentExpected,
    realCloudConfigured: p.permanentExpected,
    assignedAt: existing.assignedAt || existing.createdAt || new Date().toISOString(),
    didServiceId: '#dwn',
    isolation: 'single-user',
    spaceId,
    storageRoot,
    manifestFile,
    cloud: p,
    policy: manifest.accessPolicy
  };
}

function assignDwnEndpoint(did, email = '', userId = '', spaceId = '') {
  return provisionIsolatedDwn({ userId, did, email, spaceId });
}

function ensureUserDwn(user, email = '') {
  if (!user) return user;
  // Preserve any spaceId already assigned to this user so their isolated DWN
  // node stays the same across logins/restarts. Never recompute it.
  const existingSpaceId = user.dwn?.spaceId || user.settings?.dwnSpaceId || '';
  const assigned = provisionIsolatedDwn({ userId: user.id, did: user.did, email: email || user.email, spaceId: existingSpaceId });
  user.dwnEndpoint = assigned.endpoint;
  user.dwn = {
    endpoint: assigned.endpoint,
    mode: assigned.mode,
    realDwnConfigured: assigned.realDwnConfigured,
    realCloudConfigured: assigned.realDwnConfigured,
    assignedAt: user.dwn?.assignedAt || user.created_at || assigned.assignedAt,
    realDwnDid: user.dwn?.realDwnDid,
    remoteProvision: user.dwn?.remoteProvision,
    didServiceId: '#dwn',
    isolation: assigned.isolation,
    spaceId: assigned.spaceId,
    storageRoot: assigned.storageRoot,
    cloud: assigned.cloud,
    policy: assigned.policy
  };
  user.settings = user.settings || {};
  user.settings.dwnMode = assigned.mode;
  user.settings.dwnEndpoint = assigned.endpoint;
  user.settings.realCloudDwnConfigured = assigned.realDwnConfigured;
  user.settings.dwnIsolation = assigned.isolation;
  user.settings.dwnSpaceId = assigned.spaceId;
  user.settings.cloudDwnRoot = assigned.cloud.root;
  user.settings.cloudDwnPermanentExpected = assigned.cloud.permanentExpected;
  return user;
}

function getDwnInfo(user) {
  const dwn = user?.dwn || {};
  const p = dwn.cloud || persistenceInfo();
  return {
    endpoint: user?.dwnEndpoint || dwn.endpoint || '',
    mode: dwn.mode || user?.settings?.dwnMode || p.mode,
    realDwnConfigured: dwn.realDwnConfigured ?? dwn.realCloudConfigured ?? user?.settings?.realCloudDwnConfigured ?? p.permanentExpected,
    realCloudConfigured: dwn.realDwnConfigured ?? dwn.realCloudConfigured ?? user?.settings?.realCloudDwnConfigured ?? p.permanentExpected,
    assignedAt: dwn.assignedAt || null,
    didServiceId: dwn.didServiceId || '#dwn',
    isolation: dwn.isolation || user?.settings?.dwnIsolation || 'single-user',
    spaceId: dwn.spaceId || user?.settings?.dwnSpaceId || '',
    storageRoot: dwn.storageRoot || '',
    cloud: p,
    policy: dwn.policy || {
      ownerOnlyByDefault: true,
      sharingRequiresExplicitDIDPermission: true,
      adminCanSeePrivatePayloads: false,
      isolatedPerUser: true,
      cloudAuthoritative: true
    }
  };
}

function makeDidDwnService(user) {
  const info = getDwnInfo(user);
  return {
    id: `${user.did}#dwn`,
    type: 'DecentralizedWebNode',
    serviceEndpoint: info.endpoint,
    routingKeys: [],
    accept: ['application/json', 'application/octet-stream'],
    isolation: info.isolation,
    spaceId: info.spaceId,
    cloudMode: info.mode
  };
}

async function postJson(url, payload) {
  const key = cloudApiKey();
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Cloud DWN push failed: ${res.status}`);
  return data;
}

// Point the real DWN engine's LevelDB stores at the same persistent cloud root
// the rest of MILAN uses (Render disk / local dwn dir), under an "engine" subdir.
let _engineRootSet = false;
function ensureEngineRoot() {
  if (_engineRootSet) return;
  try {
    realDwnEngine.setPersistRoot(path.join(dwnRoot(), 'real-dwn-engine'));
    _engineRootSet = true;
  } catch (_) { /* engine will use its own default */ }
}

// Real DWN-protocol write into THIS user's own isolated DWN node.
// Best-effort: never throws into the caller; returns a structured result that
// is attached to the record's cloudDwn.realNode field as cryptographic proof.
async function writeToRealUserDwnNode(record, user, info) {
  if (!realDwnEngine.enabled()) return { ok: false, reason: 'engine-disabled' };
  if (!user || !info || !info.spaceId) return { ok: false, reason: 'no-space-id' };
  ensureEngineRoot();
  try {
    return await realDwnEngine.writeRecord(
      {
        spaceId: info.spaceId,
        rawSeedHex: user.raw_seed,
        knownDidUri: user.did,
        portableDid: user.portableDid
      },
      record
    );
  } catch (err) {
    return { ok: false, reason: 'engine-write-threw', error: err.message };
  }
}

async function pushRecordToCloudDwn(record, user) {
  const info = getDwnInfo(user);
  const p = persistenceInfo();
  const remote = cloudRemoteBase();
  const now = new Date().toISOString();
  // Real per-user DWN node write (actual DWN protocol, signed RecordsWrite).
  const realNode = await writeToRealUserDwnNode(record, user, info);

  // REAL REMOTE DWN is authoritative. Never report a successful cloud
  // persistence result when the signed DWN write itself failed.
  if (realNode && realNode.ok === false) {
    return {
      pushed: false,
      realNode,
      endpoint: remote || info.endpoint,
      mode: 'real-remote-dwn-node',
      isolation: info.isolation,
      spaceId: info.spaceId,
      error: realNode.error || realNode.reason || 'Real DWN write failed.',
      pushedAt: now
    };
  }

  if (!remote || isEmbeddedSelfEndpoint(remote)) {
    return {
      pushed: true,
      realNode,
      endpoint: remote || info.endpoint,
      mode: isEmbeddedSelfEndpoint(remote) ? 'embedded-production-dwn-direct' : info.mode,
      isolation: info.isolation,
      spaceId: info.spaceId,
      cloudRoot: info.cloud?.root || dwnRoot(),
      reason: isEmbeddedSelfEndpoint(remote) ? 'embedded-self-dwn-direct-no-http-loop' : 'persisted-in-authoritative-cloud-dwn-root',
      permanentExpected: info.cloud?.permanentExpected,
      mediaUrl: `${remote || ''}/api/dwn/media/read/${encodeURIComponent(info.spaceId)}/${encodeURIComponent(record.id)}`.replace(/^\/api/, '/api'),
      pushedAt: now
    };
  }
  try {
    const response = await realDwn.postJson('/api/dwn/records/write', {
      app: 'MILAN',
      version: '49.0.0',
      realDwnProtocol: !!p.remoteEndpoint,
      sdkReady: !!p.remoteEndpoint,
      appStoresUserData: false,
      ownerDid: user?.did || record.owner,
      userId: user?.id || '',
      spaceId: info.spaceId,
      record,
      pushedAt: now
    });
    return {
      pushed: true,
      realNode,
      endpoint: remote,
      mode: 'real-remote-dwn-node',
      isolation: info.isolation,
      spaceId: info.spaceId,
      response,
      mediaUrl: `${remote}/api/dwn/media/read/${encodeURIComponent(info.spaceId)}/${encodeURIComponent(record.id)}`,
      pushedAt: now
    };
  } catch (err) {
    return {
      pushed: false,
      endpoint: remote,
      mode: 'real-remote-dwn-node',
      isolation: info.isolation,
      spaceId: info.spaceId,
      error: err.message,
      pushedAt: now
    };
  }
}


async function putStream(url, filePath, headers = {}) {
  const stat = fs.statSync(filePath);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Length': String(stat.size) },
    body: fs.createReadStream(filePath),
    duplex: 'half'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Cloud DWN media push failed: ${res.status}`);
  return data;
}

async function pushMediaToCloudDwn(record, user, absoluteFilePath) {
  const info = getDwnInfo(user);
  const remote = cloudRemoteBase();
  const now = new Date().toISOString();
  if (!remote || isEmbeddedSelfEndpoint(remote) || !absoluteFilePath || !fs.existsSync(absoluteFilePath)) {
    return {
      pushed: !remote || isEmbeddedSelfEndpoint(remote),
      endpoint: remote || info.endpoint,
      mode: isEmbeddedSelfEndpoint(remote) ? 'embedded-production-dwn-direct' : (remote ? 'real-remote-dwn-node' : info.mode),
      spaceId: info.spaceId,
      skipped: isEmbeddedSelfEndpoint(remote) ? 'embedded-self-dwn-media-already-in-isolated-space' : (!remote ? 'no-remote-cloud-dwn-endpoint-configured' : 'media-file-missing'),
      mediaUrl: `${remote || ''}/api/dwn/media/read/${encodeURIComponent(info.spaceId)}/${encodeURIComponent(record.id)}`.replace(/^\/api/, '/api'),
      pushedAt: now
    };
  }
  try {
    const key = cloudApiKey();
    const headers = {
      'Content-Type': record.dataFormat || 'application/octet-stream',
      'X-Milan-Record-Id': record.id,
      'X-Milan-Owner-Did': user?.did || record.owner || '',
      'X-Milan-File-Name': encodeURIComponent(record.data?.media?.fileName || `${record.id}`)
    };
    if (key) headers.Authorization = `Bearer ${key}`;
    const response = await putStream(`${remote}/api/dwn/media/write/${encodeURIComponent(info.spaceId)}/${encodeURIComponent(record.id)}`, absoluteFilePath, headers);
    return {
      pushed: true,
      endpoint: remote,
      mode: 'real-remote-dwn-node',
      spaceId: info.spaceId,
      response,
      mediaUrl: `${remote}/api/dwn/media/read/${encodeURIComponent(info.spaceId)}/${encodeURIComponent(record.id)}`,
      pushedAt: now
    };
  } catch (err) {
    return {
      pushed: false,
      endpoint: remote,
      mode: 'real-remote-dwn-node',
      spaceId: info.spaceId,
      error: err.message,
      pushedAt: now
    };
  }
}

async function provisionRemoteUserDwn(user = {}) {
  const p = persistenceInfo();
  if (!p.remoteEndpoint || !user || !user.did) return { ok: false, skipped: 'remote-dwn-not-configured' };
  try {
    const response = await realDwn.provisionUser(user);
    return { ok: true, endpoint: p.remoteEndpoint, response, provisionedAt: new Date().toISOString() };
  } catch (err) {
    return { ok: false, endpoint: p.remoteEndpoint, error: err.message, provisionedAt: new Date().toISOString() };
  }
}

async function syncDatabaseSnapshot(name, data) {
  try {
    const p = persistenceInfo();
    if (!p.remoteEndpoint) {
      return {
        ok: false,
        skipped: 'remote-dwn-not-configured',
        error: 'REAL_DWN_NODE_ENDPOINT is not configured'
      };
    }

    const response = await realDwn.pushDatabaseSnapshot(name, data);

    return {
      ok: true,
      backend: 'real-remote-dwn-node',
      endpoint: p.remoteEndpoint,
      response,
      syncedAt: new Date().toISOString()
    };
  } catch (err) {
    console.error('[Production DWN DB sync failed]', name, err.message);
    return {
      ok: false,
      backend: 'real-remote-dwn-node',
      error: err.message,
      syncedAt: new Date().toISOString()
    };
  }
}

async function pullDatabaseSnapshot(name) {
  try {
    const p = persistenceInfo();
    if (!p.remoteEndpoint) {
      return {
        ok: false,
        skipped: 'remote-dwn-not-configured',
        error: 'REAL_DWN_NODE_ENDPOINT is not configured',
        data: {}
      };
    }

    const data = await realDwn.pullDatabaseSnapshot(name);

    return {
      ok: true,
      backend: 'real-remote-dwn-node',
      endpoint: p.remoteEndpoint,
      data: data || {},
      missing: !data || Object.keys(data).length === 0,
      pulledAt: new Date().toISOString()
    };
  } catch (err) {
    console.error('[Production DWN DB pull failed]', name, err.message);
    return {
      ok: false,
      backend: 'real-remote-dwn-node',
      error: err.message,
      data: {}
    };
  }
}

async function realUserDwnNodeStatus(user) {
  const info = getDwnInfo(user);
  if (!info.spaceId) return { ok: false, reason: 'no-space-id' };
  ensureEngineRoot();
  return realDwnEngine.nodeStatus({ spaceId: info.spaceId, rawSeedHex: user?.raw_seed, knownDidUri: user?.did });
}

module.exports = {
  configuredEndpoints,
  provisionRemoteUserDwn,
  syncDatabaseSnapshot,
  pullDatabaseSnapshot,
  assignDwnEndpoint,
  ensureUserDwn,
  getDwnInfo,
  makeDidDwnService,
  pushRecordToCloudDwn,
  pushMediaToCloudDwn,
  provisionIsolatedDwn,
  dwnRoot,
  databaseRoot,
  isolatedRoot,
  storageRootFor,
  cloudReceiverRoot,
  persistenceInfo,
  cloudRemoteBase,
  cloudApiKey,
  remoteOnlyRequired,
  isEmbeddedSelfEndpoint,
  realDwnEngine,
  realUserDwnNodeStatus
};
