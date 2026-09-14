const fs = require('fs');
const path = require('path');

function sanitizeEndpoint(url = '') {
  const value = String(url || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (_) { return ''; }
}
function loadConfig() {
  const file = path.join(__dirname, '..', 'real-dwn-node.config.json');
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (_) {}
  return {};
}
function internalEndpointFromRenderService() {
  const host = String(process.env.REAL_DWN_NODE_HOST || process.env.MILAN_DWN_NODE_HOST || '').trim();
  const port = String(process.env.REAL_DWN_NODE_PORT || process.env.MILAN_DWN_NODE_PORT || '10000').trim();
  if (!host) return '';
  return `http://${host}${port ? `:${port}` : ''}`;
}
function defaultPublicDwnEndpoint() {
  // Production authority: use the persistent remote Real DWN service.
  const custom = String(process.env.DEFAULT_REAL_DWN_NODE_ENDPOINT || '').trim();
  if (custom) return custom;
  return 'https://dwn.onrender.com';
}
function endpoint() {
  const cfg = loadConfig();
  return sanitizeEndpoint(
    process.env.REAL_DWN_NODE_ENDPOINT ||
    process.env.REAL_DWN_CLOUD_ENDPOINT ||
    process.env.MILAN_REAL_DWN_ENDPOINT ||
    internalEndpointFromRenderService() ||
    cfg.REAL_DWN_NODE_ENDPOINT ||
    cfg.endpoint ||
    defaultPublicDwnEndpoint() ||
    ''
  );
}
function apiKey() {
  const cfg = loadConfig();
  return String(
    process.env.REAL_DWN_NODE_API_KEY ||
    process.env.REAL_DWN_CLOUD_API_KEY ||
    cfg.REAL_DWN_NODE_API_KEY ||
    cfg.apiKey ||
    process.env.DEFAULT_MILAN_DWN_NODE_API_KEY ||
    'milan-v49-embedded-production-dwn-key'
  ).trim();
}
function remoteOnly() {
  const value = String(process.env.REAL_DWN_REMOTE_ONLY || process.env.MILAN_REMOTE_DWN_ONLY || loadConfig().REAL_DWN_REMOTE_ONLY || 'true').toLowerCase();
  return value !== 'false';
}
function configured() { return !!endpoint(); }
function headers(extra = {}) {
  const h = { ...extra };
  const key = apiKey();
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

async function rawRequest(pathPart, options = {}) {
  const base = endpoint();
  if (!base) throw new Error('REAL_DWN_NODE_ENDPOINT missing. Milan V49 embedded production DWN endpoint missing.');
  const fetchOptions = { ...options, headers: headers(options.headers || {}) };
  if (!fetchOptions.signal) fetchOptions.signal = AbortSignal.timeout(7000);
  const res = await fetch(`${base}${pathPart}`, fetchOptions);
  const text = await res.text().catch(() => '');
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  return { res, data, status: res.status, ok: res.ok, pathPart };
}

async function requestJson(pathPart, options = {}) {
  const { res, data, status } = await rawRequest(pathPart, options);
  if (!res.ok) throw new Error(data.error || `Production DWN node request failed: ${status} on ${pathPart}`);
  return data;
}

async function tryJson(paths, options = {}, opts = {}) {
  const list = Array.isArray(paths) ? paths : [paths];
  let last = null;
  for (const p of list) {
    try {
      const r = await rawRequest(p, options);
      last = r;
      if (r.ok) return r.data;
      if (r.status === 404 && opts.allowMissing) return opts.missingValue !== undefined ? opts.missingValue : {};
      // If route not found, try compatibility route. If route exists but failed with auth/400/500, stop.
      if (r.status !== 404) {
        const err = new Error(r.data.error || `Production DWN node request failed: ${r.status} on ${p}`);
        err.status = r.status; err.response = r.data; err.pathPart = p;
        throw err;
      }
    } catch (err) {
      if (err.status && err.status !== 404) throw err;
      last = { error: err.message, pathPart: p };
    }
  }
  if (opts.allowMissing) return opts.missingValue !== undefined ? opts.missingValue : {};
  throw new Error(last?.data?.error || last?.error || `Production DWN node request failed: ${last?.status || 'unknown'} on ${last?.pathPart || 'unknown route'}`);
}


function snapshotRecordId(name) {
  return `db-snapshot-${String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}
function snapshotSpaceId() { return 'milan-global-database'; }
async function tryRawJson(paths, options = {}) {
  const list = Array.isArray(paths) ? paths : [paths];
  const results = [];
  for (const p of list) {
    try {
      const r = await rawRequest(p, options);
      results.push({ pathPart: p, status: r.status, ok: r.ok, data: r.data });
      if (r.ok) return { ok: true, data: r.data, pathPart: p, status: r.status, results };
      if (r.status !== 404) return { ok: false, data: r.data, pathPart: p, status: r.status, results };
    } catch (err) {
      results.push({ pathPart: p, error: err.message, ok: false });
    }
  }
  return { ok: false, status: 404, data: { error: 'All DWN compatibility routes returned 404' }, results };
}

async function ping() {
  const base = endpoint();
  if (!base) return { ok: false, configured: false, error: 'REAL_DWN_NODE_ENDPOINT missing' };
  const urls = [
    `${base}/api/dwn/node/status`,
    `${base}/api/cloud-dwn/node/status`,
    `${base}/api/cloud-dwn/status`,
    `${base}/api/health`,
    `${base}/health`
  ];
  let last = '';
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(7000) });
      const data = await res.json().catch(() => ({ status: res.status }));
      if (res.ok) return { ok: true, configured: true, endpoint: base, url, response: data, realDwnProtocol: data.realDwnProtocol !== false, sdkReady: data.sdkReady !== false };
      last = `${url} => ${res.status}`;
    } catch (err) { last = `${url} => ${err.message}`; }
  }
  return { ok: false, configured: true, endpoint: base, error: last || 'Remote DWN ping failed' };
}
async function postJson(pathPart, payload) { return requestJson(pathPart, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
async function putJson(pathPart, payload) { return requestJson(pathPart, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
async function getJson(pathPart) { return requestJson(pathPart, { method: 'GET' }); }
async function putFile(pathPart, filePath, contentType = 'application/octet-stream', extraHeaders = {}) {
  const base = endpoint();
  if (!base) throw new Error('REAL_DWN_NODE_ENDPOINT missing. Milan V49 embedded production DWN endpoint missing.');
  const stat = fs.statSync(filePath);
  const res = await fetch(`${base}${pathPart}`, {
    method: 'PUT',
    headers: headers({ ...extraHeaders, 'Content-Type': contentType, 'Content-Length': String(stat.size) }),
    body: fs.createReadStream(filePath),
    duplex: 'half'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Production DWN node media upload failed: ${res.status}`);
  return data;
}
function mediaUrl(spaceId, recordId) {
  const base = endpoint();
  if (!base || !spaceId || !recordId) return '';
  return `${base}/api/dwn/media/read/${encodeURIComponent(spaceId)}/${encodeURIComponent(recordId)}`;
}
async function provisionUser(user = {}) {
  const payload = {
    spaceId: user?.dwn?.spaceId || user?.settings?.dwnSpaceId,
    did: user.did,
    userId: user.id,
    email: user.email,
    profile: user.profile || {}
  };
  return tryJson([
    '/api/dwn/users/provision',
    '/api/cloud-dwn/users/provision',
    '/api/dwn/user/provision'
  ], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}
async function pushDatabaseSnapshot(name, data) {
  const safeName = encodeURIComponent(name);
  const payload = { name, data, pushedAt: new Date().toISOString() };
  const routes = [
    `/api/dwn/database/${safeName}`,
    `/api/cloud-dwn/database/${safeName}`,
    `/api/cloud-dwn/db/${safeName}`,
    `/api/dwn/database/write/${safeName}`,
    `/api/dwn/snapshot/${safeName}`,
    `/api/cloud-dwn/node/database/${safeName}`,
    `/api/dwn/db/${safeName}`,
    `/api/dwn/databases/${safeName}`,
    `/api/cloud-dwn/snapshot/${safeName}`,
    `/api/cloud-dwn/snapshots/${safeName}`,
    `/api/dwn/database/snapshot/${safeName}`,
    `/api/cloud-dwn/database/write/${safeName}`
  ];
  const direct = await tryRawJson(routes, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (direct.ok) return direct.data;

  if (remoteOnly()) {
    const msg = (direct.results || []).map(r => `${r.pathPart}:${r.status || r.error}`).join(' | ');
    throw new Error(`Production DWN database sync failed in remote-only mode. No native database route accepted ${name}. ${msg}`);
  }

  // Backward compatibility for explicitly non-remote-only deployments.
  const recordId = snapshotRecordId(name);
  const fallbackRecord = {
    app: 'MILAN',
    schema: 'database-snapshot',
    id: recordId,
    title: `Database snapshot ${name}`,
    dataFormat: 'application/json',
    accessMode: 'private',
    dateCreated: new Date().toISOString(),
    dateModified: new Date().toISOString(),
    data: payload
  };
  const fallback = await tryRawJson([
    '/api/dwn/records/write',
    '/api/cloud-dwn/ingest/record',
    '/api/cloud-dwn/records',
    '/api/dwn/ingest/record',
    '/api/dwn/records',
    '/api/cloud-dwn/records/write',
    '/api/cloud-dwn/node/records/write'
  ], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spaceId: snapshotSpaceId(), ownerDid: 'did:milan:system', record: fallbackRecord }) });
  if (fallback.ok) return { ok: true, compatibilityMode: 'records-write-snapshot', name, recordId, response: fallback.data };
  const msg = (direct.results || []).concat(fallback.results || []).map(r => `${r.pathPart}:${r.status || r.error}`).join(' | ');
  throw new Error(`Production DWN database sync failed. No compatible route accepted ${name}. ${msg}`);
}
async function pullDatabaseSnapshot(name) {
  const safeName = encodeURIComponent(name);
  const routes = [
    `/api/dwn/database/${safeName}`,
    `/api/cloud-dwn/database/${safeName}`,
    `/api/cloud-dwn/db/${safeName}`,
    `/api/dwn/database/read/${safeName}`,
    `/api/dwn/snapshot/${safeName}`,
    `/api/cloud-dwn/node/database/${safeName}`,
    `/api/dwn/db/${safeName}`,
    `/api/dwn/databases/${safeName}`,
    `/api/cloud-dwn/snapshot/${safeName}`,
    `/api/cloud-dwn/snapshots/${safeName}`,
    `/api/dwn/database/snapshot/${safeName}`,
    `/api/cloud-dwn/database/read/${safeName}`
  ];

  const response = await tryJson(
    routes,
    { method: 'GET' },
    { allowMissing: true, missingValue: {} }
  );

  return response && Object.prototype.hasOwnProperty.call(response, 'data')
    ? response.data
    : response;
}

module.exports = {
  loadConfig, endpoint, apiKey, remoteOnly, configured, ping, postJson, putJson, getJson,
  putFile, mediaUrl, provisionUser, pushDatabaseSnapshot, pullDatabaseSnapshot,
  internalEndpointFromRenderService
};
