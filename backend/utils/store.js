const fs = require('fs');
const path = require('path');

const DB_FILES_TO_SYNC = new Set([
  'users.json','records.json','protocols.json','activity.json','requests.json','connections.json',
  'socialReactions.json','socialComments.json','notifications.json','socialSaves.json','feedback.json',
  'securityReports.json','APP_RECORD_INDEX.json','DATABASE_MANIFEST.json'
]);


function safeBackupFile(file, reason = 'backup') {
  try {
    if (!fs.existsSync(file)) return '';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${file}.${reason}.${stamp}.bak`;
    fs.copyFileSync(file, backup);
    return backup;
  } catch (_) {
    return '';
  }
}

function atomicWriteJson(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(data, null, 2);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, json);
  // Keep a last-known-good backup for the critical user DB and record index.
  if (['users.json', 'APP_RECORD_INDEX.json'].includes(path.basename(file)) && fs.existsSync(file)) {
    try { fs.copyFileSync(file, `${file}.last-good.bak`); } catch (_) {}
  }
  fs.renameSync(tmp, file);
}


function unwrapDwnSnapshotValue(value) {
  let data = value;
  for (let i = 0; i < 5; i += 1) {
    if (data && typeof data === 'object' && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, 'data')) {
      const looksEnvelope = Object.prototype.hasOwnProperty.call(data, 'snapshotName') || Object.prototype.hasOwnProperty.call(data, 'node') || Object.prototype.hasOwnProperty.call(data, 'updatedAt') || Object.prototype.hasOwnProperty.call(data, 'embeddedDwnNode') || Object.prototype.hasOwnProperty.call(data, 'realDwnProtocol');
      if (looksEnvelope) { data = data.data; continue; }
    }
    break;
  }
  return data;
}
function cleanUsersDb(value) {
  const data = unwrapDwnSnapshotValue(value);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out = {};
  for (const [key, user] of Object.entries(data)) {
    if (!user || typeof user !== 'object' || Array.isArray(user)) continue;
    const email = String(user.email || key || '').trim().toLowerCase();
    const looksUser = !!(email && email.includes('@') && (user.password_hash || user.did || user.id || user.profile));
    if (!looksUser) continue;
    out[email] = { ...user, email };
  }
  return out;
}
function cleanByFileName(file, data) {
  return path.basename(file) === 'users.json' ? cleanUsersDb(data) : unwrapDwnSnapshotValue(data);
}
function repairUsersFile(file) {
  if (path.basename(file) !== 'users.json') return { ok: true, skipped: 'not-users-file' };
  try {
    ensureFile(file, {});
    const raw = fs.readFileSync(file, 'utf8').trim();
    let parsed = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch (parseErr) {
      const backup = safeBackupFile(file, 'corrupt-users-json');
      atomicWriteJson(file, {});
      return { ok: true, repaired: true, resetCorruptFile: true, backup, users: 0, warning: parseErr.message };
    }
    const cleaned = cleanUsersDb(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(cleaned)) {
      atomicWriteJson(file, cleaned);
      return { ok: true, repaired: true, users: Object.keys(cleaned).length };
    }
    return { ok: true, repaired: false, users: Object.keys(cleaned).length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function ensureFile(file, fallback = {}) {
  const dir = path.dirname(file);
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); if (!fs.existsSync(file)) atomicWriteJson(file, fallback); }
  catch (err) { const e = new Error(`Milan DWN database write failed for ${file}: ${err.message}`); e.code = err.code; throw e; }
}
// Perf: cache parsed JSON keyed by file mtime+size. Skips disk read + parse
// when the file is unchanged; returns a deep clone so callers can mutate freely.
// Any write changes the file's mtime, so the cache self-invalidates — no stale reads.
const _readCache = new Map();
function _clone(v) { try { return structuredClone(v); } catch (_) { return JSON.parse(JSON.stringify(v)); } }
function readJson(file, fallback = {}) {
  try {
    ensureFile(file, fallback);
    let st = null;
    try { st = fs.statSync(file); } catch (_) { st = null; }
    if (st) {
      const c = _readCache.get(file);
      if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return _clone(c.value);
    }
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return fallback;
    const value = cleanByFileName(file, JSON.parse(raw));
    if (st) _readCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, value });
    return _clone(value);
  } catch (err) {
    console.error('JSON read failed:', file, err.message);
    const backup = `${file}.last-good.bak`;
    try {
      if (fs.existsSync(backup)) {
        const parsed = JSON.parse(fs.readFileSync(backup, 'utf8'));
        const cleaned = cleanByFileName(file, parsed);
        atomicWriteJson(file, cleaned);
        return cleaned;
      }
    } catch (backupErr) {
      console.error('JSON backup recovery failed:', file, backupErr.message);
    }
    return fallback;
  }
}
function remoteSyncAllowed(file) { return DB_FILES_TO_SYNC.has(path.basename(file)); }
function pushDatabaseSnapshotAsync(file, data) {
  if (!remoteSyncAllowed(file)) return;
  if (global.__milanHydratingFromDwn) return;
  try {
    const { syncDatabaseSnapshot } = require('../services/cloudDwnRegistry');
    const name = path.basename(file);
    // Fire-and-forget so existing sync code stays fast. App cache is not authoritative; remote DWN snapshot is.
    syncDatabaseSnapshot(name, data).then(result => {
      if (result && result.ok === false && !result.skipped) console.warn('Production DWN DB sync failed:', name, result.error || result);
    }).catch(err => console.warn('Production DWN DB sync failed:', name, err.message));
  } catch (err) { console.warn('Production DWN DB sync unavailable:', err.message); }
}
function writeJson(file, data) {
  const cleanData = cleanByFileName(file, data);
  ensureFile(file, Array.isArray(data) ? [] : {});
  atomicWriteJson(file, cleanData);
  pushDatabaseSnapshotAsync(file, cleanData);
}
async function writeJsonAndSync(file, data) {
  ensureFile(file, Array.isArray(data) ? [] : {});
  const cleanData = cleanByFileName(file, data);
  atomicWriteJson(file, cleanData);
  if (!remoteSyncAllowed(file) || global.__milanHydratingFromDwn) return { ok: true, skipped: 'remote-sync-not-needed' };
  try {
    const { syncDatabaseSnapshot } = require('../services/cloudDwnRegistry');
    const result = await syncDatabaseSnapshot(path.basename(file), cleanData);
    if (!result || result.ok === false) return { ok: false, error: result?.error || result?.skipped || 'remote-sync-failed', result };
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
function normalizePulledSnapshot(pulled) {
  if (!pulled || pulled.ok === false) return { ok: false, error: pulled?.error || pulled?.skipped || 'not-found' };
  let data = pulled.data !== undefined ? pulled.data : pulled;
  data = unwrapDwnSnapshotValue(data);
  return { ok: true, data };
}
async function hydrateFilesFromRealDwn(files = []) {
  const unique = [...new Set(files.filter(Boolean))];
  const results = [];
  try {
    const { pullDatabaseSnapshot, persistenceInfo } = require('../services/cloudDwnRegistry');
    const p = persistenceInfo();
    if (!p.remoteEndpoint) return { ok: false, skipped: 'remote-dwn-not-configured' };
    global.__milanHydratingFromDwn = true;
    for (const file of unique) {
      const name = path.basename(file);
      if (!remoteSyncAllowed(file)) continue;
      console.log(`[HYDRATE] begin ${name}`);
      const pulled = await pullDatabaseSnapshot(name);
      console.log(`[HYDRATE] done ${name}`);
      const normalized = normalizePulledSnapshot(pulled);
      if (normalized.ok && normalized.data !== undefined) {
        const isEmptyObject = normalized.data && typeof normalized.data === 'object' && !Array.isArray(normalized.data) && Object.keys(normalized.data).length === 0;
        const currentRawForSkip = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
        if (isEmptyObject && currentRawForSkip && currentRawForSkip !== '{}' && currentRawForSkip !== '[]') {
          results.push({ name, hydrated: false, reason: 'remote-empty-kept-local-cache' });
          continue;
        }
        ensureFile(file, Array.isArray(normalized.data) ? [] : {});
        const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
        const currentEmpty = !current || current === '{}' || current === '[]';
        // Always hydrate core user/database files from DWN on Render startup; remote is authoritative.
        atomicWriteJson(file, normalized.data);
        results.push({ name, hydrated: true, wasEmpty: currentEmpty, source: 'production-dwn-node' });
      } else {
        results.push({ name, hydrated: false, reason: normalized.error || 'not-found' });
      }
    }
  } catch (err) { return { ok: false, error: err.message, results }; }
  finally { global.__milanHydratingFromDwn = false; }
  return { ok: true, results };
}
function findUserById(users, userId) { for (const [email, user] of Object.entries(users || {})) if (user.id === userId) return { email, user }; return null; }
function findUserByDid(users, did) { for (const [email, user] of Object.entries(users || {})) if (user.did === did) return { email, user }; return null; }
function addActivity(userId, action, details = {}) { const file = global.activityFile; const all = readJson(file, {}); if (!Array.isArray(all[userId])) all[userId] = []; all[userId].unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, action, details, at: new Date().toISOString() }); all[userId] = all[userId].slice(0, 150); writeJson(file, all); }
module.exports = { ensureFile, readJson, writeJson, writeJsonAndSync, atomicWriteJson, normalizePulledSnapshot, unwrapDwnSnapshotValue, cleanUsersDb, repairUsersFile, findUserById, findUserByDid, addActivity, hydrateFilesFromRealDwn };
