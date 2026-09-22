const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { readJson, writeJson, findUserByDid } = require('../utils/store');
const { BROWSER_SAFE_MEDIA, detectMimeFromFile, extForMime, categoryForMime, normalizeUploadedMedia } = require('../utils/mediaCompat');
const { getDwnInfo, pushRecordToCloudDwn, deleteRecordFromCloudDwn, pushMediaToCloudDwn, storageRootFor, dwnRoot, databaseRoot, isolatedRoot, persistenceInfo, cloudRemoteBase, isEmbeddedSelfEndpoint } = require('./cloudDwnRegistry');

const ACCESS = ['private', 'public', 'shared_did'];
const MAX_TEXT_BYTES = Number(process.env.MAX_RECORD_TEXT_BYTES || 10 * 1024 * 1024);
const MAX_MEDIA_BYTES = Number(process.env.MAX_MEDIA_BYTES || 5000 * 1024 * 1024);
const MAX_MEDIA_MB = Math.round(MAX_MEDIA_BYTES / 1024 / 1024);
// V49 accepts every file type. BROWSER_SAFE_MEDIA is used only to decide inline preview, not to block uploads.
const INLINE_PREVIEW_MIME = BROWSER_SAFE_MEDIA;
const DWN_DIR = dwnRoot();
const DATABASE_DIR = databaseRoot();
const INDEX_FILE = path.join(DATABASE_DIR, 'APP_RECORD_INDEX.json');
const RECORDS_DIR = path.join(DWN_DIR, 'records'); // legacy shared cache only
const AUDIT_DIR = path.join(DWN_DIR, 'audit');
const MEDIA_DIR = path.join(DWN_DIR, 'media'); // legacy media cache only
const ISOLATED_USERS_DIR = isolatedRoot();

function isRemoteOnlyMode() { return false; }

let dwnInstance = null;
const mediaProcessingQueue = new Set();
const mediaRepairLocks = new Map();
const MILAN_SYNC_VIDEO_PROCESS_BYTES = Number(process.env.MILAN_SYNC_VIDEO_PROCESS_BYTES || 150 * 1024 * 1024);
const MILAN_PROCESSING_STALE_MS = Number(process.env.MILAN_PROCESSING_STALE_MS || 20 * 1000);
// V55 hard-core anti-stuck rule: processing must never stay forever.
// Small WhatsApp/reel videos should either become playable quickly or show a clear repair/download state.
const MILAN_PROCESSING_HARD_TIMEOUT_MS = Number(process.env.MILAN_PROCESSING_HARD_TIMEOUT_MS || 3 * 60 * 1000);
const MILAN_PROCESSING_SMALL_TIMEOUT_MS = Number(process.env.MILAN_PROCESSING_SMALL_TIMEOUT_MS || 90 * 1000);
const MILAN_PROCESSING_MEDIUM_TIMEOUT_MS = Number(process.env.MILAN_PROCESSING_MEDIUM_TIMEOUT_MS || 4 * 60 * 1000);

let dwnInitStatus = {
  ok: false,
  sdkReady: true,
  storageOperational: false,
  mode: 'not-started',
  error: null,
  startedAt: null
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureJson(file, fallback = {}) {
  ensureDir(path.dirname(file));
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
}

function readJsonFile(file, fallback = {}) {
  try {
    ensureJson(file, fallback);
    const raw = fs.readFileSync(file, 'utf8').trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error('DWN JSON read failed:', file, err.message);
    return fallback;
  }
}

function writeJsonFile(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readIndex() {
  return readJsonFile(INDEX_FILE, {});
}

function writeIndex(data) {
  // APP_RECORD_INDEX is part of authoritative DWN database snapshots.
  // This lets the app rebuild the feed after restart.
  writeJson(INDEX_FILE, data);
}


function userByDid(did) {
  try {
    const found = findUserByDid(readJson(global.usersFile, {}), did);
    return found?.user || null;
  } catch (_) {
    return null;
  }
}

function dwnInfoForDid(did) {
  return getDwnInfo(userByDid(did));
}

async function markCloudSync(record, ownerDid) {
  const user = userByDid(ownerDid);
  const dwn = getDwnInfo(user);
  record.dwnEndpoint = dwn.endpoint;
  record.dwnMode = dwn.mode;
  record.realCloudDwnConfigured = dwn.realCloudConfigured;
  record.didServiceId = dwn.didServiceId || '#dwn';
  record.cloudDwn = { endpoint: dwn.endpoint, mode: dwn.mode, realCloudConfigured: dwn.realCloudConfigured, didServiceId: dwn.didServiceId || '#dwn', isolation: dwn.isolation, spaceId: dwn.spaceId };
  record.dwnIsolation = dwn.isolation;
  record.dwnSpaceId = dwn.spaceId;
  const pushed = await pushRecordToCloudDwn(record, user);
  record.cloudDwn.sync = pushed;
  record.cloudDwn.updatedAt = new Date().toISOString();
  return record;
}

function safeName(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function userIsolatedRoot(userId) {
  const user = (() => {
    try {
      const users = readJson(global.usersFile, {});
      return Object.values(users).find(u => u && u.id === userId) || null;
    } catch (_) { return null; }
  })();
  const info = getDwnInfo(user);
  return info.spaceId ? storageRootFor(info.spaceId) : path.join(ISOLATED_USERS_DIR, safeName(userId));
}

function recordFile(userId, recordId) {
  return path.join(userIsolatedRoot(userId), 'records', `${safeName(recordId)}.json`);
}

function audit(action, details = {}) {
  try {
    ensureDir(AUDIT_DIR);
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(AUDIT_DIR, `${day}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), action, ...details }) + '\n');
  } catch (err) {
    console.error('DWN audit write failed:', err.message);
  }
}

function mediaExtFromMime(mime = '') {
  return extForMime(String(mime).toLowerCase(), '');
}

function absoluteBackendPath(relativePath = '') {
  const base = path.resolve(__dirname, '..');
  const dwnBase = path.resolve(DWN_DIR);
  const input = String(relativePath || '');
  const full = path.isAbsolute(input) ? path.resolve(input) : path.resolve(base, input);
  // Allow normal app-relative paths and V23 persistent DWN paths.
  if (!full.startsWith(base) && !full.startsWith(dwnBase)) return null;
  return full;
}

function removeHeavyMediaPayload(record) {
  const data = record?.data;
  if (!data || typeof data !== 'object') return record;
  if (data.media && typeof data.media === 'object') {
    if (data.media.dataUrl) delete data.media.dataUrl;
    data.media.stored = !!record.mediaStoragePath;
  }
  if (data.dataUrl) delete data.dataUrl;
  data.stored = !!record.mediaStoragePath;
  return record;
}

function compactMediaForList(record) {
  const clone = JSON.parse(JSON.stringify(record));
  const data = clone.data;
  const hasMedia = data && typeof data === 'object' && (data.kind === 'media' || data.media || data.dataUrl || data.mediaUrl || clone.mediaStoragePath || clone.mediaRemoteOnly || clone.mediaRemoteUrl);
  if (hasMedia) {
    removeHeavyMediaPayload(clone);
    const media = data.media || data || {};
    const mime = media.mimeType || clone.dataFormat || '';
    const name = media.fileName || 'vault-media';
    const size = media.sizeBytes || 0;
    const caption = data.caption || media.caption || '';
    const stored = !!(clone.mediaStoragePath || clone.mediaRemoteOnly || clone.mediaRemoteUrl);
    const previewCategory = media.previewCategory || clone.mediaCompatibility?.previewCategory || categoryForMime(mime, name);
    const browserPlayable = typeof media.browserPlayable === 'boolean' ? media.browserPlayable : (typeof clone.mediaCompatibility?.browserPlayable === 'boolean' ? clone.mediaCompatibility.browserPlayable : undefined);
    clone.mediaUrl = `/api/records/${encodeURIComponent(clone.id)}/media`;
    const processing = !!(media.processing || clone.mediaCompatibility?.processing);
    const processingStatus = media.processingStatus || clone.mediaCompatibility?.processingStatus || (processing ? 'processing' : (previewCategory === 'video' && browserPlayable === false ? 'preview-unavailable' : 'ready'));
    clone.data = { kind: 'media', caption, media: { fileName: name, mimeType: mime, sizeBytes: size, stored, remoteOnly: !!clone.mediaRemoteOnly, mediaUrl: clone.mediaUrl, downloadUrl: `${clone.mediaUrl}?download=1`, previewCategory, browserPlayable, browserSafe: browserPlayable === true, processing, processingStatus, compatibilityWarning: media.compatibilityWarning || clone.mediaCompatibility?.warning || '' } };
  }
  return clone;
}

function extractDataUrl(record) {
  const data = record?.data;
  if (!data || typeof data !== 'object') return null;
  const dataUrl = data.media?.dataUrl || data.dataUrl;
  const mimeType = data.media?.mimeType || data.mimeType || record.dataFormat;
  const fileName = data.media?.fileName || data.fileName || 'vault-media';
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: mimeType || match[1], base64: match[2], fileName };
}

function persistMediaFile(userId, record) {
  const media = extractDataUrl(record);
  if (!media) return;
  // V49: do not block unknown file types. Store them as downloadable files.
  const approxBytes = Buffer.byteLength(media.base64, 'base64');
  if (approxBytes > MAX_MEDIA_BYTES) {
    record.mediaPersistError = `Media exceeds the configured DWN upload limit of ${MAX_MEDIA_MB} MB`;
    return;
  }
  try {
    const ext = mediaExtFromMime(media.mimeType) || path.extname(media.fileName) || '.bin';
    // Phase 1 requirement: user media must live inside that user's isolated DWN space,
    // not in a shared media folder.
    const dir = path.join(userIsolatedRoot(userId), 'media');
    ensureDir(dir);
    const file = path.join(dir, `${safeName(record.id)}${ext}`);
    fs.writeFileSync(file, Buffer.from(media.base64, 'base64'));
    record.mediaStoragePath = path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/');
    record.mediaStoredAt = new Date().toISOString();
    audit('dwn.media.persisted', { userId, recordId: record.id, mimeType: media.mimeType, mediaStoragePath: record.mediaStoragePath });
  } catch (err) {
    console.error('DWN media persist failed:', err.message);
    record.mediaPersistError = err.message;
  }
}

function persistRecord(userId, record) {
  persistMediaFile(userId, record);
  // Keep the large video/photo bytes on disk, not inside APP_RECORD_INDEX.json.
  // This makes login and mobile loading much faster, especially after many uploads.
  if (record.mediaStoragePath) removeHeavyMediaPayload(record);
  writeJsonFile(recordFile(userId, record.id), record);
  audit('dwn.record.persisted', { userId, recordId: record.id, accessMode: record.accessMode, dataFormat: record.dataFormat, mediaStoragePath: record.mediaStoragePath || null });
}

function removeRecordFile(userId, recordId) {
  const file = recordFile(userId, recordId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const mediaUserDir = path.join(userIsolatedRoot(userId), 'media');
  if (fs.existsSync(mediaUserDir)) {
    for (const item of fs.readdirSync(mediaUserDir)) {
      if (item.startsWith(safeName(recordId) + '.')) fs.unlinkSync(path.join(mediaUserDir, item));
    }
  }
  audit('dwn.record.deleted', { userId, recordId });
}

function cleanDids(value) {
  const rows = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(rows.map(x => String(x).trim()).filter(x => x.startsWith('did:')))];
}

function normalizeAccess(input = {}, existing = null) {
  let mode = String(input.accessMode || input.visibility || input.mode || existing?.accessMode || 'private').toLowerCase();
  if (mode === 'shared' || mode === 'did') mode = 'shared_did';
  if (!ACCESS.includes(mode)) return { error: 'accessMode must be private, public or shared_did' };
  const dids = mode === 'shared_did' ? cleanDids(input.sharedWithDids || input.sharedWith || existing?.sharedWithDids || []) : [];
  if (mode === 'shared_did' && !dids.length) return { error: 'At least one DID required for shared_did records' };
  return { mode, dids };
}

function applyAccess(record, mode, dids) {
  record.accessMode = mode;
  record.isPublic = mode === 'public';
  record.sharedWithDids = mode === 'shared_did' ? cleanDids(dids) : [];
  record.access = {
    mode,
    readers: record.sharedWithDids,
    updatedAt: new Date().toISOString(),
    storage: 'isolated-dwn-per-user'
  };
}

function modeOf(record) {
  if (ACCESS.includes(record.accessMode)) return record.accessMode;
  if (record.isPublic) return 'public';
  if ((record.sharedWithDids || []).length) return 'shared_did';
  return 'private';
}

function canRead(record, did) {
  const mode = modeOf(record);
  return record.owner === did || record.recipient === did || mode === 'public' || (mode === 'shared_did' && (record.sharedWithDids || []).includes(did));
}

function toClient(record, did, options = {}) {
  const baseRecord = options.summary ? compactMediaForList(record) : compactMediaForList(record);
  const mode = modeOf(baseRecord);
  return {
    ...baseRecord,
    accessMode: mode,
    isPublic: mode === 'public',
    sharedWithDids: mode === 'shared_did' ? (record.sharedWithDids || []) : [],
    canEdit: baseRecord.owner === did,
    canDelete: baseRecord.owner === did,
    canManageAccess: baseRecord.owner === did,
    storage: 'DWN',
    storageProof: {
      engine: 'supabase',
      sdkReady: dwnInitStatus.sdkReady,
      dwnEndpoint: baseRecord.dwnEndpoint || dwnInfoForDid(baseRecord.owner).endpoint,
      dwnMode: baseRecord.dwnMode || dwnInfoForDid(baseRecord.owner).mode,
      realCloudDwnConfigured: dwnInfoForDid(baseRecord.owner).realCloudConfigured,
      isolation: baseRecord.dwnIsolation || dwnInfoForDid(baseRecord.owner).isolation,
      spaceId: baseRecord.dwnSpaceId || dwnInfoForDid(baseRecord.owner).spaceId,
      dwnRecordId: baseRecord.dwnRecordId,
      storedAt: baseRecord.storagePath || null,
      mediaStoredAt: baseRecord.mediaStoragePath || baseRecord.mediaRemoteUrl || null,
      remoteOnly: !!baseRecord.realDwnNodeRemoteOnly || !!baseRecord.mediaRemoteOnly
    }
  };
}

function allRecordsRaw() {
  return Object.values(readIndex()).flatMap(v => Array.isArray(v) ? v : []);
}

function ownerRecordsRaw(userId) {
  const all = readIndex();
  if (!Array.isArray(all[userId])) all[userId] = [];
  return { all, list: all[userId] };
}

function findRecordRaw(id) {
  const all = readIndex();
  for (const [userId, list] of Object.entries(all)) {
    const record = (Array.isArray(list) ? list : []).find(x => x.id === id);
    if (record) return { all, userId, list, record };
  }
  return null;
}

function sanitizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : []).map(x => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
}

function validatePayload(body = {}) {
  const text = body.data === undefined ? '' : (typeof body.data === 'object' ? JSON.stringify(body.data) : String(body.data));
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES && !extractDataUrl(body)) {
    const err = new Error('Record is too large for a text/JSON record. Use media upload for large files.');
    err.status = 413;
    throw err;
  }
  const media = extractDataUrl(body);
  if (media) {
    if (false) {
      const err = new Error('Only supported image/video media types are allowed.');
      err.status = 400;
      throw err;
    }
    const approxBytes = Buffer.byteLength(media.base64, 'base64');
    if (approxBytes > MAX_MEDIA_BYTES) {
      const err = new Error(`Media exceeds the configured DWN upload limit of ${MAX_MEDIA_MB} MB.`);
      err.status = 413;
      throw err;
    }
  }
}

function filterSort(rows, query = {}) {
  const q = String(query.q || '').toLowerCase();
  const type = String(query.type || '');
  const tag = String(query.tag || '').toLowerCase();
  const access = String(query.access || '');
  let out = rows;
  if (type) out = out.filter(r => type.endsWith('/') ? String(r.dataFormat || '').startsWith(type) : r.dataFormat === type);
  if (access) out = out.filter(r => r.accessMode === access);
  if (tag) out = out.filter(r => (r.tags || []).map(t => String(t).toLowerCase()).includes(tag));
  if (q) out = out.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  out = out.sort((a, b) => new Date(b.dateModified || b.dateCreated) - new Date(a.dateModified || a.dateCreated));
  const limit = Math.max(0, Math.min(100, Number(query.limit || 0) || 0));
  return limit ? out.slice(0, limit) : out;
}


function compactExistingIndex() {
  try {
    const all = readIndex();
    let changed = false;
    for (const list of Object.values(all)) {
      if (!Array.isArray(list)) continue;
      for (const record of list) {
        if (record.mediaStoragePath && JSON.stringify(record.data || {}).includes('data:')) {
          removeHeavyMediaPayload(record);
          changed = true;
        }
      }
    }
    if (changed) writeIndex(all);
  } catch (err) {
    console.error('DWN index compaction skipped:', err.message);
  }
}

function repairIndexFromRecordFiles() {
  try {
    const all = readIndex();
    let changed = false;
    for (const [userId, list] of Object.entries(all)) {
      if (!Array.isArray(list)) continue;
      for (let i = 0; i < list.length; i += 1) {
        const record = list[i];
        if (!record || !record.id) continue;
        const file = recordFile(userId, record.id);
        if (!fs.existsSync(file)) continue;
        const diskRecord = readJsonFile(file, null);
        if (!diskRecord || typeof diskRecord !== 'object') continue;
        if (diskRecord.mediaStoragePath && !record.mediaStoragePath) changed = true;
        if (diskRecord.mediaStoragePath || diskRecord.storagePath) {
          list[i] = { ...record, ...diskRecord };
          removeHeavyMediaPayload(list[i]);
        }
      }
    }
    if (changed) {
      writeIndex(all);
      audit('dwn.index.repaired.from.record.files', { repaired: true });
    }
  } catch (err) {
    console.error('DWN index repair skipped:', err.message);
  }
}

async function initDwn() {
  ensureDir(DWN_DIR);
  ensureDir(DATABASE_DIR);
  ensureDir(RECORDS_DIR);
  ensureDir(AUDIT_DIR);
  ['DATASTORE', 'MESSAGESTORE', 'EVENTLOG', 'INDEX', 'RESOLVERCACHE'].forEach(name => ensureDir(path.join(DWN_DIR, name)));
  ensureDir(MEDIA_DIR);
  ensureDir(ISOLATED_USERS_DIR);
  ensureJson(INDEX_FILE, {});
  compactExistingIndex();
  repairIndexFromRecordFiles();

  // V49 production DWN: users are assigned a remote production DWN node space.
  dwnInstance = {
    type: 'production-dwn-node-remote-only-cache',
    directory: DWN_DIR,
    startedAt: new Date().toISOString()
  };
  dwnInitStatus = {
    ok: true,
    sdkReady: true,
    storageOperational: !persistenceInfo().setupRequired,
    mode: persistenceInfo().mode,
    error: null,
    startedAt: new Date().toISOString()
  };

  audit('dwn.service.started', dwnInitStatus);
  return dwnInitStatus;
}

function getStatus() {
  return {
    ...dwnInitStatus,
    dwnDirectory: DWN_DIR,
    databaseDirectory: DATABASE_DIR,
    indexFile: INDEX_FILE,
    recordsDirectory: RECORDS_DIR,
    auditDirectory: AUDIT_DIR,
    mediaDirectory: MEDIA_DIR,
    isolatedUsersDirectory: ISOLATED_USERS_DIR,
    hasDwnInstance: !!dwnInstance,
    limits: {
      maxMediaBytes: MAX_MEDIA_BYTES,
      maxMediaMB: MAX_MEDIA_MB,
      maxTextBytes: MAX_TEXT_BYTES
    },
    cloud: persistenceInfo(),
    note: 'MILAN Supabase mode. Supabase is authoritative for user snapshots, records, and media; local files are compatibility/cache storage.'
  };
}

async function createRecord(userId, ownerDid, body = {}) {
  validatePayload(body);
  const data = body.data;
  if (data === undefined || data === null || String(typeof data === 'object' ? JSON.stringify(data) : data).trim() === '') {
    const err = new Error('Record content required');
    err.status = 400;
    throw err;
  }
  const access = normalizeAccess(body);
  if (access.error) {
    const err = new Error(access.error);
    err.status = 400;
    throw err;
  }
  const { all, list } = ownerRecordsRaw(userId);
  const now = new Date().toISOString();
  const id = uuidv4();
  const record = {
    id,
    dwnRecordId: uuidv4(),
    owner: ownerDid,
    recipient: ownerDid,
    schema: body.schema || 'web5-vault-record',
    title: String(body.title || 'Untitled record').trim().slice(0, 140),
    dataFormat: body.dataFormat || 'text/plain',
    data,
    tags: sanitizeTags(body.tags),
    favorite: !!body.favorite,
    dateCreated: now,
    dateModified: now,
    storageEngine: 'Real remote DWN node storage',
    dwnSdkReady: dwnInitStatus.sdkReady,
    storagePath: path.relative(path.join(__dirname, '..'), recordFile(userId, id)).replace(/\\/g, '/')
  };
  applyAccess(record, access.mode, access.dids);

  /* ---------------------------------------------------------
     Publish must not be blocked by remote DWN sync latency.
     Persist the record first, then sync to the authoritative
     cloud/DWN store asynchronously.
     --------------------------------------------------------- */

  record.cloudDwn = record.cloudDwn || {};
  record.cloudDwn.sync = {
    ok: false,
    status: 'pending',
    queuedAt: new Date().toISOString()
  };

  list.unshift(record);
  persistRecord(userId, record);
  all[userId] = list;
  writeIndex(all);

  markCloudSync(record, ownerDid)
    .then(() => {
      record.cloudDwn = record.cloudDwn || {};
      record.cloudDwn.sync = {
        ok: true,
        status: 'synced',
        syncedAt: new Date().toISOString()
      };

      try {
        persistRecord(userId, record);
        const latest = ownerRecordsRaw(userId);
        latest.all[userId] = latest.list;
        writeIndex(latest.all);
      } catch (persistErr) {
        console.error(
          'Post cloud-sync status persist failed:',
          persistErr.message
        );
      }
    })
    .catch(err => {
      record.cloudDwn = record.cloudDwn || {};
      record.cloudDwn.sync = {
        ok: false,
        status: 'failed',
        failedAt: new Date().toISOString(),
        error: String(err?.message || err || 'DWN sync failed').slice(0, 500)
      };

      try {
        persistRecord(userId, record);
        const latest = ownerRecordsRaw(userId);
        latest.all[userId] = latest.list;
        writeIndex(latest.all);
      } catch (persistErr) {
        console.error(
          'Post cloud-sync failure status persist failed:',
          persistErr.message
        );
      }

      console.error(
        'Background DWN sync failed for record',
        record.id,
        err
      );
    });

  return toClient(record, ownerDid);
}


function mediaJobKey(userId, recordId) {
  return `${userId}:${recordId}`;
}

function isMediaProcessingActive(userId, recordId) {
  const key = mediaJobKey(userId, recordId);
  return mediaProcessingQueue.has(key) || mediaRepairLocks.has(key);
}

function mediaProcessingAgeMs(record) {
  const media = record?.data?.media || {};
  const compat = record?.mediaCompatibility || {};
  const stamp = media.processingUpdatedAt || compat.processingUpdatedAt || media.processingStartedAt || compat.processingStartedAt || record?.dateModified || record?.dateCreated || '';
  const t = Date.parse(stamp);
  return Number.isFinite(t) ? Math.max(0, Date.now() - t) : Infinity;
}

function mediaProcessingTimeoutMs(record) {
  const media = record?.data?.media || {};
  const size = Number(media.sizeBytes || record?.mediaCompatibility?.sizeBytes || 0);
  if (size > 0 && size <= 25 * 1024 * 1024) return MILAN_PROCESSING_SMALL_TIMEOUT_MS;
  if (size > 0 && size <= 150 * 1024 * 1024) return MILAN_PROCESSING_MEDIUM_TIMEOUT_MS;
  return MILAN_PROCESSING_HARD_TIMEOUT_MS;
}

function persistFoundRecord(found) {
  persistRecord(found.userId, found.record);
  found.all[found.userId] = found.list;
  writeIndex(found.all);
}

function setRecordMediaProcessing(found, { processing, status, warning, browserPlayable, extraCompatibility = {} } = {}) {
  const now = new Date().toISOString();
  found.record.data = found.record.data || { kind: 'media', caption: '' };
  found.record.data.kind = 'media';
  found.record.data.media = found.record.data.media || {};
  if (typeof processing === 'boolean') found.record.data.media.processing = processing;
  if (status) found.record.data.media.processingStatus = status;
  if (warning !== undefined) found.record.data.media.compatibilityWarning = warning || undefined;
  if (typeof browserPlayable === 'boolean') {
    found.record.data.media.browserPlayable = browserPlayable;
    found.record.data.media.browserSafe = browserPlayable;
  }
  if (processing) {
    found.record.data.media.processingStartedAt = found.record.data.media.processingStartedAt || now;
    found.record.data.media.processingUpdatedAt = now;
  } else {
    found.record.data.media.processingUpdatedAt = now;
  }
  found.record.mediaCompatibility = { ...(found.record.mediaCompatibility || {}), ...extraCompatibility };
  if (typeof processing === 'boolean') found.record.mediaCompatibility.processing = processing;
  if (status) found.record.mediaCompatibility.processingStatus = status;
  if (warning !== undefined) found.record.mediaCompatibility.warning = warning || '';
  if (typeof browserPlayable === 'boolean') {
    found.record.mediaCompatibility.browserPlayable = browserPlayable;
    found.record.mediaCompatibility.browserSafe = browserPlayable;
  }
  if (processing) {
    found.record.mediaCompatibility.processingStartedAt = found.record.mediaCompatibility.processingStartedAt || now;
    found.record.mediaCompatibility.processingUpdatedAt = now;
  } else {
    found.record.mediaCompatibility.processingUpdatedAt = now;
  }
  found.record.dateModified = now;
}

function markMediaProcessingFailure(userId, recordId, message) {
  const found = findRecordRaw(recordId);
  if (!found) return null;
  const warning = String(message || 'Video preview processing failed. Original file is saved; Download is available.').slice(0, 500);
  setRecordMediaProcessing(found, {
    processing: false,
    status: 'preview-unavailable',
    warning,
    browserPlayable: false,
    extraCompatibility: { failedAt: new Date().toISOString() }
  });
  persistFoundRecord(found);
  audit('dwn.media.processing.marked.failed', { userId, recordId, warning });
  return found.record;
}

function scheduleMediaBackgroundProcessing(userId, ownerDid, recordId, reason = 'background') {
  const key = mediaJobKey(userId, recordId);
  if (mediaProcessingQueue.has(key) || mediaRepairLocks.has(key)) return false;
  const found = findRecordRaw(recordId);
  if (found) {
    setRecordMediaProcessing(found, { processing: true, status: 'processing', warning: 'Video uploaded safely. Browser-safe MP4 preview is preparing in background.' });
    persistFoundRecord(found);
  }
  mediaProcessingQueue.add(key);
  setTimeout(async () => {
    try {
      audit('dwn.media.background.processing.started', { userId, recordId, reason });
      const result = await repairMediaForBrowser(userId, ownerDid, recordId);
      const repaired = !!(result && result.repaired);
      audit('dwn.media.background.processing.finished', { userId, recordId, repaired, warning: result?.warning || '' });
    } catch (err) {
      const msg = err && err.message ? err.message : 'Unknown video processing error';
      markMediaProcessingFailure(userId, recordId, `Video preview processing failed: ${msg}. Original file is saved; Download is available.`);
      audit('dwn.media.background.processing.failed', { userId, recordId, error: msg });
    } finally {
      mediaProcessingQueue.delete(key);
    }
  }, Number(process.env.MILAN_BACKGROUND_PROCESS_DELAY_MS || 1500));
  return true;
}


async function createMediaRecordFromFile(userId, ownerDid, meta = {}, tempPath) {
  if (!tempPath || !fs.existsSync(tempPath)) {
    const err = new Error('Uploaded file was not received.');
    err.status = 400;
    throw err;
  }
  const inputSizeBytes = fs.statSync(tempPath).size;
  let originalName = String(meta.fileName || 'milan-file').replace(/[\\/\r\n]/g, '_').slice(0, 180) || 'milan-file';
  let mimeType = String(meta.mimeType || 'application/octet-stream').split(';')[0].toLowerCase() || 'application/octet-stream';
  const detected = detectMimeFromFile(tempPath, originalName);
  if ((!mimeType || mimeType === 'application/octet-stream' || mimeType === 'binary/octet-stream') && detected.mimeType) mimeType = detected.mimeType;
  // iPhone/WhatsApp often sends .mov/.mp4 as video/quicktime even when the actual file is MP4.
  // Serving that as QuickTime makes mobile browsers show 0:00 or refuse preview.
  if (mimeType === 'video/quicktime' && detected.mimeType === 'video/mp4') mimeType = 'video/mp4';
  if (mimeType === 'audio/mp3') mimeType = 'audio/mpeg';
  if (inputSizeBytes > MAX_MEDIA_BYTES) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    const err = new Error(`File exceeds the configured DWN upload limit of ${MAX_MEDIA_MB} MB.`);
    err.status = 413;
    throw err;
  }
  const access = normalizeAccess(meta);
  if (access.error) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    const err = new Error(access.error);
    err.status = 400;
    throw err;
  }

  const { all, list } = ownerRecordsRaw(userId);
  const now = new Date().toISOString();
  const id = uuidv4();
  let ext = mediaExtFromMime(mimeType) || path.extname(originalName) || '.bin';
  const mediaUserDir = path.join(userIsolatedRoot(userId), 'media');
  ensureDir(mediaUserDir);
  let mediaFile = path.join(mediaUserDir, `${safeName(id)}${ext}`);
  try {
    fs.renameSync(tempPath, mediaFile);
  } catch (err) {
    if (err && err.code === 'EXDEV') {
      fs.copyFileSync(tempPath, mediaFile);
      fs.unlinkSync(tempPath);
    } else {
      throw err;
    }
  }

  const detectedCategory = categoryForMime(mimeType, originalName);
  const deferVideoProcessing = String(process.env.MILAN_DEFER_VIDEO_PROCESSING || 'true').toLowerCase() !== 'false';
  // V53: small/normal mobile videos are converted/remuxed immediately before the post appears.
  // Only large videos are accepted first and processed in background. This removes the common
  // "uploaded but 0:00 / still preparing" problem shown on mobile.
  const fastAcceptVideo = detectedCategory === 'video' && deferVideoProcessing && inputSizeBytes > MILAN_SYNC_VIDEO_PROCESS_BYTES;
  let compatibility = fastAcceptVideo ? {
    filePath: mediaFile,
    mimeType,
    originalName,
    detected,
    previewCategory: detectedCategory,
    changed: false,
    remuxed: false,
    transcoded: false,
    ffmpegUsed: false,
    browserPlayable: false,
    warning: 'Video uploaded safely. Direct playback is available while browser-safe MP4 preview is prepared in background.',
    compatibility: { safe: false, reason: 'deferred-background-processing' }
  } : await normalizeUploadedMedia({ filePath: mediaFile, mimeType, originalName, force: false });
  if (compatibility.changed && compatibility.filePath && fs.existsSync(compatibility.filePath)) {
    try { if (compatibility.filePath !== mediaFile && fs.existsSync(mediaFile)) fs.unlinkSync(mediaFile); } catch (_) {}
    mediaFile = compatibility.filePath;
    mimeType = compatibility.mimeType || 'video/mp4';
    originalName = compatibility.originalName || originalName.replace(/\.[^.]*$/, '') + '.mp4';
    ext = mediaExtFromMime(mimeType) || path.extname(originalName) || '.mp4';
    const finalPath = path.join(mediaUserDir, `${safeName(id)}${ext}`);
    if (finalPath !== mediaFile) {
      try { fs.renameSync(mediaFile, finalPath); mediaFile = finalPath; } catch (_) {}
    }
  } else if (compatibility.mimeType && compatibility.mimeType !== mimeType) {
    mimeType = compatibility.mimeType;
  }

  const previewCategory = compatibility.previewCategory || detectedCategory || categoryForMime(mimeType, originalName);
  // V49: never mark a video playable only because its container says MP4.
  // Many mobile/iPhone/WhatsApp MP4 files contain HEVC or unsupported audio; those create
  // the black 0:00 player. A video is marked browser-playable only after a successful
  // ffmpeg faststart/remux/transcode or a positive compatibility check.
  // V50: treat mp4/webm containers as playable by default even without full transcode proof.
  // This makes common phone videos (WhatsApp, camera MP4s) play instantly without a repair call.
  // Non-playable formats (HEVC, MKV) will still trigger repair via onerror on the client.
  // Facebook-style rule: after upload, do not promise that every MP4/MOV is playable.
  // Many phones save HEVC/H.265 video inside an .mp4/.mov container, which normal browsers cannot decode.
  // Mark videos playable only after ffmpeg remux/transcode has produced a browser-safe H.264/AAC MP4.
  const browserPlayable = previewCategory === 'video'
    ? (fastAcceptVideo ? false : compatibility.browserPlayable === true)
    : (previewCategory === 'image' || previewCategory === 'audio' || previewCategory === 'pdf' || previewCategory === 'text');
  const initialProcessingStatus = fastAcceptVideo ? 'processing' : (previewCategory === 'video' && !browserPlayable ? 'preview-unavailable' : 'ready');
  const sizeBytes = fs.statSync(mediaFile).size;
  const relMedia = path.relative(path.join(__dirname, '..'), mediaFile).replace(/\\/g, '/');
  const record = {
    id,
    dwnRecordId: uuidv4(),
    owner: ownerDid,
    recipient: ownerDid,
    schema: meta.schema || 'web5-vault-record',
    title: String(meta.title || originalName || 'Untitled file').trim().slice(0, 140),
    dataFormat: mimeType,
    data: {
      kind: 'media',
      caption: String(meta.caption || '').slice(0, 10000),
      media: {
        fileName: originalName,
        mimeType,
        originalMimeType: String(meta.mimeType || '').split(';')[0].toLowerCase() || detected.mimeType || '',
        sizeBytes,
        stored: true,
        previewCategory,
        browserPlayable,
        browserSafe: browserPlayable,
        compatibilityWarning: compatibility.warning || undefined,
        processing: !!fastAcceptVideo,
        processingStatus: initialProcessingStatus,
        processingStartedAt: fastAcceptVideo ? now : undefined,
        processingUpdatedAt: fastAcceptVideo ? now : undefined,
        uploadMode: meta.uploadMode || (fastAcceptVideo ? 'fast-accept-background-processing' : 'streaming'),
        mediaUrl: `/api/records/${encodeURIComponent(id)}/media`,
        downloadUrl: `/api/records/${encodeURIComponent(id)}/media?download=1`
      }
    },
    tags: sanitizeTags(meta.tags),
    favorite: !!meta.favorite,
    dateCreated: now,
    dateModified: now,
    mediaStoragePath: relMedia,
    mediaStoredAt: now,
    mediaCompatibility: {
      detectedMimeType: detected.mimeType || '',
      detectedFrom: detected.source || '',
      previewCategory,
      browserSafe: browserPlayable,
      browserPlayable,
      transcoded: !!compatibility.transcoded,
      remuxed: !!compatibility.remuxed,
      ffmpegUsed: !!compatibility.ffmpegUsed,
      warning: compatibility.warning || '',
      probe: compatibility.compatibility || null,
      processing: !!fastAcceptVideo,
      processingStatus: initialProcessingStatus,
      processingStartedAt: fastAcceptVideo ? now : undefined,
      processingUpdatedAt: fastAcceptVideo ? now : undefined,
      uploadMode: meta.uploadMode || ''
    },
    storageEngine: 'Real remote DWN node storage',
    dwnSdkReady: dwnInitStatus.sdkReady,
    storagePath: path.relative(path.join(__dirname, '..'), recordFile(userId, id)).replace(/\\/g, '/')
  };
  applyAccess(record, access.mode, access.dids);
  await markCloudSync(record, ownerDid);
  list.unshift(record);
  persistRecord(userId, record);
  const ownerUser = userByDid(ownerDid);
  const mediaSync = await pushMediaToCloudDwn(record, ownerUser, mediaFile);
  record.cloudDwn = record.cloudDwn || {};
  record.cloudDwn.mediaSync = mediaSync;
  if (isRemoteOnlyMode() && !mediaSync.pushed) {
    try { removeRecordFile(userId, record.id); } catch (_) {}
    try { if (fs.existsSync(mediaFile)) fs.unlinkSync(mediaFile); } catch (_) {}
    const err = new Error(`Real DWN node media upload failed: ${mediaSync.error || 'unknown error'}`);
    err.status = 502;
    throw err;
  }
  const embeddedMediaMode = !!(mediaSync && (mediaSync.skipped === 'embedded-self-dwn-media-already-in-isolated-space' || mediaSync.mode === 'embedded-production-dwn-direct'));
  if (isRemoteOnlyMode() && mediaSync.pushed && !embeddedMediaMode) {
    record.mediaRemoteOnly = true;
    record.mediaRemoteUrl = mediaSync.mediaUrl || '';
    record.data.media.remoteOnly = true;
    record.data.media.mediaUrl = `/api/records/${encodeURIComponent(record.id)}/media`;
    record.data.media.downloadUrl = `/api/records/${encodeURIComponent(record.id)}/media?download=1`;
    record.mediaCachePath = record.mediaStoragePath || relMedia;
    record.mediaAuthoritative = 'production-dwn-node';
    record.mediaCachedOnApp = true;
    record.mediaReadyAt = new Date().toISOString();
    await markCloudSync(record, ownerDid);
  } else if (embeddedMediaMode) {
    // Marking it remote-only makes the browser hit an internal/self DWN URL path and was the
    // main reason uploaded WhatsApp MP4 files could show 0:00 / not playable after upload.
    delete record.mediaRemoteOnly;
    delete record.mediaRemoteUrl;
    record.data.media.remoteOnly = false;
    record.mediaAuthoritative = 'embedded-local-dwn-isolated-space';
    record.mediaReadyAt = new Date().toISOString();
  }
  persistRecord(userId, record);
  all[userId] = list;
  writeIndex(all);
  audit('dwn.file.upload.persisted', { userId, recordId: record.id, mimeType, sizeBytes, previewCategory, browserPlayable, mediaStoragePath: record.mediaStoragePath, mediaSync, mediaCompatibility: record.mediaCompatibility });
  if (fastAcceptVideo) scheduleMediaBackgroundProcessing(userId, ownerDid, record.id);
  return toClient(record, ownerDid);
}

async function repairMediaForBrowser(userId, did, id) {
  const lockKey = `${userId}:${id}`;
  if (mediaRepairLocks.has(lockKey)) {
    const found = findRecordRaw(id);
    const ageMs = mediaProcessingAgeMs(found?.record);
    const timeoutMs = mediaProcessingTimeoutMs(found?.record);
    if (ageMs >= timeoutMs) {
      // A previous ffmpeg/cloud-sync job got stuck. Release the lock and move the UI out of
      // endless "preparing". The original upload remains available for direct play/download.
      mediaRepairLocks.delete(lockKey);
      mediaProcessingQueue.delete(lockKey);
      const failed = markMediaProcessingFailure(userId, id, 'Video preview processing timed out on this server. Original file is saved; direct play/download is available. Tap Prepare / Repair to retry.');
      return { repaired: false, processing: false, timeout: true, record: failed ? toClient(failed, did) : await getRecord(id, did).catch(() => null), warning: 'Video processing timed out; original file is saved.' };
    }
    const record = await getRecord(id, did).catch(() => null);
    return { repaired: false, processing: true, active: true, ageMs, timeoutMs, record, warning: 'Video preview is already being prepared. Please refresh in a few seconds.' };
  }
  const job = repairMediaForBrowserUnlocked(userId, did, id);
  mediaRepairLocks.set(lockKey, job);
  try { return await job; }
  catch (err) {
    markMediaProcessingFailure(userId, id, `Video preview processing failed: ${err.message}. Original file is saved; Download is available.`);
    throw err;
  }
  finally { mediaRepairLocks.delete(lockKey); }
}

async function repairMediaForBrowserUnlocked(userId, did, id) {
  const found = findRecordRaw(id);
  if (!found) {
    const err = new Error('Record not found');
    err.status = 404;
    throw err;
  }
  if (!canRead(found.record, did)) {
    const err = new Error('No access');
    err.status = 403;
    throw err;
  }
  if (found.userId !== userId) {
    const err = new Error('Only the owner can repair this media file. Ask the owner to refresh/upload again.');
    err.status = 403;
    throw err;
  }
  const data = found.record.data || {};
  const media = data.media || data || {};
  const rel = found.record.mediaStoragePath || found.record.mediaCachePath || '';
  const full = rel ? absoluteBackendPath(rel) : null;
  if (!full || !fs.existsSync(full)) {
    const err = new Error('Original media file is not available on the current server. Re-upload this post once; after V49 it will be saved as browser-safe media.');
    err.status = 404;
    throw err;
  }
  const beforeSize = fs.statSync(full).size;
  const originalName = media.fileName || found.record.title || path.basename(full);
  const currentMime = media.mimeType || found.record.dataFormat || detectMimeFromFile(full, originalName).mimeType || 'application/octet-stream';
  setRecordMediaProcessing(found, { processing: false, status: 'checking', warning: 'Repair is running in background. Direct playback/download stays available.' });
  persistFoundRecord(found);
  // V57: repair must be fast first. Do not force full transcode for normal H.264/AAC MP4.
  // Full transcode is still used automatically when remux/probe says the video is unsafe.
  const forceRepairTranscode = ['1','true','yes','on'].includes(String(process.env.MILAN_FORCE_REPAIR_TRANSCODE || 'false').toLowerCase());
  const compatibility = await normalizeUploadedMedia({ filePath: full, mimeType: currentMime, originalName, force: forceRepairTranscode });
  if (!compatibility.changed || !compatibility.filePath || !fs.existsSync(compatibility.filePath)) {
    const playable = compatibility.browserPlayable === true;
    const warning = compatibility.warning || (playable ? '' : 'Video preview could not be converted on this server. Original file is saved; Download is available.');
    setRecordMediaProcessing(found, {
      processing: false,
      status: playable ? 'ready' : 'preview-unavailable',
      warning,
      browserPlayable: playable,
      extraCompatibility: {
        checkedAt: new Date().toISOString(),
        repaired: false,
        detectedMimeType: compatibility.detected?.mimeType || '',
        probe: compatibility.compatibility || null
      }
    });
    found.record.data.media.previewCategory = found.record.data.media.previewCategory || 'video';
    persistFoundRecord(found);
    return { repaired: false, record: toClient(found.record, did), warning: found.record.mediaCompatibility.warning };
  }
  try { if (compatibility.filePath !== full && fs.existsSync(full)) fs.unlinkSync(full); } catch (_) {}
  const mediaDir = path.dirname(full);
  const finalPath = path.join(mediaDir, `${safeName(found.record.id)}.mp4`);
  let newPath = compatibility.filePath;
  if (newPath !== finalPath) {
    try { fs.renameSync(newPath, finalPath); newPath = finalPath; } catch (_) {}
  }
  const relMedia = path.relative(path.join(__dirname, '..'), newPath).replace(/\\/g, '/');
  const afterSize = fs.statSync(newPath).size;
  found.record.dataFormat = 'video/mp4';
  found.record.mediaStoragePath = relMedia;
  found.record.mediaCachePath = relMedia;
  found.record.mediaStoredAt = new Date().toISOString();
  found.record.dateModified = new Date().toISOString();
  found.record.data = found.record.data || { kind: 'media', caption: '' };
  found.record.data.kind = 'media';
  found.record.data.media = found.record.data.media || {};
  found.record.data.media.fileName = String(originalName).replace(/\.[^.]*$/, '') + '.mp4';
  found.record.data.media.mimeType = 'video/mp4';
  found.record.data.media.sizeBytes = afterSize;
  found.record.data.media.stored = true;
  found.record.data.media.browserSafe = true;
  found.record.data.media.browserPlayable = true;
  found.record.data.media.processing = false;
  found.record.data.media.processingStatus = 'ready';
  delete found.record.data.media.compatibilityWarning;
  found.record.data.media.mediaUrl = `/api/records/${encodeURIComponent(found.record.id)}/media`;
  found.record.data.media.downloadUrl = `/api/records/${encodeURIComponent(found.record.id)}/media?download=1`;
  found.record.mediaCompatibility = {
    checkedAt: new Date().toISOString(),
    repaired: true,
    remuxed: !!compatibility.remuxed,
    transcoded: !!compatibility.transcoded,
    ffmpegUsed: !!compatibility.ffmpegUsed,
    beforeSize,
    afterSize,
    detectedMimeType: compatibility.detected?.mimeType || '',
    warning: compatibility.warning || '',
    processing: false,
    processingStatus: 'ready',
    browserPlayable: true,
    browserSafe: true
  };
  // Persist the playable local MP4 before any cloud sync. Even if a cloud sync retry fails,
  // the user's app must not remain stuck in "preparing" state.
  persistFoundRecord(found);
  let mediaSync = null;
  try {
    await markCloudSync(found.record, did);
    const ownerUser = userByDid(did);
    mediaSync = await pushMediaToCloudDwn(found.record, ownerUser, newPath);
    found.record.cloudDwn = found.record.cloudDwn || {};
    found.record.cloudDwn.mediaSync = mediaSync;
    persistFoundRecord(found);
  } catch (err) {
    found.record.mediaCompatibility.warning = `Video preview ready locally. Cloud media sync will retry later: ${err.message}`;
    persistFoundRecord(found);
    audit('dwn.media.repair.cloud.sync.failed', { userId, recordId: id, error: err.message });
  }
  return { repaired: true, record: toClient(found.record, did), mediaSync, beforeSize, afterSize };
}



function queueVideoProcessing(userId, did, id, reason = 'manual') {
  const found = findRecordRaw(id);
  if (!found) { const err = new Error('Record not found'); err.status = 404; throw err; }
  if (!canRead(found.record, did)) { const err = new Error('No access'); err.status = 403; throw err; }
  if (found.userId !== userId) { const err = new Error('Only the owner can prepare this video preview.'); err.status = 403; throw err; }
  const queued = scheduleMediaBackgroundProcessing(found.userId, found.record.owner || did, found.record.id, reason);
  const latest = findRecordRaw(id)?.record || found.record;
  return { queued, active: isMediaProcessingActive(found.userId, found.record.id), record: toClient(latest, did) };
}

function ensureVideoProcessing(userId, did, id) {
  const found = findRecordRaw(id);
  if (!found || !canRead(found.record, did)) return { record: found?.record || null, queued: false, active: false, ageMs: 0 };
  const media = found.record.data?.media || {};
  const compat = found.record.mediaCompatibility || {};
  const previewCategory = media.previewCategory || compat.previewCategory || categoryForMime(media.mimeType || found.record.dataFormat || '', media.fileName || found.record.title || '');
  const status = media.processingStatus || compat.processingStatus || (media.processing || compat.processing ? 'processing' : 'ready');
  const processing = previewCategory === 'video' && !!(media.processing || compat.processing || status === 'processing' || status === 'queued');
  const active = isMediaProcessingActive(found.userId, found.record.id);
  const ageMs = mediaProcessingAgeMs(found.record);
  const timeoutMs = mediaProcessingTimeoutMs(found.record);
  if (processing && active && ageMs >= timeoutMs) {
    // Never keep mobile users on an endless preparing screen.
    const key = mediaJobKey(found.userId, found.record.id);
    mediaProcessingQueue.delete(key);
    mediaRepairLocks.delete(key);
    const failed = markMediaProcessingFailure(found.userId, found.record.id, 'Video preview processing timed out on this server. Original file is saved; direct play/download is available. Tap Prepare / Repair to retry.');
    return { record: failed || found.record, queued: false, active: false, ageMs, timeoutMs, timedOut: true };
  }
  if (processing && !active && ageMs >= MILAN_PROCESSING_STALE_MS) {
    const queued = scheduleMediaBackgroundProcessing(found.userId, found.record.owner || did, found.record.id, 'status-watchdog');
    return { record: findRecordRaw(id)?.record || found.record, queued, active: false, ageMs, timeoutMs };
  }
  return { record: found.record, queued: false, active, ageMs, timeoutMs };
}


async function ensureMediaPlayableForStream(userId, did, id, options = {}) {
  const found = findRecordRaw(id);
  if (!found || !canRead(found.record, did)) return { touched: false, reason: 'not-found-or-no-access' };
  const media = found.record.data?.media || {};
  const compat = found.record.mediaCompatibility || {};
  const previewCategory = media.previewCategory || compat.previewCategory || categoryForMime(media.mimeType || found.record.dataFormat || '', media.fileName || found.record.title || '');
  if (previewCategory !== 'video') return { touched: false, reason: 'not-video' };
  if (found.userId !== userId) return { touched: false, reason: 'reader-not-owner' };

  const status = media.processingStatus || compat.processingStatus || 'ready';
  const alreadyPlayable = (media.browserPlayable === true || compat.browserPlayable === true) && status === 'ready' && String(media.mimeType || found.record.dataFormat || '').toLowerCase().includes('mp4');
  if (alreadyPlayable) return { touched: false, reason: 'already-playable' };

  const rel = found.record.mediaStoragePath || found.record.mediaCachePath || '';
  const full = rel ? absoluteBackendPath(rel) : null;
  if (!full || !fs.existsSync(full)) return { touched: false, reason: 'local-file-missing' };
  const size = fs.statSync(full).size;
  const maxBytes = Number(options.maxBytes || process.env.MILAN_UNIVERSAL_STREAM_FIX_BYTES || 512 * 1024 * 1024);
  if (size > maxBytes) {
    // Do not block the player for huge videos. Queue background fix and stream the original.
    try { scheduleMediaBackgroundProcessing(found.userId, found.record.owner || did, found.record.id, 'universal-stream-large-video'); } catch (_) {}
    return { touched: false, reason: 'too-large-background-queued', size, maxBytes };
  }

  try {
    const lockKey = mediaJobKey(found.userId, found.record.id);
    if (mediaRepairLocks.has(lockKey)) {
      const activeJob = mediaRepairLocks.get(lockKey);
      const waitMs = Number(options.waitMs || process.env.MILAN_UNIVERSAL_STREAM_WAIT_MS || 60000);
      await Promise.race([
        activeJob.catch(() => null),
        new Promise(resolve => setTimeout(resolve, waitMs))
      ]);
      const latest = findRecordRaw(id)?.record || found.record;
      const latestMedia = latest.data?.media || {};
      const latestCompat = latest.mediaCompatibility || {};
      if (latestMedia.browserPlayable === true || latestCompat.browserPlayable === true) {
        return { touched: true, reason: 'active-repair-finished-before-stream' };
      }
    }
    const result = await repairMediaForBrowser(found.userId, found.record.owner || did, found.record.id);
    return { touched: !!result?.repaired, reason: result?.repaired ? 'repaired-before-stream' : 'checked-before-stream', result };
  } catch (err) {
    // Streaming must never fail just because automatic healing failed. The raw file remains available.
    audit('dwn.media.universal.stream.heal.failed', { userId, recordId: id, error: err.message });
    return { touched: false, reason: 'repair-failed', error: err.message };
  }
}

async function importRecords(userId, ownerDid, records = []) {
  const imported = [];
  for (const item of records.slice(0, 200)) {
    if (item.data === undefined) continue;
    try {
      imported.push(await createRecord(userId, ownerDid, item));
    } catch (_err) {}
  }
  return imported;
}

async function listVisibleRecords(did, query = {}) {
  return filterSort(allRecordsRaw().filter(r => canRead(r, did)).map(r => toClient(r, did)), query);
}

async function listPublicRecords(did, query = {}) {
  return filterSort(allRecordsRaw().filter(r => modeOf(r) === 'public').map(r => toClient(r, did)), query);
}

async function listSharedWithMe(did, query = {}) {
  return filterSort(allRecordsRaw().filter(r => r.owner !== did && modeOf(r) === 'shared_did' && (r.sharedWithDids || []).includes(did)).map(r => toClient(r, did)), query);
}

async function getRecord(id, did) {
  const found = findRecordRaw(id);
  if (!found) return null;
  if (!canRead(found.record, did)) {
    const err = new Error('No access');
    err.status = 403;
    throw err;
  }
  return toClient(found.record, did);
}

async function getOwnedRecords(userId, did) {
  const { list } = ownerRecordsRaw(userId);
  return list.map(r => toClient(r, did));
}

async function updateRecord(userId, did, id, body = {}) {
  validatePayload(body);
  const { all, list } = ownerRecordsRaw(userId);
  const record = list.find(x => x.id === id);
  if (!record) return null;
  ['schema', 'dataFormat'].forEach(k => { if (body[k] !== undefined) record[k] = String(body[k]); });
  if (body.title !== undefined) record.title = String(body.title).trim().slice(0, 140) || 'Untitled record';
  if (body.data !== undefined) record.data = body.data;
  if (Array.isArray(body.tags)) record.tags = sanitizeTags(body.tags);
  if (body.favorite !== undefined) record.favorite = !!body.favorite;
  record.dateModified = new Date().toISOString();
  record.dwnSdkReady = dwnInitStatus.sdkReady;
  await markCloudSync(record, did);
  persistRecord(userId, record);
  all[userId] = list;
  writeIndex(all);
  return toClient(record, did);
}

async function updatePermissions(userId, did, id, body = {}) {
  const { all, list } = ownerRecordsRaw(userId);
  const record = list.find(x => x.id === id);
  if (!record) return null;
  const access = normalizeAccess(body, record);
  if (access.error) {
    const err = new Error(access.error);
    err.status = 400;
    throw err;
  }
  applyAccess(record, access.mode, access.dids);
  record.dateModified = new Date().toISOString();
  await markCloudSync(record, did);
  persistRecord(userId, record);
  all[userId] = list;
  writeIndex(all);
  return toClient(record, did);
}

async function shareRecord(userId, did, id, targetDid) {
  const found = findRecordRaw(id);
  if (!found || found.userId !== userId) return null;
  const dids = cleanDids([...(found.record.sharedWithDids || []), targetDid]);
  applyAccess(found.record, 'shared_did', dids);
  found.record.dateModified = new Date().toISOString();
  await markCloudSync(found.record, did);
  persistRecord(found.userId, found.record);
  found.all[found.userId] = found.list;
  writeIndex(found.all);
  return toClient(found.record, did);
}

async function unshareRecord(userId, did, id, targetDid) {
  const found = findRecordRaw(id);
  if (!found || found.userId !== userId) return null;
  const dids = (found.record.sharedWithDids || []).filter(x => x !== targetDid);
  applyAccess(found.record, dids.length ? 'shared_did' : 'private', dids);
  found.record.dateModified = new Date().toISOString();
  await markCloudSync(found.record, did);
  persistRecord(found.userId, found.record);
  found.all[found.userId] = found.list;
  writeIndex(found.all);
  return toClient(found.record, did);
}

async function deleteRecord(userId, id) {
  const { all, list } = ownerRecordsRaw(userId);
  const record = list.find(x => x.id === id);
  if (!record) return false;

  // Permanent deletion: remove the authoritative Supabase/DWN rows first.
  // Local cache is removed only after cloud deletion succeeds.
  await deleteRecordFromCloudDwn(record.id, record.owner);

  const next = list.filter(x => x.id !== id);
  all[userId] = next;
  writeIndex(all);
  removeRecordFile(userId, id);

  audit('dwn.record.permanently.deleted', {
    userId,
    recordId: record.id,
    ownerDid: record.owner
  });

  return true;
}

async function findRecordById(id) {
  return findRecordRaw(id);
}

async function approveAccessForRecord(recordId, ownerDid, readerDid, requestId = '') {
  const found = findRecordRaw(recordId);
  if (!found || found.record.owner !== ownerDid) return null;
  const dids = cleanDids([...(found.record.sharedWithDids || []), readerDid]);
  applyAccess(found.record, 'shared_did', dids);
  found.record.access.approvedRequestId = requestId;
  found.record.dateModified = new Date().toISOString();
  persistRecord(found.userId, found.record);
  found.all[found.userId] = found.list;
  writeIndex(found.all);
  return found.record;
}

async function wipeUserRecords(userId) {
  const all = readIndex();
  const records = Array.isArray(all[userId]) ? all[userId] : [];
  for (const r of records) removeRecordFile(userId, r.id);
  const count = records.length;
  all[userId] = [];
  writeIndex(all);
  audit('dwn.user.records.wiped', { userId, count });
  return count;
}

async function statsFor(did) {
  const visible = await listVisibleRecords(did, {});
  return {
    total: visible.length,
    private: visible.filter(r => r.accessMode === 'private' && r.owner === did).length,
    public: visible.filter(r => r.accessMode === 'public').length,
    sharedWithMe: visible.filter(r => r.owner !== did && r.accessMode === 'shared_did').length,
    sharedByMe: visible.filter(r => r.owner === did && r.accessMode === 'shared_did').length,
    types: [...new Set(visible.map(r => r.dataFormat))],
    tags: [...new Set(visible.flatMap(r => r.tags || []))],
    storage: 'DWN',
    dwnStatus: getStatus()
  };
}


async function getMediaStream(id, did) {
  const found = findRecordRaw(id);
  if (!found) return null;
  if (!canRead(found.record, did)) {
    const err = new Error('No access');
    err.status = 403;
    throw err;
  }
  const data = found.record.data || {};
  const media = data.media || data || {};
  if (found.record.mediaRemoteOnly || found.record.mediaRemoteUrl || found.record.cloudDwn?.mediaSync?.mediaUrl) {
    const fallbackPath = found.record.mediaStoragePath || found.record.mediaCachePath || '';
    const fallbackFullPath = fallbackPath ? absoluteBackendPath(fallbackPath) : null;
    const fallbackReady = !!(fallbackFullPath && fs.existsSync(fallbackFullPath));
    const mimeForCategory = media.mimeType || found.record.dataFormat || 'application/octet-stream';
    const fileForCategory = media.fileName || found.record.title || (fallbackFullPath ? path.basename(fallbackFullPath) : '');
    const previewCategory = media.previewCategory || found.record.mediaCompatibility?.previewCategory || categoryForMime(mimeForCategory, fileForCategory);
    const remoteUrl = found.record.mediaRemoteUrl || found.record.cloudDwn?.mediaSync?.mediaUrl || '';
    // V58: for video playback, prefer the local browser-safe cache when it exists.
    // Remote DWN media can be slower or return imperfect range headers; the local normalized
    // MP4 is what makes uploaded videos start smoothly on mobile.
    const preferLocalVideo = fallbackReady && previewCategory === 'video' && String(process.env.MILAN_VIDEO_LOCAL_CACHE_FIRST || 'true').toLowerCase() !== 'false';
    if ((isEmbeddedSelfEndpoint(remoteUrl) || preferLocalVideo) && fallbackReady) {
      return {
        fullPath: fallbackFullPath,
        mimeType: media.mimeType || found.record.dataFormat || 'application/octet-stream',
        fileName: media.fileName || path.basename(fallbackFullPath),
        sizeBytes: fs.statSync(fallbackFullPath).size,
        embeddedSelfDirect: isEmbeddedSelfEndpoint(remoteUrl),
        localCachePreferred: preferLocalVideo
      };
    }
    return {
      remoteUrl,
      mimeType: media.mimeType || found.record.dataFormat || 'application/octet-stream',
      fileName: media.fileName || 'dwn-media',
      sizeBytes: media.sizeBytes || 0,
      remoteOnly: true,
      fallbackFullPath: fallbackReady ? fallbackFullPath : null,
      fallbackSizeBytes: fallbackReady ? fs.statSync(fallbackFullPath).size : 0
    };
  }
  if (!found.record.mediaStoragePath && !found.record.mediaCachePath) return null;
  const full = absoluteBackendPath(found.record.mediaStoragePath || found.record.mediaCachePath);
  if (!full || !fs.existsSync(full)) return null;
  return {
    fullPath: full,
    mimeType: media.mimeType || found.record.dataFormat || 'application/octet-stream',
    fileName: media.fileName || path.basename(full),
    sizeBytes: fs.statSync(full).size
  };
}

module.exports = {
  initDwn,
  getStatus,
  normalizeAccess,
  cleanDids,
  listVisibleRecords,
  listPublicRecords,
  listSharedWithMe,
  getRecord,
  getMediaStream,
  getOwnedRecords,
  createRecord,
  createMediaRecordFromFile,
  repairMediaForBrowser,
  queueVideoProcessing,
  ensureVideoProcessing,
  ensureMediaPlayableForStream,
  importRecords,
  updateRecord,
  updatePermissions,
  shareRecord,
  unshareRecord,
  deleteRecord,
  findRecordById,
  approveAccessForRecord,
  wipeUserRecords,
  statsFor
};
