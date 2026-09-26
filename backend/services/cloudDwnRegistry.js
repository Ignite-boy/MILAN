const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { supabase } = require('../utils/dwnStorage');

const deletedRecordIds = new Set();

// MILAN SUPABASE STORAGE RULE:
// 1 user = 1 DID = 1 isolated Supabase space.
// Supabase is authoritative for user snapshots, records, and media.
// Local files are compatibility/cache storage only.

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

function publicBase() {
  return sanitizeEndpoint(
    process.env.APP_PUBLIC_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.SEO_CANONICAL_URL ||
    ''
  ) || '';
}

function cloudRemoteBase() {
  // Supabase is the authoritative cloud backend.
  // No external DWN endpoint is used.
  return '';
}

function cloudApiKey() {
  return String(
    process.env.MILAN_CLOUD_DWN_API_KEY ||
    process.env.DWN_CLOUD_API_KEY ||
    ''
  ).trim();
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
  return false;
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

function candidateRoots() {
  return unique([
    process.env.MILAN_CLOUD_DWN_ROOT,
    process.env.MILAN_DATA_ROOT,
    process.env.MILAN_LOCAL_DWN_ROOT,
    localDevelopmentRoot(),
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
      selectedRootCache = {
        root: candidate,
        attempts,
        fallbackUsed: attempts.length > 1,
        selectedBy: attempts.length === 1 ? 'configured-root' : 'first-writable-root',
        permanentExpected: true,
        warning: ''
      };
      return selectedRootCache;
    }
  }

  const detail = attempts.map(a => `${a.root} => ${a.code || 'ERROR'} ${a.message || ''}`).join(' | ');
  throw new Error(`No writable Milan local cache root found. Attempts: ${detail}`);
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
  // MILAN is Supabase-authoritative; no external DWN endpoint is configured.
  return [];
}

function persistenceInfo() {
  const selected = selectedLocalDwnRoot();
  const root = selected.root;
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();

  return {
    mode: 'supabase',
    remoteOnly: false,
    root,
    databaseRoot: databaseRoot(),
    isolatedRoot: isolatedRoot(),
    remoteEndpoint: supabaseUrl,
    apiKeyConfigured: !!process.env.SUPABASE_SERVICE_KEY,
    usingRuntimeFallback: false,
    fallbackUsed: selected.fallbackUsed,
    appStoresUserData: false,
    remoteWriteEnabled: !!supabaseUrl,
    realDwnProtocol: false,
    sdkReady: true,
    selectedBy: 'supabase-authoritative-storage',
    candidateAttempts: selected.attempts,
    permanentExpected: true,
    requiresCloudDwn: false,
    warning: ''
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
    realDwnProtocol: false,
    sdkReady: true,
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
    realDwnConfigured: false,
    realCloudConfigured: true,
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
    realCloudConfigured: assigned.realCloudConfigured,
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
  user.settings.realCloudDwnConfigured = assigned.realCloudConfigured;
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
    realDwnConfigured: dwn.realCloudConfigured ?? user?.settings?.realCloudDwnConfigured ?? true,
    realCloudConfigured: dwn.realCloudConfigured ?? user?.settings?.realCloudDwnConfigured ?? true,
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

async function ensureSupabaseTenant(did) {
  const tenantDid = String(did || '').trim();
  if (!tenantDid) throw new Error('Missing tenant DID');

  const { error } = await supabase
    .from('dwn_tenants')
    .upsert({ did: tenantDid }, { onConflict: 'did' });

  if (error) throw error;
  return tenantDid;
}

async function deleteRecordFromCloudDwn(recordId, ownerDid = '') {
  const id = String(recordId || '').trim();
  if (!id) throw new Error('Record id is required for permanent DWN deletion.');

  deletedRecordIds.add(id);

  try {
    const { error: dataError } = await supabase
      .from('dwn_record_data')
      .delete()
      .eq('record_id', id);

    if (dataError) throw dataError;

    let query = supabase
      .from('dwn_records')
      .delete()
      .eq('record_id', id);

    if (ownerDid) query = query.eq('owner_did', String(ownerDid));

    const { error: recordError } = await query;

    if (recordError) throw recordError;

    return {
      deleted: true,
      permanent: true,
      backend: 'supabase',
      recordId: id,
      deletedAt: new Date().toISOString()
    };
  } catch (err) {
    deletedRecordIds.delete(id);
    throw err;
  }
}

async function pushRecordToCloudDwn(record, user) {
  const info = getDwnInfo(user);
  const now = new Date().toISOString();
  const ownerDid = String(user?.did || record?.owner || '').trim();
  const recordId = String(record?.id || '').trim();

  if (deletedRecordIds.has(recordId)) {
    return { pushed: false, backend: 'supabase', recordId, skipped: 'permanently-deleted' };
  }

  if (!recordId) {
    return {
      pushed: false,
      backend: 'supabase',
      error: 'Record id is required',
      pushedAt: now
    };
  }

  if (!ownerDid) {
    return {
      pushed: false,
      backend: 'supabase',
      error: 'Owner DID is required',
      pushedAt: now
    };
  }

  try {
    await ensureSupabaseTenant(ownerDid);

    const payload = record.binaryData
      ? Buffer.from(record.binaryData)
      : Buffer.from(
          typeof record.data === 'string'
            ? record.data
            : JSON.stringify(record.data ?? {}),
          'utf8'
        );

    const dataCid = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;

    const metadata = {
      title: record.title || '',
      tags: Array.isArray(record.tags) ? record.tags : [],
      accessMode: record.accessMode || 'private',
      sharedWithDids: Array.isArray(record.sharedWithDids) ? record.sharedWithDids : [],
      favorite: !!record.favorite,
      dwnRecordId: record.dwnRecordId || '',
      spaceId: info.spaceId || '',
      interface: 'Records',
      method: 'Write',
      media: record?.data?.kind === 'media' && record?.data?.media
        ? {
            fileName: record.data.media.fileName || '',
            mimeType: record.data.media.mimeType || record.dataFormat || '',
            sizeBytes: Number(record.data.media.sizeBytes || 0),
            previewCategory: record.data.media.previewCategory || '',
            browserPlayable: typeof record.data.media.browserPlayable === 'boolean' ? record.data.media.browserPlayable : undefined,
            mediaUrl: record.data.media.mediaUrl || '/api/records/' + encodeURIComponent(recordId) + '/media'
          }
        : null
    };

    const { error: recordError } = await supabase
      .from('dwn_records')
      .upsert(
        {
          record_id: recordId,
          target_did: ownerDid,
          owner_did: ownerDid,
          schema: String(record.schema || ''),
          data_format: String(record.dataFormat || 'application/json'),
          protocol: String(record.protocol || ''),
          protocol_path: String(record.protocolPath || ''),
          recipient: String(record.recipient || ownerDid),
          published: !!record.published,
          date_created: record.dateCreated || now,
          date_modified: record.dateModified || now,
          deleted: !!record.deleted,
          metadata: JSON.stringify(metadata),
          data_cid: dataCid,
          data_size: payload.length
        },
        { onConflict: 'record_id' }
      );

    if (recordError) throw recordError;

    const bytea = '\\x' + payload.toString('hex');

    const { error: dataError } = await supabase
      .from('dwn_record_data')
      .upsert(
        {
          record_id: recordId,
          data: bytea
        },
        { onConflict: 'record_id' }
      );

    if (dataError) throw dataError;

    return {
      pushed: true,
      backend: 'supabase',
      endpoint: process.env.SUPABASE_URL || '',
      mode: 'supabase',
      isolation: info.isolation || 'single-user',
      spaceId: info.spaceId || '',
      recordId,
      dataCid,
      dataSize: payload.length,
      pushedAt: now
    };
  } catch (err) {
    console.error('[Supabase DWN record sync failed]', recordId, err.message);
    return {
      pushed: false,
      backend: 'supabase',
      endpoint: process.env.SUPABASE_URL || '',
      mode: 'supabase',
      isolation: info.isolation || 'single-user',
      spaceId: info.spaceId || '',
      error: err.message,
      pushedAt: now
    };
  }
}

async function pushMediaToCloudDwn(record, user, absoluteFilePath) {
  const info = getDwnInfo(user);
  const now = new Date().toISOString();

  if (!absoluteFilePath || !fs.existsSync(absoluteFilePath)) {
    return {
      pushed: false,
      backend: 'supabase',
      spaceId: info.spaceId || '',
      skipped: 'media-file-missing',
      pushedAt: now
    };
  }

  const bucket = String(
    process.env.SUPABASE_MEDIA_BUCKET || 'milan-dwn-storage'
  ).trim();

  try {
    const originalName = String(
      record?.data?.media?.fileName ||
      record?.data?.fileName ||
      path.basename(absoluteFilePath) ||
      record?.id ||
      'milan-media'
    );

    const safeFileName = path.basename(originalName)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 180) || 'milan-media';

    const objectPath = [
      safeName(info.spaceId || user?.did || 'unknown'),
      safeName(record.id),
      safeFileName
    ].join('/');

    const fileBuffer = fs.readFileSync(absoluteFilePath);

    let uploadError = null;
    const uploadAttempts = Math.max(
      1,
      Number(process.env.MILAN_MEDIA_SYNC_RETRIES || 3)
    );

    for (let attempt = 1; attempt <= uploadAttempts; attempt++) {
      const result = await supabase.storage
        .from(bucket)
        .upload(objectPath, fileBuffer, {
          upsert: true,
          contentType: record.dataFormat || 'application/octet-stream',
          cacheControl: '3600'
        });

      uploadError = result.error || null;
      if (!uploadError) break;

      if (attempt < uploadAttempts) {
        await new Promise(resolve =>
          setTimeout(resolve, 800 * attempt)
        );
      }
    }

    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage
      .from(bucket)
      .getPublicUrl(objectPath);

    return {
      pushed: true,
      backend: 'supabase',
      bucket,
      objectPath,
      endpoint: process.env.SUPABASE_URL || '',
      mode: 'supabase',
      spaceId: info.spaceId || '',
      mediaUrl: publicData?.publicUrl || '',
      dataSize: fileBuffer.length,
      pushedAt: now
    };
  } catch (err) {
    console.error('[Supabase media sync failed]', record?.id, err.message);
    return {
      pushed: false,
      backend: 'supabase',
      bucket,
      spaceId: info.spaceId || '',
      error: err.message,
      pushedAt: now
    };
  }
}

async function provisionRemoteUserDwn(user = {}) {
  const did = String(user?.did || '').trim();
  if (!did) return { ok: false, backend: 'supabase', error: 'User DID is required' };

  try {
    await ensureSupabaseTenant(did);
    return {
      ok: true,
      backend: 'supabase',
      did,
      provisionedAt: new Date().toISOString()
    };
  } catch (err) {
    return {
      ok: false,
      backend: 'supabase',
      did,
      error: err.message,
      provisionedAt: new Date().toISOString()
    };
  }
}

async function syncDatabaseSnapshot(name, data) {
  try {
    const snapshotName = String(name || '').trim();
    if (!snapshotName) {
      return {
        ok: false,
        backend: 'supabase',
        error: 'Snapshot name is required',
        syncedAt: new Date().toISOString()
      };
    }

    const { error } = await supabase
      .from('dwn_database_snapshots')
      .upsert(
        {
          name: snapshotName,
          data: data && typeof data === 'object' ? data : {},
          pushed_at: new Date().toISOString()
        },
        { onConflict: 'name' }
      );

    if (error) throw error;

    return {
      ok: true,
      backend: 'supabase',
      endpoint: process.env.SUPABASE_URL || '',
      response: { name: snapshotName },
      syncedAt: new Date().toISOString()
    };
  } catch (err) {
    console.error('[Supabase DB snapshot sync failed]', name, err.message);
    return {
      ok: false,
      backend: 'supabase',
      error: err.message,
      syncedAt: new Date().toISOString()
    };
  }
}

async function pullDatabaseSnapshot(name) {
  try {
    const snapshotName = String(name || '').trim();
    if (!snapshotName) {
      return {
        ok: false,
        backend: 'supabase',
        error: 'Snapshot name is required',
        data: {}
      };
    }

    const { data: row, error } = await supabase
      .from('dwn_database_snapshots')
      .select('data,pushed_at')
      .eq('name', snapshotName)
      .maybeSingle();

    if (error) throw error;

    const snapshotData = row?.data || {};

    return {
      ok: true,
      backend: 'supabase',
      endpoint: process.env.SUPABASE_URL || '',
      data: snapshotData,
      missing: !row,
      pulledAt: row?.pushed_at || new Date().toISOString()
    };
  } catch (err) {
    console.error('[Supabase DB snapshot pull failed]', name, err.message);
    return {
      ok: false,
      backend: 'supabase',
      error: err.message,
      data: {}
    };
  }
}

async function realUserDwnNodeStatus(user) {
  const info = getDwnInfo(user);
  if (!info.spaceId) return { ok: false, reason: 'no-space-id' };

  try {
    const { data: tenant, error } = await supabase
      .from('dwn_tenants')
      .select('did,created_at')
      .eq('did', user?.did || '')
      .maybeSingle();

    if (error) throw error;

    return {
      ok: true,
      backend: 'supabase',
      mode: 'supabase',
      nodeReady: true,
      tenantConfigured: !!tenant,
      did: user?.did || '',
      spaceId: info.spaceId,
      endpoint: info.endpoint || process.env.SUPABASE_URL || '',
      createdAt: tenant?.created_at || null,
      checkedAt: new Date().toISOString()
    };
  } catch (err) {
    return {
      ok: false,
      backend: 'supabase',
      mode: 'supabase',
      did: user?.did || '',
      spaceId: info.spaceId,
      reason: err.message,
      checkedAt: new Date().toISOString()
    };
  }
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
  deleteRecordFromCloudDwn,
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
  realUserDwnNodeStatus
};
