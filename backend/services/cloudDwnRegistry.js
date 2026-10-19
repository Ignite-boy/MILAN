const crypto = require('crypto');
const APP_VERSION = require('../../package.json').version;
const fs = require('fs');
const path = require('path');
const { supabase } = require('../utils/dwnStorage');
const milanDb = require('./milanDb');
const { withStorageQuotaTransaction } = require('./storageQuotaGuard');

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
  // Voroa PostgreSQL is primary for core storage; no signed DWN protocol endpoint is configured.
  return [];
}

function persistenceInfo() {
  const selected = selectedLocalDwnRoot();
  const root = selected.root;
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const legacySupabaseCredentialsConfigured =
    !!supabaseUrl && !!process.env.SUPABASE_SERVICE_KEY;

  return {
    mode: 'voroa-postgresql',
    backend: 'voroa',
    primaryPersistence: 'voroa-postgresql',
    // milanDb.js requires a configured connection string at module load.
    // The status route independently checks live reachability.
    voroaDatabaseConfigured: true,
    remoteOnly: false,
    root,
    databaseRoot: databaseRoot(),
    isolatedRoot: isolatedRoot(),
    // Do not advertise the legacy Supabase endpoint as the primary endpoint.
    remoteEndpoint: '',
    legacySupabaseEndpointConfigured: !!supabaseUrl,
    legacySupabaseCredentialsConfigured,
    // Compatibility fields: these still describe legacy Supabase credentials.
    apiKeyConfigured: !!process.env.SUPABASE_SERVICE_KEY,
    remoteWriteEnabled: legacySupabaseCredentialsConfigured,
    usingRuntimeFallback: false,
    fallbackUsed: selected.fallbackUsed,
    appStoresUserData: false,
    realDwnProtocol: false,
    sdkReady: false,
    realDwnEnginePresent: false,
    selectedBy: 'voroa-postgresql-primary-core-storage',
    candidateAttempts: selected.attempts,
    permanentExpected: true,
    requiresCloudDwn: false,
    warning: 'Voroa PostgreSQL is primary for core snapshots, records, and media. Legacy payment/storage integrations still depend on Supabase. Signed DWN protocol execution is not integrated.'
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
    version: APP_VERSION,
    realDwnProtocol: false,
    sdkReady: false,
    protocolEngineReady: false,
    appStoresUserData: false,
    model: 'voroa-postgresql-primary-one-user-one-did-one-isolated-space',
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
    realCloudConfigured: !!p.remoteWriteEnabled && !!p.apiKeyConfigured,
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
  const p = persistenceInfo();
  return {
    endpoint: user?.dwnEndpoint || dwn.endpoint || '',
    mode: dwn.mode || user?.settings?.dwnMode || p.mode,
    // Protocol readiness must come from the actual engine capability, never from Supabase configuration.
    realDwnConfigured: p.realDwnProtocol === true && dwn.realDwnConfigured === true,
    realCloudConfigured: !!p.remoteWriteEnabled && !!p.apiKeyConfigured,
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

  const result = await milanDb.query(
    'SELECT did, space_id FROM public.users WHERE did = $1 LIMIT 1',
    [tenantDid]
  );

  if (result.rowCount !== 1 || !result.rows[0].space_id) {
    throw new Error('Voroa user DID/space mapping not found; refusing to provision an unowned tenant.');
  }

  return { did: result.rows[0].did, spaceId: result.rows[0].space_id, backend: 'voroa' };
}

async function deleteRecordFromCloudDwn(recordId, ownerDid = '') {
  const id = String(recordId || '').trim();
  const did = String(ownerDid || '').trim();
  if (!id) throw new Error('Record id is required for permanent DWN deletion.');
  if (!did) throw new Error('Owner DID is required for isolated DWN deletion.');

  const userResult = await milanDb.query(
    'SELECT space_id FROM public.users WHERE did = $1 LIMIT 1',
    [did]
  );
  if (userResult.rowCount !== 1 || !userResult.rows[0].space_id) {
    throw new Error('Cannot resolve the authoritative Voroa DID/space mapping.');
  }

  const result = await milanDb.query(
    `WITH deleted_record AS (
       DELETE FROM public.dwn_storage
        WHERE component_type = 'record'
          AND did = $1 AND space_id = $2 AND item_key = $3
       RETURNING item_key
     ),
     deleted_media AS (
       DELETE FROM public.dwn_storage
        WHERE component_type = 'record_data'
          AND did = $1 AND space_id = $2
          AND (item_key = 'media:' || $3 OR parent_key = $3)
       RETURNING item_key
     )
     SELECT
       (SELECT COUNT(*) FROM deleted_record)::int AS deleted_record_count,
       (SELECT COUNT(*) FROM deleted_media)::int AS deleted_media_count`,
    [did, userResult.rows[0].space_id, id]
  );

  const deletedRecordCount = Number(result.rows?.[0]?.deleted_record_count || 0);
  const deletedMediaCount = Number(result.rows?.[0]?.deleted_media_count || 0);
  const deleted = deletedRecordCount > 0 || deletedMediaCount > 0;

  if (deletedRecordCount > 0) deletedRecordIds.add(id);
  return {
    deleted,
    recordDeleted: deletedRecordCount > 0,
    mediaDeleted: deletedMediaCount > 0,
    permanent: true,
    backend: 'voroa',
    recordId: id,
    deletedAt: new Date().toISOString()
  };
}

async function pushRecordToCloudDwn(record, user) {
  const now = new Date().toISOString();
  const ownerDid = String(user?.did || record?.owner || '').trim();
  const recordId = String(record?.id || '').trim();

  if (!recordId) return { pushed: false, backend: 'voroa', error: 'Record id is required', pushedAt: now };
  if (!ownerDid) return { pushed: false, backend: 'voroa', error: 'Owner DID is required', pushedAt: now };
  if (deletedRecordIds.has(recordId)) {
    return { pushed: false, backend: 'voroa', recordId, skipped: 'permanently-deleted' };
  }

  try {
    const userResult = await milanDb.query(
      'SELECT space_id FROM public.users WHERE did = $1 LIMIT 1',
      [ownerDid]
    );
    if (userResult.rowCount !== 1 || !userResult.rows[0].space_id) {
      throw new Error('Cannot resolve the authoritative Voroa DID/space mapping.');
    }

    const spaceId = String(userResult.rows[0].space_id).trim();
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
      spaceId,
      interface: 'Records',
      method: 'Write',
      media: record?.data?.kind === 'media' && record?.data?.media
        ? {
            fileName: record.data.media.fileName || '',
            mimeType: record.data.media.mimeType || record.dataFormat || '',
            sizeBytes: Number(record.data.media.sizeBytes || 0),
            previewCategory: record.data.media.previewCategory || '',
            browserPlayable: typeof record.data.media.browserPlayable === 'boolean' ? record.data.media.browserPlayable : undefined,
            processing: !!record.data.media.processing,
            processingStatus: record.data.media.processingStatus || (record.data.media.processing ? 'processing' : 'ready'),
            compatibilityWarning: record.data.media.compatibilityWarning || record.mediaCompatibility?.warning || '',
            mediaUrl: record.data.media.mediaUrl || '/api/records/' + encodeURIComponent(recordId) + '/media'
          }
        : null
    };

    await withStorageQuotaTransaction(
      milanDb,
      {
        did: ownerDid, spaceId, componentType: 'record',
        itemKey: recordId, newBytes: payload.length
      },
      async client => client.query(
      `INSERT INTO public.dwn_storage
       (component_type, did, space_id, item_key, schema_uri, data_format,
        protocol, protocol_path, recipient, published, date_created, date_modified,
        deleted, metadata, data_bytes, data_cid, data_size)
       VALUES ('record',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (did, space_id, component_type, item_key)
       DO UPDATE SET
         schema_uri = EXCLUDED.schema_uri,
         data_format = EXCLUDED.data_format,
         protocol = EXCLUDED.protocol,
         protocol_path = EXCLUDED.protocol_path,
         recipient = EXCLUDED.recipient,
         published = EXCLUDED.published,
         date_modified = EXCLUDED.date_modified,
         deleted = EXCLUDED.deleted,
         metadata = EXCLUDED.metadata,
         data_bytes = EXCLUDED.data_bytes,
         data_cid = EXCLUDED.data_cid,
         data_size = EXCLUDED.data_size,
         updated_at = NOW()`,
      [
        ownerDid, spaceId, recordId, String(record.schema || ''),
        String(record.dataFormat || 'application/json'),
        String(record.protocol || ''), String(record.protocolPath || ''),
        String(record.recipient || ownerDid), !!record.published,
        record.dateCreated || now, record.dateModified || now,
        !!record.deleted, JSON.stringify(metadata), payload, dataCid, payload.length
      ]
      )
    );

    return {
      pushed: true,
      backend: 'voroa',
      mode: 'voroa-postgresql',
      isolation: 'did-space',
      spaceId,
      recordId,
      dataCid,
      dataSize: payload.length,
      pushedAt: now
    };
  } catch (err) {
    console.error('[Voroa DWN record sync failed]', recordId, err.message);
    return {
      pushed: false,
      backend: 'voroa',
      mode: 'voroa-postgresql',
      recordId,
      error: err.message,
      status: Number(err.status) || 502,
      code: err.code || 'VOROA_RECORD_WRITE_FAILED',
      pushedAt: now
    };
  }
}

function supabaseResumableEndpoint() {
  const raw = String(process.env.SUPABASE_URL || '').trim();
  if (!raw) throw new Error('SUPABASE_URL is required for resumable media upload.');
  const url = new URL(raw);
  if (/\.supabase\.co$/i.test(url.hostname) && !/\.storage\.supabase\.co$/i.test(url.hostname)) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/i, '.storage.supabase.co');
  }
  return url.origin + '/storage/v1/upload/resumable';
}

function uploadLargeMediaWithTus(filePath, bucket, objectPath, contentType, sizeBytes) {
  const tus = require('tus-js-client');
  const serviceKey = String(process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY is required for resumable media upload.');
  const chunkSize = 6 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath, { highWaterMark: chunkSize });
    input.on('error', reject);
    const upload = new tus.Upload(input, {
      endpoint: supabaseResumableEndpoint(),
      uploadSize: sizeBytes,
      chunkSize,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: 'Bearer ' + serviceKey,
        apikey: serviceKey,
        'x-upsert': 'true'
      },
      metadata: {
        bucketName: bucket,
        objectName: objectPath,
        contentType,
        cacheControl: '3600'
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      onError: reject,
      onSuccess: resolve
    });
    upload.start();
  });
}

async function pushMediaToCloudDwn(record, user, absoluteFilePath) {
  const pushedAt = new Date().toISOString();
  const did = String(user?.did || record?.owner || '').trim();
  const recordId = String(record?.id || '').trim();
  if (!did || !recordId) return { pushed: false, backend: 'voroa', error: 'Missing owner DID or record ID', pushedAt };
  if (!absoluteFilePath || !fs.existsSync(absoluteFilePath)) {
    return { pushed: false, backend: 'voroa', error: 'Media file not found', pushedAt };
  }

  try {
    const owner = await milanDb.query(
      'SELECT space_id FROM public.users WHERE did = $1 LIMIT 1', [did]
    );
    if (owner.rowCount !== 1 || !owner.rows[0].space_id) {
      throw new Error('Voroa owner DID/space mapping not found');
    }
    const spaceId = String(owner.rows[0].space_id);
    const stat = fs.statSync(absoluteFilePath);
    const maxBytes = Number(process.env.MILAN_MAX_VOROA_MEDIA_BYTES || 768 * 1024 * 1024);
    if (!stat.isFile() || stat.size < 1) throw new Error('Media file is empty or invalid');
    if (stat.size > maxBytes) throw new Error('Media exceeds configured PostgreSQL media limit');

    const bytes = fs.readFileSync(absoluteFilePath);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const media = record?.data?.media || {};
    const fileName = path.basename(String(media.fileName || record?.title || absoluteFilePath))
      .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'milan-media';
    const mimeType = String(media.mimeType || record?.dataFormat || 'application/octet-stream').split(';')[0];
    const itemKey = 'media:' + recordId;
    const metadata = {
      kind: 'media-bytes', recordId, fileName, mimeType,
      sizeBytes: bytes.length, dataCid: 'sha256:' + digest,
      storageBackend: 'voroa-postgresql', spaceId
    };

    const recordPayload = record.binaryData
      ? Buffer.from(record.binaryData)
      : Buffer.from(
          typeof record.data === 'string'
            ? record.data
            : JSON.stringify(record.data ?? {}),
          'utf8'
        );
    const recordDataCid = `sha256:${crypto.createHash('sha256').update(recordPayload).digest('hex')}`;
    const recordMetadata = {
      title: record.title || '',
      tags: Array.isArray(record.tags) ? record.tags : [],
      accessMode: record.accessMode || 'private',
      sharedWithDids: Array.isArray(record.sharedWithDids) ? record.sharedWithDids : [],
      favorite: !!record.favorite,
      dwnRecordId: record.dwnRecordId || '',
      spaceId,
      interface: 'Records',
      method: 'Write',
      media: record?.data?.kind === 'media' && record?.data?.media
        ? {
            fileName: record.data.media.fileName || '',
            mimeType: record.data.media.mimeType || record.dataFormat || '',
            sizeBytes: Number(record.data.media.sizeBytes || 0),
            previewCategory: record.data.media.previewCategory || '',
            browserPlayable: typeof record.data.media.browserPlayable === 'boolean' ? record.data.media.browserPlayable : undefined,
            processing: !!record.data.media.processing,
            processingStatus: record.data.media.processingStatus || (record.data.media.processing ? 'processing' : 'ready'),
            compatibilityWarning: record.data.media.compatibilityWarning || record.mediaCompatibility?.warning || '',
            mediaUrl: record.data.media.mediaUrl || '/api/records/' + encodeURIComponent(recordId) + '/media'
          }
        : null
    };

    // Media bytes and their record metadata commit or roll back together.
    await withStorageQuotaTransaction(
      milanDb,
      {
        did,
        spaceId,
        writes: [
          { componentType: 'record_data', itemKey, newBytes: bytes.length },
          { componentType: 'record', itemKey: recordId, newBytes: recordPayload.length }
        ]
      },
      async client => {
        await client.query(
          `INSERT INTO public.dwn_storage
           (component_type,did,space_id,item_key,parent_key,schema_uri,data_format,
            recipient,published,deleted,metadata,data_bytes,data_cid,data_size,date_created,date_modified)
           VALUES ('record_data',$1,$2,$3,$4,'milan/media-bytes',$5,$1,FALSE,FALSE,
                   $6::jsonb,$7,$8,$9,NOW(),NOW())
           ON CONFLICT (did,space_id,component_type,item_key)
           DO UPDATE SET parent_key=EXCLUDED.parent_key,
             schema_uri=EXCLUDED.schema_uri,data_format=EXCLUDED.data_format,
             deleted=FALSE,metadata=EXCLUDED.metadata,data_bytes=EXCLUDED.data_bytes,
             data_cid=EXCLUDED.data_cid,data_size=EXCLUDED.data_size,
             date_modified=NOW(),updated_at=NOW()`,
          [did, spaceId, itemKey, recordId, mimeType, JSON.stringify(metadata),
           bytes, 'sha256:' + digest, bytes.length]
        );

        await client.query(
          `INSERT INTO public.dwn_storage
           (component_type, did, space_id, item_key, schema_uri, data_format,
            protocol, protocol_path, recipient, published, date_created, date_modified,
            deleted, metadata, data_bytes, data_cid, data_size)
           VALUES ('record',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (did, space_id, component_type, item_key)
           DO UPDATE SET
             schema_uri = EXCLUDED.schema_uri,
             data_format = EXCLUDED.data_format,
             protocol = EXCLUDED.protocol,
             protocol_path = EXCLUDED.protocol_path,
             recipient = EXCLUDED.recipient,
             published = EXCLUDED.published,
             date_modified = EXCLUDED.date_modified,
             deleted = EXCLUDED.deleted,
             metadata = EXCLUDED.metadata,
             data_bytes = EXCLUDED.data_bytes,
             data_cid = EXCLUDED.data_cid,
             data_size = EXCLUDED.data_size,
             updated_at = NOW()`,
          [
            did, spaceId, recordId, String(record.schema || ''),
            String(record.dataFormat || 'application/json'),
            String(record.protocol || ''), String(record.protocolPath || ''),
            String(record.recipient || did), !!record.published,
            record.dateCreated || pushedAt, record.dateModified || pushedAt,
            !!record.deleted, JSON.stringify(recordMetadata),
            recordPayload, recordDataCid, recordPayload.length
          ]
        );
      }
    );

    return {
      pushed: true, backend: 'voroa', mode: 'voroa-postgresql',
      spaceId, recordId, itemKey, dataCid: 'sha256:' + digest,
      dataSize: bytes.length, fileName, mimeType, pushedAt
    };
  } catch (error) {
    console.error('[Voroa media upload failed]', recordId, error.message);
    return { pushed: false, backend: 'voroa', recordId, error: error.message, status: Number(error.status) || 502, code: error.code || 'VOROA_MEDIA_WRITE_FAILED', pushedAt };
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
  const snapshotName = String(name || '').trim();
  const syncedAt = new Date().toISOString();

  if (!snapshotName) {
    return { ok: false, backend: 'voroa', error: 'Snapshot name is required', syncedAt };
  }

  try {
    const payload = data && typeof data === 'object' ? data : {};
    await milanDb.query(
      `INSERT INTO public.milan_database_snapshots (name, data, pushed_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (name) DO UPDATE
       SET data = EXCLUDED.data, pushed_at = EXCLUDED.pushed_at`,
      [snapshotName, JSON.stringify(payload)]
    );

    return {
      ok: true,
      backend: 'voroa',
      response: { name: snapshotName },
      syncedAt
    };
  } catch (err) {
    console.error('[Voroa DB snapshot sync failed]', snapshotName, err.message);
    return { ok: false, backend: 'voroa', error: err.message, syncedAt };
  }
}

async function pullDatabaseSnapshot(name) {
  const snapshotName = String(name || '').trim();

  if (!snapshotName) {
    return { ok: false, backend: 'voroa', error: 'Snapshot name is required', data: {} };
  }

  try {
    const result = await milanDb.query(
      'SELECT data, pushed_at FROM public.milan_database_snapshots WHERE name = $1 LIMIT 1',
      [snapshotName]
    );
    const row = result.rows[0];

    return {
      ok: true,
      backend: 'voroa',
      data: row?.data || {},
      missing: !row,
      pulledAt: row?.pushed_at || new Date().toISOString()
    };
  } catch (err) {
    console.error('[Voroa DB snapshot pull failed]', snapshotName, err.message);
    return { ok: false, backend: 'voroa', error: err.message, data: {} };
  }
}

async function realUserDwnNodeStatus(user) {
  const info = getDwnInfo(user);
  const checkedAt = new Date().toISOString();
  const did = String(user?.did || '').trim();

  if (!did || !info.spaceId) {
    return {
      ok: false,
      backend: 'voroa',
      mode: 'voroa-postgresql',
      storageReady: false,
      tenantConfigured: false,
      nodeReady: false,
      protocolReady: false,
      did,
      spaceId: info.spaceId || '',
      reason: !did ? 'no-did' : 'no-space-id',
      checkedAt
    };
  }

  try {
    const result = await milanDb.query(
      'SELECT did, space_id FROM public.users WHERE did = $1 LIMIT 1',
      [did]
    );
    const tenant = result.rows[0];

    if (result.rowCount !== 1 || !tenant?.space_id) {
      return {
        ok: false,
        backend: 'voroa',
        mode: 'voroa-postgresql',
        storageReady: false,
        tenantConfigured: false,
        nodeReady: false,
        protocolReady: false,
        did,
        spaceId: info.spaceId,
        reason: 'tenant-not-configured',
        checkedAt
      };
    }

    if (String(tenant.space_id) !== String(info.spaceId)) {
      return {
        ok: false,
        backend: 'voroa',
        mode: 'voroa-postgresql',
        storageReady: false,
        tenantConfigured: true,
        nodeReady: false,
        protocolReady: false,
        did,
        spaceId: info.spaceId,
        reason: 'space-mapping-mismatch',
        checkedAt
      };
    }

    return {
      ok: false,
      backend: 'voroa',
      mode: 'voroa-postgresql',
      storageReady: true,
      tenantConfigured: true,
      nodeReady: false,
      protocolReady: false,
      did,
      spaceId: tenant.space_id,
      endpoint: info.endpoint || '',
      reason: 'real-dwn-protocol-not-integrated',
      message: 'Voroa PostgreSQL DID/space mapping verified. Signed DWN protocol execution is not integrated.',
      checkedAt
    };
  } catch (err) {
    return {
      ok: false,
      backend: 'voroa',
      mode: 'voroa-postgresql',
      storageReady: false,
      tenantConfigured: false,
      nodeReady: false,
      protocolReady: false,
      did,
      spaceId: info.spaceId,
      reason: 'voroa-status-check-failed',
      error: err.message,
      checkedAt
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
