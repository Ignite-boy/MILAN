const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const auth = require('../middleware/auth');
const { readJson, findUserById, findUserByDid, addActivity } = require('../utils/store');
const dwnStore = require('../services/dwnService');
const { Readable } = require('stream');
const crypto = require('crypto');
const { detectMimeFromFile } = require('../utils/mediaCompat');
const { parseByteRange } = require('../utils/byteRange');
const resumableUploadStore = require('../services/resumableUploadStore');

const { MAX_MEDIA_BYTES } = require('../services/mediaLimits');

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


function streamRangeOrBuffer(req, res, media, sourceLabel = 'postgresql', parsedRangeOverride = undefined) {
  const buffer = Buffer.isBuffer(media.buffer) ? media.buffer : null;
  const total = Number(media.sizeBytes ?? (buffer ? buffer.length : 0));
  let contentType = browserServeMime(media, media.fileName || '');
  const videoPlayRequest = isVideoMime(contentType) &&
    (/play\\.mp4$/i.test(req.path || '') ||
     String(req.query.universal || '') === '1' ||
     String(req.query.native_direct || '') === '1');
  if (videoPlayRequest) contentType = 'video/mp4';

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, X-Milan-Media-Source');
  res.setHeader('Cache-Control', isVideoMime(contentType) ? 'private, max-age=86400, no-transform' : 'private, max-age=3600, immutable');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Timing-Allow-Origin', '*');
  res.setHeader('Content-Disposition', contentDisposition(req, media.fileName || 'milan-media'));
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Milan-Media-Source', sourceLabel);

  if (req.method === 'HEAD') {
    res.setHeader('Content-Length', total);
    return res.status(200).end();
  }

  if (req.headers.range) {
    const parsed = parsedRangeOverride === undefined
      ? parseByteRange(req.headers.range, total)
      : parsedRangeOverride;
    if (!parsed || parsed.invalid) {
      res.setHeader('Content-Range', `bytes */${total}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${parsed.start}-${parsed.end}/${total}`);
    const expectedLength = parsed.end - parsed.start + 1;
    res.setHeader('Content-Length', expectedLength);
    if (media.byteRange) {
      if (!buffer ||
          media.byteRange.start !== parsed.start ||
          media.byteRange.end !== parsed.end ||
          buffer.length !== expectedLength) {
        return res.status(502).end();
      }
      return res.end(buffer);
    }
    if (!buffer) return res.status(502).end();
    return res.end(buffer.subarray(parsed.start, parsed.end + 1));
  }

  if (!buffer) return res.status(502).end();
  res.status(200);
  res.setHeader('Content-Length', total);
  return res.end(buffer);
}

// Facebook-style reliable upload layer: split large videos into small resumable chunks.
// This avoids one huge mobile request timing out while the app is deployed behind proxies.
const RESUMABLE_ROOT = path.join(os.tmpdir(), 'milan-resumable-media-uploads');
const DEFAULT_CHUNK_BYTES = Number(process.env.MILAN_UPLOAD_CHUNK_BYTES || 8 * 1024 * 1024);
const MAX_CHUNK_BYTES = Number(process.env.MILAN_UPLOAD_MAX_CHUNK_BYTES || 8 * 1024 * 1024);
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

  const file = uploadSessionFile(session.id);
  const temporaryFile = `${file}.${crypto.randomUUID()}.tmp`;

  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(session, null, 2), {
      encoding: 'utf8',
      flag: 'wx'
    });
    fs.renameSync(temporaryFile, file);
  } catch (err) {
    try { fs.unlinkSync(temporaryFile); } catch (_) {}
    throw err;
  }
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
function usesSharedUploadStorage() {
  const backend = String(process.env.MILAN_UPLOAD_STORAGE_BACKEND || '').trim().toLowerCase();
  if (backend === 'local') return false;
  if (['postgresql', 'postgresql', 'postgres', 'postgresql'].includes(backend)) return true;
  return process.env.NODE_ENV === 'production';
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

router.post('/media/chunk/init', auth, async (req, res) => {
  try {
    if (!usesSharedUploadStorage()) cleanupOldUploadSessions();
    const u = await current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const limit = MAX_MEDIA_BYTES;
    const sizeBytes = Number(req.body?.sizeBytes || 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return res.status(400).json({ error: 'Valid file size is required.' });
    if (sizeBytes > limit) return res.status(413).json({ error: `Media exceeds the configured upload limit of ${Math.round(limit / 1024 / 1024)} MB.` });
    const chunkBytes = Math.max(1024 * 1024, Math.min(Number(req.body?.chunkBytes || DEFAULT_CHUNK_BYTES), MAX_CHUNK_BYTES));
    const totalChunks = Math.ceil(sizeBytes / chunkBytes);
    const id = crypto.randomUUID();
    const meta = normalizeUploadMeta(req.body || {});
    const session = {
      id,
      recordId: crypto.randomUUID(),
      userId: req.userId,
      ownerDid: u.user.did,
      spaceId: u.user.spaceId,
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
    if (usesSharedUploadStorage()) {
      await resumableUploadStore.writeSession(session);
    } else {
      writeUploadSession(session);
    }
    res.status(201).json({ ok: true, uploadId: id, chunkBytes, totalChunks, maxBytes: limit });
  } catch (err) { handleError(res, err); }
});

router.post('/media/chunk/:uploadId', auth, async (req, res) => {
  const shared = usesSharedUploadStorage();
  const uploadId = safeUploadId(req.params.uploadId);

  let session;
  try {
    session = shared
      ? await resumableUploadStore.readSession(uploadId)
      : readUploadSession(uploadId);
  } catch (err) {
    return handleError(res, err);
  }

  if (!session) return res.status(404).json({ error: 'Upload session not found or expired.' });
  if (session.userId !== req.userId) return res.status(403).json({ error: 'This upload session belongs to another user.' });

  const index = Number(req.headers['x-chunk-index']);
  if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
    return res.status(400).json({ error: 'Invalid chunk index.' });
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_CHUNK_BYTES + 1024 * 512) {
    return res.status(413).json({ error: 'Chunk is too large. Please retry with the app chunk uploader.' });
  }

  let dir;
  try {
    dir = shared
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'milan-upload-chunk-'))
      : uploadSessionDir(uploadId);
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return handleError(res, err);
  }

  const part = path.join(dir, `chunk-${String(index).padStart(8, '0')}.part`);
  const tmp = `${part}.${crypto.randomUUID()}.tmp`;
  let bytes = 0;
  let settled = false;
  const out = fs.createWriteStream(tmp);

  const fail = (status, message) => {
    if (settled) return;
    settled = true;
    try { req.unpipe(out); } catch (_) {}
    try { out.destroy(); } catch (_) {}
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    if (shared) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
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

  out.on('finish', async () => {
    if (settled) return;
    try {
      const latest = shared
        ? await resumableUploadStore.readSession(uploadId)
        : readUploadSession(uploadId);

      if (!latest) return fail(404, 'Upload session not found or expired.');
      if (latest.userId !== req.userId) return fail(403, 'This upload session belongs to another user.');
      if (bytes <= 0) return fail(400, 'Empty chunk received.');

      const expectedBytes = index === latest.totalChunks - 1
        ? latest.sizeBytes - (index * latest.chunkBytes)
        : latest.chunkBytes;

      if (bytes !== expectedBytes) {
        return fail(400, `Chunk size mismatch. Expected ${expectedBytes} bytes but received ${bytes} bytes.`);
      }

      if (shared) {
        await resumableUploadStore.writeChunk(uploadId, index, fs.readFileSync(tmp), latest);
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
        const received = await resumableUploadStore.listChunkIndexes(uploadId);
        settled = true;
        return res.json({
          ok: true,
          uploadId,
          index,
          bytes,
          receivedChunks: received.length,
          totalChunks: latest.totalChunks
        });
      }

      fs.renameSync(tmp, part);
      const previous = Number(latest.received[index] || 0);
      latest.received[index] = bytes;
      latest.receivedBytes = Math.max(
        0,
        Number(latest.receivedBytes || 0) - previous + bytes
      );
      latest.updatedAt = new Date().toISOString();
      writeUploadSession(latest);
      settled = true;
      return res.json({
        ok: true,
        uploadId,
        index,
        bytes,
        receivedChunks: Object.keys(latest.received).length,
        totalChunks: latest.totalChunks
      });
    } catch (err) {
      return fail(err.status || 500, err.message || 'Could not finish chunk.');
    }
  });

  req.pipe(out);
});

// Lets a browser resume a large upload after a brief disconnect or reload.
// The caller must still own the session; no media bytes or private metadata are
// returned. A user can select the same file again and the client sends only
// the missing chunks.
router.get('/media/chunk/:uploadId', auth, async (req, res) => {
  const shared = usesSharedUploadStorage();
  const uploadId = safeUploadId(req.params.uploadId);

  try {
    const session = shared
      ? await resumableUploadStore.readSession(uploadId)
      : readUploadSession(uploadId);

    if (!session) return res.status(404).json({ error: 'Upload session not found or expired.' });
    if (session.userId !== req.userId) return res.status(403).json({ error: 'This upload session belongs to another user.' });

    const received = shared
      ? await resumableUploadStore.listChunkIndexes(uploadId)
      : Object.keys(session.received || {}).map(Number).filter(Number.isInteger).sort((a, b) => a - b);

    const receivedBytes = shared
      ? received.reduce((sum, index) => sum + Math.max(
          0,
          Math.min(session.chunkBytes, session.sizeBytes - index * session.chunkBytes)
        ), 0)
      : Number(session.receivedBytes || 0);

    return res.json({
      ok: true,
      uploadId,
      status: session.status || 'receiving',
      chunkBytes: session.chunkBytes,
      totalChunks: session.totalChunks,
      received,
      receivedBytes,
      updatedAt: session.updatedAt
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/media/chunk/:uploadId/complete', auth, async (req, res) => {
  const finalizeStartedAt = Date.now();
  const shared = usesSharedUploadStorage();
  const uploadId = safeUploadId(req.params.uploadId);

  let session;
  try {
    session = shared
      ? await resumableUploadStore.readSession(uploadId)
      : readUploadSession(uploadId);
  } catch (err) {
    return handleError(res, err);
  }

  if (!session) return res.status(404).json({ error: 'Upload session not found or expired.' });
  if (session.userId !== req.userId) return res.status(403).json({ error: 'This upload session belongs to another user.' });
  console.info(`[MILAN upload-finalize] phase=session_validated shared_storage=${shared} size_bytes=${session.sizeBytes} chunks=${session.totalChunks} duration_ms=${Date.now() - finalizeStartedAt}`);

  let dir;
  try {
    dir = shared
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'milan-upload-assemble-'))
      : uploadSessionDir(uploadId);
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return handleError(res, err);
  }

  const assembled = path.join(dir, 'assembled.upload');

  try {
    const u = await current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });

    const assemblyStartedAt = Date.now();
    console.info('[MILAN upload-finalize] phase=assembly_started');
    const received = shared
      ? await resumableUploadStore.listChunkIndexes(uploadId)
      : Object.keys(session.received || {}).map(Number).filter(Number.isInteger);

    const receivedSet = new Set(received);
    let completeCount = 0;
    for (let i = 0; i < session.totalChunks; i++) {
      if (receivedSet.has(i)) completeCount++;
    }

    if (completeCount !== session.totalChunks) {
      if (shared) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      }
      return res.status(409).json({
        error: `Upload incomplete. Received ${completeCount}/${session.totalChunks} chunks.`
      });
    }

    try { if (fs.existsSync(assembled)) fs.unlinkSync(assembled); } catch (_) {}

    if (shared) {
      for (let index = 0; index < session.totalChunks; index++) {
        const chunk = await resumableUploadStore.readChunk(uploadId, index, session);
        if (!chunk) {
          const err = new Error(`Missing chunk ${index + 1}/${session.totalChunks}.`);
          err.status = 409;
          throw err;
        }

        const expectedBytes = index === session.totalChunks - 1
          ? session.sizeBytes - (index * session.chunkBytes)
          : session.chunkBytes;

        if (chunk.length !== expectedBytes) {
          const err = new Error(`Chunk ${index + 1} has an invalid size.`);
          err.status = 409;
          throw err;
        }

        await fs.promises.appendFile(assembled, chunk);
      }
    } else {
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(assembled, { flags: 'w' });
        let index = 0;
        let failed = false;

        const failAssembly = err => {
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
            return failAssembly(err);
          }

          const input = fs.createReadStream(part, { highWaterMark: 1024 * 1024 });
          input.on('error', failAssembly);
          input.on('end', () => {
            index += 1;
            pipeNext();
          });
          input.pipe(out, { end: false });
        };

        out.on('error', failAssembly);
        out.on('finish', () => failed ? undefined : resolve());
        pipeNext();
      });
    }

    const finalSize = fs.statSync(assembled).size;
    console.info(`[MILAN upload-finalize] phase=assembly_complete bytes=${finalSize} duration_ms=${Date.now() - assemblyStartedAt}`);
    if (finalSize !== session.sizeBytes) {
      return res.status(400).json({
        error: `Upload size mismatch. Expected ${session.sizeBytes} bytes but received ${finalSize} bytes.`
      });
    }

    const mediaCommitStartedAt = Date.now();
    console.info(`[MILAN upload-finalize] phase=media_commit_started bytes=${finalSize}`);
    const record = await dwnStore.createMediaRecordFromFile(
      req.userId,
      u.user.did,
      { ...session.meta, recordId: session.recordId, fastAccept: true, uploadMode: 'resumable-chunked' },
      assembled
    );
    console.info(`[MILAN upload-finalize] phase=media_commit_complete duration_ms=${Date.now() - mediaCommitStartedAt}`);

    // Record persistence is the commit point. Cleanup failure must not turn a
    // confirmed record into an apparent publish failure that invites duplicates.
    if (shared) {
      try {
        await resumableUploadStore.deleteSession(uploadId);
      } catch (cleanupErr) {
        console.warn('[MILAN] Staged upload cleanup deferred:', cleanupErr?.message || cleanupErr);
      }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    } else {
      cleanupUploadSession(uploadId);
    }

    addActivity(req.userId, 'media.record.chunked.to.dwn', {
      title: record.title,
      accessMode: record.accessMode,
      dwnRecordId: record.dwnRecordId,
      bytes: finalSize,
      mimeType: session.meta.mimeType,
      chunks: session.totalChunks
    });

    return res.status(201).json(record);
  } catch (err) {
    console.warn(`[MILAN upload-finalize] phase=failed duration_ms=${Date.now() - finalizeStartedAt} status=${Number(err?.status || 500)}`);
    try { if (fs.existsSync(assembled)) fs.unlinkSync(assembled); } catch (_) {}
    if (shared) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
    return handleError(res, err);
  }
});

router.delete('/media/chunk/:uploadId', auth, async (req, res) => {
  const shared = usesSharedUploadStorage();
  const uploadId = safeUploadId(req.params.uploadId);

  try {
    const session = shared
      ? await resumableUploadStore.readSession(uploadId)
      : readUploadSession(uploadId);

    if (!session) {
      return res.status(404).json({ error: 'Upload session not found or expired.' });
    }

    if (session.userId !== req.userId) {
      return res.status(403).json({ error: 'This upload session belongs to another user.' });
    }

    if (shared) await resumableUploadStore.deleteSession(uploadId);
    else cleanupUploadSession(uploadId);

    return res.json({ ok: true, cancelled: true });
  } catch (err) {
    return handleError(res, err);
  }
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
    const u = await current(req);
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
  const limit = MAX_MEDIA_BYTES;
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
  const isPlaybackTrace = /play\.mp4$/i.test(req.path || '') ||
    String(req.query.universal || '') === '1' ||
    String(req.query.play || '') === 'v83' ||
    !!req.headers.range;
  const traceId = isPlaybackTrace ? crypto.randomUUID() : '';
  const traceStartedAt = Date.now();
  let traceStage = 'request_started';
  let traceFinished = false;
  const cleanTraceValue = value => String(value ?? 'none')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._:/%=-]/g, '_')
    .slice(0, 180);
  const trace = (phase, fields = {}) => {
    if (!isPlaybackTrace) return;
    const parts = [
      '[MILAN playback]',
      `trace_id=${traceId}`,
      `phase=${phase}`,
      `record_id=${cleanTraceValue(req.params.id || 'unknown')}`,
      `method=${cleanTraceValue(req.method)}`,
      `range=${cleanTraceValue(req.headers.range || 'none')}`,
      `elapsed_ms=${Date.now() - traceStartedAt}`,
      `stage=${cleanTraceValue(traceStage)}`
    ];
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      parts.push(`${cleanTraceValue(key)}=${cleanTraceValue(value)}`);
    }
    console.info(parts.join(' '));
  };

  if (isPlaybackTrace) {
    trace('request_started', { path: req.path || '/' });
    req.once('aborted', () => {
      traceStage = 'request_aborted';
      trace('request_aborted');
    });
    res.once('finish', () => {
      traceFinished = true;
      trace('response_finished', {
        status: res.statusCode,
        content_length: res.getHeader('Content-Length') || 'unknown',
        content_range: res.getHeader('Content-Range') || 'none',
        media_source: res.getHeader('X-Milan-Media-Source') || 'unset'
      });
    });
    res.once('close', () => {
      if (!traceFinished) {
        trace('response_closed_early', {
          status: res.statusCode,
          headers_sent: res.headersSent,
          writable_finished: res.writableFinished
        });
      }
    });
  }

  try {
    traceStage = 'user_context';
    const currentStartedAt = Date.now();
    const u = await current(req);
    trace('user_context_complete', {
      duration_ms: Date.now() - currentStartedAt,
      found: !!u
    });
    if (!u) return res.status(404).json({ error: 'User not found' });
    // Keep the play.mp4/universal streaming path non-blocking: compatibility
    // remux/transcode work is queued in the background, while available media bytes
    // begin streaming immediately through the MILAN API endpoint.
    if (req.method !== 'HEAD' && (/play\.mp4$/i.test(req.path || '') || String(req.query.universal || '') === '1' || String(req.query.play || '') === 'v83')) {
      const repairWaitMs = Number(process.env.MILAN_V83_STREAM_REPAIR_WAIT_MS || 45000);
      const repairMaxBytes = Number(process.env.MILAN_V83_STREAM_REPAIR_MAX_BYTES || 768 * 1024 * 1024);
      const prepStartedAt = Date.now();
      traceStage = 'playability_prepare';
      trace('playability_prepare_started', { wait_ms: repairWaitMs, max_bytes: repairMaxBytes });
      try {
        await dwnStore.ensureMediaPlayableForStream(req.userId, u.user.did, req.params.id, {
          waitMs: repairWaitMs,
          maxBytes: repairMaxBytes
        });
        trace('playability_prepare_complete', { duration_ms: Date.now() - prepStartedAt });
      } catch (err) {
        trace('playability_prepare_failed', {
          duration_ms: Date.now() - prepStartedAt,
          error: err.message
        });
        try { console.warn('V83 stream repair skipped:', err.message); } catch (_) {}
      }
    }

    let selectedRange;
    traceStage = 'media_metadata_read';
    const metadataReadStartedAt = Date.now();
    trace('media_metadata_read_started', {
      metadata_only: req.method === 'HEAD' || !!req.headers.range
    });
    let media = await dwnStore.getMediaStream(req.params.id, u.user.did, {
      traceId,
      metadataOnly: req.method === 'HEAD' || !!req.headers.range
    });
    trace('media_metadata_read_complete', {
      duration_ms: Date.now() - metadataReadStartedAt,
      found: !!media,
      authoritative: !!media?.authoritativeCloud,
      remote_only: !!media?.remoteOnly,
      size_bytes: media?.sizeBytes || 0,
      backend: media?.backend || 'unspecified'
    });
    if (!media) {
      trace('media_not_found');
      return res.status(404).json({ error: 'Media not found' });
    }

    if (media.authoritativeCloud && req.method !== 'HEAD' && req.headers.range) {
      const total = Number(media.sizeBytes || 0);
      const rangeHeader = req.headers.range;
      const parsed = parseByteRange(rangeHeader, total);
      selectedRange = parsed;
      if (!parsed || parsed.invalid) {
        return streamRangeOrBuffer(req, res, media, media.backend || 'postgresql', parsed);
      }

      const expectedCid = String(media.dataCid || '');
      trace('range_parsed', {
        valid: !!parsed && !parsed.invalid,
        start: parsed?.start,
        end: parsed?.end,
        total_bytes: total,
        cid_verified: expectedCid.startsWith('sha256:')
      });
      const rangeReadStartedAt = Date.now();
      traceStage = expectedCid.startsWith('sha256:') ? 'postgres_range_read' : 'full_media_read';
      trace('range_read_started', {
        start: parsed.start,
        end: parsed.end,
        expected_bytes: parsed.end - parsed.start + 1
      });
      if (expectedCid.startsWith('sha256:')) {
        media = await dwnStore.getMediaStream(req.params.id, u.user.did, {
          traceId,
          byteRange: {
            ...parsed,
            expectedSizeBytes: total,
            expectedCid
          },
          verifiedMetadata: media,
          verifiedRecordId: req.params.id,
          verifiedReaderDid: u.user.did
        });
      } else {
        // Keep the verified full-buffer path for media without a stored SHA-256 CID.
        media = await dwnStore.getMediaStream(req.params.id, u.user.did, { traceId });
      }
      trace('range_read_complete', {
        duration_ms: Date.now() - rangeReadStartedAt,
        found: !!media,
        bytes_returned: Buffer.isBuffer(media?.buffer) ? media.buffer.length : 0,
        backend: media?.backend || 'unspecified'
      });
      if (!media) return res.status(404).json({ error: 'Media not found' });
    }

    if (media.authoritativeCloud && req.method === 'HEAD') {
      traceStage = 'response_selected';
      trace('source_selected', { source: media.backend || 'postgresql', kind: 'head' });
      return streamRangeOrBuffer(req, res, media, media.backend || 'postgresql');
    }

    if (Buffer.isBuffer(media.buffer)) {
      traceStage = 'response_selected';
      trace('source_selected', {
        source: media.backend || 'buffer',
        bytes: media.buffer.length,
        range_response: !!selectedRange
      });
      return streamRangeOrBuffer(req, res, media, media.backend || 'postgresql', selectedRange);
    }

    const streamLocalFile = (fullPath, sourceLabel = 'app-cache') => {
      let sizeBytes = 0;
      try { sizeBytes = fs.statSync(fullPath).size; } catch (_) {}
      traceStage = 'local_file_stream';
      trace('source_selected', { source: sourceLabel, size_bytes: sizeBytes });
      return streamRangeOrWholeFile(req, res, fullPath, media, sourceLabel);
    };

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
        traceStage = 'remote_upstream_open';
        trace('remote_upstream_open_started', { timeout_ms: openTimeoutMs });
        const upstream = await fetch(media.remoteUrl, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, signal: controller.signal });
        clearTimeout(openTimer);
        trace('remote_upstream_headers', {
          status: upstream.status,
          ok: upstream.ok,
          content_length: upstream.headers.get('content-length') || 'unknown',
          content_range: upstream.headers.get('content-range') || 'none'
        });
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
          res.setHeader('X-Milan-Media-Source', 'remote-storage');
          if (req.method === 'HEAD') return res.end();
          const bodyStream = Readable.fromWeb(upstream.body);
          bodyStream.on('error', err => {
            trace('remote_body_error', { error: err.message });
            try { if (!res.headersSent) res.status(502); res.destroy(err); } catch (_) {}
          });
          bodyStream.on('end', () => trace('remote_body_end'));
          res.on('close', () => { if (!res.writableEnded) { try { bodyStream.destroy(); } catch (_) {} } });
          traceStage = 'remote_body_stream';
          return bodyStream.pipe(res);
        }
        if (!media.fallbackFullPath) return res.status(upstream.status).json({ error: `Remote DWN media read failed: ${upstream.status}` });
        res.setHeader('X-Milan-Remote-Media-Fallback', `remote-${upstream.status}`);
      } catch (err) {
        trace('remote_upstream_open_failed', { error: err.message });
        if (!media.fallbackFullPath) return res.status(502).json({ error: `Remote DWN media read failed: ${err.message}` });
        res.setHeader('X-Milan-Remote-Media-Fallback', 'remote-error');
      }
      return streamLocalFile(media.fallbackFullPath, 'app-cache-after-dwn-sync');
    }

    return streamLocalFile(media.fullPath, 'app-local-media');
  } catch (err) {
    trace('route_failed', { error: err.message, status: err.status || 500 });
    handleError(res, err);
  }
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
    const media = await dwnStore.getMediaStream(req.params.id, u.user.did, { metadataOnly: true }).catch(err => ({ error: err.message }));
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

router.get('/:id/media/playback-url', auth, async (req, res) => {
  try {
    const u = await current(req);
    if (!u) return res.status(404).json({ error: 'User not found' });

    // Compatibility work is queued non-blockingly. This legacy endpoint can
    // still mint a signed Storage URL for explicit direct-origin fallback callers.
    try {
      await dwnStore.ensureMediaPlayableForStream(
        req.userId,
        u.user.did,
        req.params.id,
        {
          waitMs: Number(process.env.MILAN_V83_STREAM_REPAIR_WAIT_MS || 45000),
          maxBytes: Number(process.env.MILAN_V83_STREAM_REPAIR_MAX_BYTES || 768 * 1024 * 1024)
        }
      );
    } catch (err) {
      try { console.warn('Direct playback preparation skipped:', err.message); } catch (_) {}
    }

    const playback = await dwnStore.getDirectMediaPlaybackUrl(
      req.params.id,
      u.user.did
    );
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    return res.json({
      ok: true,
      ...playback,
      expiresIn: playback.expiresIn || 3600
    });
  } catch (err) {
    return handleError(res, err);
  }
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
    const record = await dwnStore.createRecord(req.userId, u.user.did, { ...req.body, awaitCloudSync: true });
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
