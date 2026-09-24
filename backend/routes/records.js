const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const auth = require('../middleware/auth');
const { readJson, findUserById, findUserByDid, addActivity } = require('../utils/store');
const dwnStore = require('../services/dwnService');
const { createClient } = require('@supabase/supabase-js');

const supabaseDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const { Readable } = require('stream');
const crypto = require('crypto');
const { detectMimeFromFile } = require('../utils/mediaCompat');

const router = express.Router();

async function current(req) {
  const account = req.account;
  if (!account?.id || !account?.did || !account?.spaceId) return null;

  return {
    email: account.email,
    user: {
      ...account,
      id: account.id,
      email: account.email,
      name: account.name,
      did: account.did,
      dwn: {
        ...(account.dwn || {}),
        spaceId: account.spaceId
      },
      settings: {
        ...(account.settings || {}),
        dwnSpaceId: account.spaceId
      },
      profile: {
        display_name: account.name || ''
      }
    }
  };
}

function handleError(res, err) {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Server error' });
}

function browserServeMime(media = {}, fullPath = '') {
  let mime = String(media.mimeType || 'application/octet-stream').split(';')[0].toLowerCase();
  try {
    const detected = detectMimeFromFile(fullPath, media.fileName || '');
    if (detected.mimeType && (!mime || mime === 'application/octet-stream' || mime === 'video/quicktime')) mime = detected.mimeType;
    // QuickTime/MOV MIME often makes browser preview fail even when the bytes are MP4-like.
    // The preview endpoint is intentionally served as MP4 after conversion/remux.
    if (mime === 'video/quicktime') mime = 'video/mp4';
    if (mime === 'audio/mp3') mime = 'audio/mpeg';
  } catch (_) {}
  return mime || 'application/octet-stream';
}

function isVideoMime(mime = '') {
  return String(mime || '').toLowerCase().startsWith('video/');
}

function parseByteRange(range, total) {
  const match = String(range || '').match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;
  let start = match[1] ? parseInt(match[1], 10) : 0;
  let end = match[2] ? parseInt(match[2], 10) : total - 1;
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (!Number.isFinite(end) || end >= total) end = total - 1;
  if (start >= total || end < start) return { invalid: true };
  return { start, end };
}


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
  const name = (base + (ext || '')).slice(0, 160);
  return name.replace(/["\\\r\n]/g, '_') || 'milan-media';
}

function contentDisposition(req, fileName = 'milan-media') {
  const mode = req.query && req.query.download === '1' ? 'attachment' : 'inline';
  const original = String(fileName || 'milan-media');
  const fallback = safeAsciiFileName(original);
  const encoded = encodeURIComponent(original).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function streamRangeOrWholeFile(req, res, fullPath, media, sourceLabel = '') {
  const total = fs.statSync(fullPath).size;
  let contentType = browserServeMime(media, fullPath);
  const videoPlayRequest = isVideoMime(contentType) && (/play\.mp4$/i.test(req.path || '') || String(req.query.universal || '') === '1' || String(req.query.native_direct || '') === '1');
  if (videoPlayRequest) contentType = 'video/mp4';
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, X-Milan-Media-Source');
  res.setHeader('Cache-Control', isVideoMime(contentType) ? 'private, max-age=86400, no-transform' : 'private, max-age=3600, immutable');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Timing-Allow-Origin', '*');
  res.setHeader('Content-Disposition', contentDisposition(req, media.fileName || 'milan-media'));
  res.setHeader('X-Accel-Buffering', 'no');
  if (sourceLabel) res.setHeader('X-Milan-Media-Source', sourceLabel);

  if (req.method === 'HEAD') {
    res.setHeader('Content-Length', total);
    return res.status(200).end();
  }

  const range = req.headers.range;
  if (range) {
    const parsed = parseByteRange(range, total);
    if (!parsed || parsed.invalid) {
      res.setHeader('Content-Range', `bytes */${total}`);
      return res.status(416).end();
    }
    // Standard HTTP Range behavior is essential for MP4 metadata/seeking.
    // The previous artificial 4 MB response to "bytes=0-" could make mobile
    // players show a black 0:00 video even when the upload itself was fine.
    res.status(206);
    res.setHeader('Content-Range', `bytes ${parsed.start}-${parsed.end}/${total}`);
    res.setHeader('Content-Length', parsed.end - parsed.start + 1);
    return fs.createReadStream(fullPath, { start: parsed.start, end: parsed.end, highWaterMark: 1024 * 1024 }).pipe(res);
  }

  res.status(200);
  res.setHeader('Content-Length', total);
  return fs.createReadStream(fullPath, { highWaterMark: 1024 * 1024 }).pipe(res);
}

// Facebook-style reliable upload layer: split large videos into small resumable chunks.
// This avoids one huge mobile request timing out while the app is deployed behind proxies.
const RESUMABLE_ROOT = path.join(os.tmpdir(), 'milan-resumable-media-uploads');
const DEFAULT_CHUNK_BYTES = Number(process.env.MILAN_UPLOAD_CHUNK_BYTES || 6 * 1024 * 1024);
const MAX_CHUNK_BYTES = Number(process.env.MILAN_UPLOAD_MAX_CHUNK_BYTES || 12 * 1024 * 1024);
const SESSION_TTL_MS = Number(process.env.MILAN_UPLOAD_SESSION_TTL_MS || 24 * 60 * 60 * 1000);

function ensureUploadRoot() { fs.mkdirSync(RESUMABLE_ROOT, { recursive: true }); }
function uploadSessionDir(id) { return path.join(RESUMABLE_ROOT, safeUploadId(id)); }
function uploadSessionFile(id) { return path.join(uploadSessionDir(id), 'session.json'); }
function safeUploadId(value) { return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 100); }
function safeUploadName(value) { return String(value || 'milan-media').replace(/[\\/\r\n]/g, '_').slice(0, 180) || 'milan-media'; }
function readUploadSession(id) {
  const file = uploadSessionFile(id);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function writeUploadSession(session) {
  const dir = uploadSessionDir(session.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(uploadSessionFile(session.id), JSON.stringify(session, null, 2));
}
function cleanupUploadSession(id) {
  try { fs.rmSync(uploadSessionDir(id), { recursive: true, force: true }); } catch (_) {}
}
function cleanupOldUploadSessions() {
  try {
    ensureUploadRoot();
    const now = Date.now();
    for (const item of fs.readdirSync(RESUMABLE_ROOT)) {
      const dir = path.join(RESUMABLE_ROOT, item);
      const st = fs.statSync(dir);
      if (st.isDirectory() && now - st.mtimeMs > SESSION_TTL_MS) fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (_) {}
}
function normalizeUploadMeta(body = {}) {
  return {
    title: String(body.title || body.fileName || 'Untitled media').slice(0, 140),
    caption: String(body.caption || '').slice(0, 10000),
    fileName: safeUploadName(body.fileName || 'milan-media'),
    mimeType: String(body.mimeType || 'application/octet-stream').split(';')[0].toLowerCase() || 'application/octet-stream',
    tags: Array.isArray(body.tags) ? body.tags : [],
    accessMode: String(body.accessMode || 'private'),
    sharedWithDids: Array.isArray(body.sharedWithDids) ? body.sharedWithDids : []
  };
}

router.post('/media/chunk/init', auth, (req, res) => {
  try {
    cleanupOldUploadSessions();
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const limit = Number(process.env.MAX_MEDIA_BYTES || 5000 * 1024 * 1024);
    const sizeBytes = Number(req.body?.sizeBytes || 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return res.status(400).json({ error: 'Valid file size is required.' });
    if (sizeBytes > limit) return res.status(413).json({ error: `Media exceeds the configured upload limit of ${Math.round(limit / 1024 / 1024)} MB.` });
    const chunkBytes = Math.max(1024 * 1024, Math.min(Number(req.body?.chunkBytes || DEFAULT_CHUNK_BYTES), MAX_CHUNK_BYTES));
    const totalChunks = Math.ceil(sizeBytes / chunkBytes);
    const id = crypto.randomUUID();
    const meta = normalizeUploadMeta(req.body || {});
    const session = {
      id,
      userId: req.userId,
      ownerDid: u.user.did,
      sizeBytes,
      chunkBytes,
      totalChunks,
      meta,
      received: {},
      receivedBytes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'receiving'
    };
    writeUploadSession(session);
    res.status(201).json({ ok: true, uploadId: id, chunkBytes, totalChunks, maxBytes: limit });
  } catch (err) { handleError(res, err); }
});

router.post('/media/chunk/:uploadId', auth, (req, res) => {
  const uploadId = safeUploadId(req.params.uploadId);
  const session = readUploadSession(uploadId);
  if (!session) return res.status(404).json({ error: 'Upload session not found or expired.' });
  if (session.userId !== req.userId) return res.status(403).json({ error: 'This upload session belongs to another user.' });
  const index = Number(req.headers['x-chunk-index']);
  if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) return res.status(400).json({ error: 'Invalid chunk index.' });
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_CHUNK_BYTES + 1024 * 512) return res.status(413).json({ error: 'Chunk is too large. Please retry with the app chunk uploader.' });
  const dir = uploadSessionDir(uploadId);
  fs.mkdirSync(dir, { recursive: true });
  const part = path.join(dir, `chunk-${String(index).padStart(8, '0')}.part`);
  const tmp = `${part}.${Date.now()}.tmp`;
  let bytes = 0;
  let settled = false;
  const out = fs.createWriteStream(tmp);
  const fail = (status, message) => {
    if (settled) return;
    settled = true;
    try { req.unpipe(out); } catch (_) {}
    try { out.destroy(); } catch (_) {}
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    try { req.resume(); } catch (_) {}
    if (!res.headersSent) res.status(status).json({ error: message });
  };
  req.on('aborted', () => fail(499, 'Chunk upload was cancelled.'));
  req.on('error', err => fail(400, err.message || 'Chunk upload stream failed.'));
  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > MAX_CHUNK_BYTES + 1024 * 512) fail(413, 'Chunk is too large.');
  });
  out.on('error', err => fail(500, err.message || 'Could not save chunk.'));
  out.on('finish', () => {
    if (settled) return;
    try {
      if (bytes <= 0) return fail(400, 'Empty chunk received.');
      fs.renameSync(tmp, part);
      const previous = Number(session.received[index] || 0);
      session.received[index] = bytes;
      session.receivedBytes = Math.max(0, Number(session.receivedBytes || 0) - previous + bytes);
      session.updatedAt = new Date().toISOString();
      writeUploadSession(session);
      settled = true;
      res.json({ ok: true, uploadId, index, bytes, receivedChunks: Object.keys(session.received).length, totalChunks: session.totalChunks });
    } catch (err) { fail(500, err.message || 'Could not finish chunk.'); }
  });
  req.pipe(out);
});

router.post('/media/chunk/:uploadId/complete', auth, async (req, res) => {
  const uploadId = safeUploadId(req.params.uploadId);
  const session = readUploadSession(uploadId);
  if (!session) return res.status(404).json({ error: 'Upload session not found or expired.' });
  if (session.userId !== req.userId) return res.status(403).json({ error: 'This upload session belongs to another user.' });
  const dir = uploadSessionDir(uploadId);
  const assembled = path.join(dir, 'assembled.upload');
  try {
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (Object.keys(session.received || {}).length !== session.totalChunks) {
      return res.status(409).json({ error: `Upload incomplete. Received ${Object.keys(session.received || {}).length}/${session.totalChunks} chunks.` });
    }
    try { if (fs.existsSync(assembled)) fs.unlinkSync(assembled); } catch (_) {}
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(assembled, { flags: 'w' });
      let index = 0;
      let failed = false;
      const fail = (err) => {
        if (failed) return;
        failed = true;
        try { out.destroy(); } catch (_) {}
        reject(err instanceof Error ? err : new Error(String(err || 'Could not assemble upload.')));
      };
      const pipeNext = () => {
        if (failed) return;
        if (index >= session.totalChunks) return out.end();
        const part = path.join(dir, `chunk-${String(index).padStart(8, '0')}.part`);
        if (!fs.existsSync(part)) {
          const err = new Error(`Missing chunk ${index + 1}/${session.totalChunks}.`);
          err.status = 409;
          return fail(err);
        }
        const input = fs.createReadStream(part, { highWaterMark: 1024 * 1024 });
        input.on('error', fail);
        input.on('end', () => { index += 1; pipeNext(); });
        input.pipe(out, { end: false });
      };
      out.on('error', fail);
      out.on('finish', () => failed ? undefined : resolve());
      pipeNext();
    });
    const finalSize = fs.statSync(assembled).size;
    if (finalSize !== session.sizeBytes) {
      return res.status(400).json({ error: `Upload size mismatch. Expected ${session.sizeBytes} bytes but received ${finalSize} bytes.` });
    }
    const record = await dwnStore.createMediaRecordFromFile(req.userId, u.user.did, { ...session.meta, fastAccept: true, uploadMode: 'resumable-chunked' }, assembled);
    // createMediaRecordFromFile moves the assembled file, so do not delete it separately here.
    cleanupUploadSession(uploadId);
    addActivity(req.userId, 'media.record.chunked.to.dwn', { title: record.title, accessMode: record.accessMode, dwnRecordId: record.dwnRecordId, bytes: finalSize, mimeType: session.meta.mimeType, chunks: session.totalChunks });
    return res.status(201).json(record);
  } catch (err) {
    try { if (fs.existsSync(assembled)) fs.unlinkSync(assembled); } catch (_) {}
    return handleError(res, err);
  }
});

router.delete('/media/chunk/:uploadId', auth, (req, res) => {
  const uploadId = safeUploadId(req.params.uploadId);
  const session = readUploadSession(uploadId);
  if (session && session.userId !== req.userId) return res.status(403).json({ error: 'This upload session belongs to another user.' });
  cleanupUploadSession(uploadId);
  res.json({ ok: true, cancelled: true });
});

router.get('/', auth, async (req, res) => {
  try {
    const u = await current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json(await dwnStore.listVisibleRecords(u.user.did, req.query));
  } catch (err) { handleError(res, err); }
});

router.get('/stats', auth, async (req, res) => {
  try {
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json(await dwnStore.statsFor(u.user.did));
  } catch (err) { handleError(res, err); }
});

router.get('/public', auth, async (req, res) => {
  try {
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json(await dwnStore.listPublicRecords(u.user.did, req.query));
  } catch (err) { handleError(res, err); }
});

router.get('/shared-with-me', auth, async (req, res) => {
  try {
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json(await dwnStore.listSharedWithMe(u.user.did, req.query));
  } catch (err) { handleError(res, err); }
});

router.get('/dwn/status', (_req, res) => {
  res.json(dwnStore.getStatus());
});

router.get('/access/resolve-did/:did', auth, (req, res) => {
  const did = decodeURIComponent(req.params.did || '');
  const found = findUserByDid(readJson(global.usersFile, {}), did);
  if (!found) return res.status(404).json({ exists: false, error: 'DID not found locally' });
  res.json({ exists: true, did, email: found.email, display_name: found.user.profile?.display_name || '' });
});

router.post('/import', auth, async (req, res) => {
  try {
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const rows = Array.isArray(req.body.records) ? req.body.records : [];
    const imported = await dwnStore.importRecords(req.userId, u.user.did, rows);
    addActivity(req.userId, 'records.imported.to.dwn', { count: imported.length });
    res.status(201).json({ imported: imported.length, records: imported });
  } catch (err) { handleError(res, err); }
});



router.post('/media', auth, async (req, res) => {
  const tmpDir = path.join(os.tmpdir(), 'web5-dwn-uploads');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `${Date.now()}-${Math.random().toString(16).slice(2)}.upload`);
  const limit = Number(process.env.MAX_MEDIA_BYTES || 5000 * 1024 * 1024);
  const contentLength = Number(req.headers['content-length'] || 0);
  let received = 0;
  let settled = false;
  let out = null;

  const cleanup = () => {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
  };
  const fail = (status, message) => {
    if (settled) return;
    settled = true;
    try { if (out) req.unpipe(out); } catch (_) {}
    try { if (out) out.destroy(); } catch (_) {}
    cleanup();
    // Drain the remaining request body instead of hard-resetting the socket. This gives
    // browsers/XHR a proper JSON 413/400 response instead of a vague Network Error.
    try { req.resume(); } catch (_) {}
    if (!res.headersSent) res.status(status).json({ error: message });
  };
  const b64JsonHeader = (name, fallback) => {
    try { return JSON.parse(Buffer.from(String(req.headers[name] || ''), 'base64').toString('utf8')); } catch (_) { return fallback; }
  };
  const b64TextHeader = (name, fallback = '') => {
    try {
      const raw = String(req.headers[name] || '');
      if (!raw) return fallback;
      return Buffer.from(raw, 'base64').toString('utf8') || fallback;
    } catch (_) { return fallback; }
  };

  try {
    const u = await current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (contentLength && contentLength > limit) {
      return res.status(413).json({ error: `Media exceeds the configured upload limit of ${Math.round(limit / 1024 / 1024)} MB.` });
    }

    const mimeType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].toLowerCase() || 'application/octet-stream';
    out = fs.createWriteStream(tmpFile);

    req.on('aborted', () => fail(499, 'Upload was cancelled before the video was fully received.'));
    req.on('error', err => fail(err.status || 400, err.message || 'Upload stream failed.'));
    req.on('data', chunk => {
      received += chunk.length;
      if (received > limit) {
        fail(413, `Media exceeds the configured upload limit of ${Math.round(limit / 1024 / 1024)} MB.`);
      }
    });
    out.on('error', err => fail(500, err.message || 'Could not save uploaded media.'));
    out.on('finish', async () => {
      if (settled) return;
      try {
        if (!received || !fs.existsSync(tmpFile) || fs.statSync(tmpFile).size <= 0) {
          return fail(400, 'Uploaded file is empty. Please choose the video again.');
        }
        const decodedName = b64TextHeader('x-file-name', String(req.headers['x-file-name'] || 'vault-media'));
        const meta = {
          title: b64TextHeader('x-record-title', decodedName || 'Untitled media'),
          caption: b64TextHeader('x-record-caption', ''),
          fileName: decodedName || 'vault-media',
          mimeType,
          tags: b64JsonHeader('x-record-tags', []),
          accessMode: String(req.headers['x-access-mode'] || 'private'),
          sharedWithDids: b64JsonHeader('x-shared-with-dids', [])
        };
        const record = await dwnStore.createMediaRecordFromFile(req.userId, u.user.did, { ...meta, fastAccept: true, uploadMode: 'streaming-raw' }, tmpFile);
        settled = true;
        addActivity(req.userId, 'media.record.streamed.to.dwn', { title: record.title, accessMode: record.accessMode, dwnRecordId: record.dwnRecordId, bytes: received, mimeType });
        return res.status(201).json(record);
      } catch (err) {
        settled = true;
        cleanup();
        return handleError(res, err);
      }
    });
    req.pipe(out);
  } catch (err) {
    cleanup();
    handleError(res, err);
  }
});

async function streamMedia(req, res) {
  try {
    const u = await current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    // V83 urgent video rule: when the player asks for the dedicated play.mp4/universal
    // route, make one best-effort browser-safe MP4 pass before streaming. This fixes the
    // "audio plays but video is black/not visible" case caused by unsupported video codecs
    // or non-faststart mobile files, while still falling back to the original if repair fails.
    if (req.method !== 'HEAD' && (/play\.mp4$/i.test(req.path || '') || String(req.query.universal || '') === '1' || String(req.query.play || '') === 'v83')) {
      try {
        await dwnStore.ensureMediaPlayableForStream(req.userId, u.user.did, req.params.id, {
          waitMs: Number(process.env.MILAN_V83_STREAM_REPAIR_WAIT_MS || 45000),
          maxBytes: Number(process.env.MILAN_V83_STREAM_REPAIR_MAX_BYTES || 768 * 1024 * 1024)
        });
      } catch (err) {
        try { console.warn('V83 stream repair skipped:', err.message); } catch (_) {}
      }
    }

    const media = await dwnStore.getMediaStream(req.params.id, u.user.did);
    if (!media) return res.status(404).json({ error: 'Media not found' });

    const streamLocalFile = (fullPath, sourceLabel = 'app-cache') => streamRangeOrWholeFile(req, res, fullPath, media, sourceLabel);

    if (media.remoteOnly) {
      const headers = {};
      if (req.headers.range) headers.Range = req.headers.range;
      try {
        // V80 hard fix: do NOT keep a 15s AbortSignal attached to the response body.
        // In Node fetch the same signal aborts the streaming body too, which made remote
        // DWN videos play for a few seconds and then suddenly stop in desktop/mobile/APK.
        // We only use the timer while opening the upstream connection, then clear it so
        // the MP4 body can stream for as long as the video needs.
        const controller = new AbortController();
        const openTimeoutMs = Number(process.env.MEDIA_REMOTE_OPEN_TIMEOUT_MS || process.env.MEDIA_REMOTE_TIMEOUT_MS || 30000);
        const openTimer = setTimeout(() => controller.abort(), openTimeoutMs);
        const upstream = await fetch(media.remoteUrl, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, signal: controller.signal });
        clearTimeout(openTimer);
        if (upstream.ok) {
          const upstreamType = String(upstream.headers.get('content-type') || '').split(';')[0].toLowerCase();
          const safeType = browserServeMime(media, media.fallbackFullPath || '');
          res.status(upstream.status);
          for (const header of ['content-length','content-range','accept-ranges']) {
            const value = upstream.headers.get(header);
            if (value) res.setHeader(header, value);
          }
          const remoteVideoPlayRequest = isVideoMime(safeType) && (/play\.mp4$/i.test(req.path || '') || String(req.query.universal || '') === '1' || String(req.query.native_direct || '') === '1');
          res.setHeader('Content-Type', remoteVideoPlayRequest ? 'video/mp4' : ((!upstreamType || upstreamType === 'application/octet-stream' || upstreamType === 'video/quicktime') ? safeType : upstream.headers.get('content-type')));
          res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
          res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, X-Milan-Media-Source');
          res.setHeader('Cache-Control', isVideoMime(safeType) ? 'private, max-age=86400, no-transform' : (upstream.headers.get('cache-control') || 'private, max-age=3600'));
          res.setHeader('Content-Disposition', contentDisposition(req, media.fileName || 'milan-media'));
          res.setHeader('X-Accel-Buffering', 'no');
          res.setHeader('X-Milan-Media-Source', 'supabase-storage');
          if (req.method === 'HEAD') return res.end();
          const bodyStream = Readable.fromWeb(upstream.body);
          bodyStream.on('error', err => { try { if (!res.headersSent) res.status(502); res.destroy(err); } catch (_) {} });
          req.on('close', () => { try { bodyStream.destroy(); } catch (_) {} });
          return bodyStream.pipe(res);
        }
        if (!media.fallbackFullPath) return res.status(upstream.status).json({ error: `Remote DWN media read failed: ${upstream.status}` });
        res.setHeader('X-Milan-Remote-Media-Fallback', `remote-${upstream.status}`);
      } catch (err) {
        if (!media.fallbackFullPath) return res.status(502).json({ error: `Remote DWN media read failed: ${err.message}` });
        res.setHeader('X-Milan-Remote-Media-Fallback', 'remote-error');
      }
      return streamLocalFile(media.fallbackFullPath, 'app-cache-after-dwn-sync');
    }

    return streamLocalFile(media.fullPath, 'app-local-media');
  } catch (err) { handleError(res, err); }
}

router.post('/:id/media/repair', auth, async (req, res) => {
  try {
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const asyncMode = ['1','true','yes'].includes(String(req.query.async || req.body?.async || '').toLowerCase());
    if (asyncMode) {
      const queued = dwnStore.queueVideoProcessing(req.userId, u.user.did, req.params.id, 'manual-button');
      addActivity(req.userId, 'media.repair.queued.browser.safe', { recordId: req.params.id, queued: !!queued.queued, active: !!queued.active });
      return res.status(202).json({ ok: true, processing: true, ...queued });
    }
    const result = await dwnStore.repairMediaForBrowser(req.userId, u.user.did, req.params.id);
    addActivity(req.userId, result.repaired ? 'media.repaired.browser.safe' : 'media.repair.checked', { recordId: req.params.id, repaired: !!result.repaired, warning: result.warning || '' });
    res.json({ ok: true, ...result });
  } catch (err) { handleError(res, err); }
});

router.get('/:id/media/debug', auth, async (req, res) => {
  try {
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const record = await dwnStore.getRecord(req.params.id, u.user.did);
    const media = await dwnStore.getMediaStream(req.params.id, u.user.did).catch(err => ({ error: err.message }));
    res.json({ ok: true, recordId: req.params.id, dataFormat: record.dataFormat, mediaUrl: record.mediaUrl, mediaCompatibility: record.mediaCompatibility || null, media: media ? { mimeType: media.mimeType, fileName: media.fileName, sizeBytes: media.sizeBytes, remoteOnly: !!media.remoteOnly, localFileReady: !!media.fullPath, fallbackReady: !!media.fallbackFullPath, error: media.error || '' } : null });
  } catch (err) { handleError(res, err); }
});

router.get('/:id/media/status', auth, async (req, res) => {
  try {
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const watchdog = dwnStore.ensureVideoProcessing(req.userId, u.user.did, req.params.id);
    const record = await dwnStore.getRecord(req.params.id, u.user.did);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    const media = record.data?.media || {};
    const compat = record.mediaCompatibility || {};
    const processingStatus = media.processingStatus || compat.processingStatus || (media.processing ? 'processing' : 'ready');
    const processing = !!(media.processing || compat.processing || processingStatus === 'processing' || processingStatus === 'queued');
    const ready = media.previewCategory === 'video' ? (!!media.browserPlayable && !processing && processingStatus === 'ready') : true;
    res.json({ ok: true, ready, processing, processingStatus, record, media, mediaCompatibility: compat, watchdog: { queued: !!watchdog.queued, active: !!watchdog.active, ageMs: watchdog.ageMs || 0, timeoutMs: watchdog.timeoutMs || 0, timedOut: !!watchdog.timedOut } });
  } catch (err) { handleError(res, err); }
});

router.head('/:id/media/play.mp4', auth, streamMedia);
router.get('/:id/media/play.mp4', auth, streamMedia);
router.head('/:id/media/:fileName', auth, streamMedia);
router.get('/:id/media/:fileName', auth, streamMedia);
router.head('/:id/media', auth, streamMedia);
router.get('/:id/media', auth, streamMedia);

router.get('/:id', auth, async (req, res) => {
  try {
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const record = await dwnStore.getRecord(req.params.id, u.user.did);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    res.json(record);
  } catch (err) { handleError(res, err); }
});

router.post('/', auth, async (req, res) => {
  try {
    const u = await current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const record = await dwnStore.createRecord(req.userId, u.user.did, req.body);
    addActivity(req.userId, 'record.created.in.dwn', { title: record.title, accessMode: record.accessMode, dwnRecordId: record.dwnRecordId });
    res.status(201).json(record);
  } catch (err) { handleError(res, err); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const record = await dwnStore.updateRecord(req.userId, u.user.did, req.params.id, req.body);
    if (!record) return res.status(404).json({ error: 'Record not found or not owner' });
    addActivity(req.userId, 'record.updated.in.dwn', { id: record.id });
    res.json(record);
  } catch (err) { handleError(res, err); }
});

router.patch('/:id/permissions', auth, async (req, res) => {
  try {
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const record = await dwnStore.updatePermissions(req.userId, u.user.did, req.params.id, req.body);
    if (!record) return res.status(404).json({ error: 'Record not found or not owner' });
    addActivity(req.userId, 'record.permissions.updated.in.dwn', { id: record.id, mode: record.accessMode });
    res.json(record);
  } catch (err) { handleError(res, err); }
});

router.post('/:id/share', auth, async (req, res) => {
  try {
    const did = String(req.body.did || '').trim();
    if (!did.startsWith('did:')) return res.status(400).json({ error: 'Valid DID required' });
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const record = await dwnStore.shareRecord(req.userId, u.user.did, req.params.id, did);
    if (!record) return res.status(404).json({ error: 'Record not found or not owner' });
    addActivity(req.userId, 'record.shared.from.dwn', { id: record.id, did });
    res.json(record);
  } catch (err) { handleError(res, err); }
});

router.delete('/:id/share/:did', auth, async (req, res) => {
  try {
    const did = decodeURIComponent(req.params.did || '');
    const u = current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const record = await dwnStore.unshareRecord(req.userId, u.user.did, req.params.id, did);
    if (!record) return res.status(404).json({ error: 'Record not found or not owner' });
    res.json(record);
  } catch (err) { handleError(res, err); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const ownerDid = String(
      req.account?.did ||
      req.did ||
      ''
    ).trim();

    if (!ownerDid) {
      return res.status(401).json({
        error: 'Authoritative user identity unavailable'
      });
    }

    const deleted = await dwnStore.deleteRecord(
      req.userId,
      ownerDid,
      req.params.id
    );

    if (!deleted) {
      return res.status(404).json({
        error: 'Record not found or not owned by current user'
      });
    }

    addActivity(req.userId, 'record.deleted.from.dwn', {
      id: req.params.id
    });

    res.json({
      deleted: true,
      storage: 'DWN',
      recordId: req.params.id
    });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
