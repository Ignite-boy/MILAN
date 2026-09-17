const { realDwnEngine } = require('../services/realDwnEngine');
const realDwn = require('../services/realDwnNodeClient');
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const auth = require('../middleware/auth');
const { readJson, writeJson, writeJsonAndSync, findUserById, addActivity } = require('../utils/store');
const MINI_DWN_ENDPOINT = (
  process.env.MINI_DWN_ENDPOINT ||
  `${process.env.MILAN_LIVE_DWN_BASE || 'https://milan-app-pzhf.onrender.com'}/api/dwn`
).replace(/\/$/, '');

const router = express.Router();
const uploadDp = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 900000 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\\//i.test(file.mimetype));
  }
});

const supabaseDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function resolveAccount(req, users) {
  // Always prefer the local account record first because it contains
  // the user's persistent DWN mapping and raw seed required for reads/writes.
  const email = String(req.userEmail || '').trim().toLowerCase();
  const userId = String(req.userId || '').trim();

  let localUser = email ? users[email] : null;

  if (!localUser && userId) {
    const localEntry = Object.values(users).find(
      user => String(user?.id || '').trim() === userId
    );
    if (localEntry) {
      localUser = localEntry;
    }
  }

  if (localUser && (!userId || !localUser.id || String(localUser.id) === userId)) {
    return {
      email: String(localUser.email || email).trim().toLowerCase(),
      user: {
        ...localUser,
        id: localUser.id || userId,
        email: localUser.email || email,
        did: localUser.did
      }
    };
  }

  const byId = await supabaseDb
    .from('users')
    .select('id,email,name,did')
    .eq('id', req.userId)
    .maybeSingle();

  if (!byId.error && byId.data) {
    return {
      email: byId.data.email,
      user: {
        ...(users[byId.data.email] || {}),
        id: byId.data.id,
        email: byId.data.email,
        name: byId.data.name,
        did: byId.data.did
      }
    };
  }

  if (email) {
    const byEmail = await supabaseDb
      .from('users')
      .select('id,email,name,did')
      .eq('email', email)
      .maybeSingle();

    if (!byEmail.error && byEmail.data) {
      return {
        email: byEmail.data.email,
        user: {
          ...(users[byEmail.data.email] || {}),
          id: byEmail.data.id,
          email: byEmail.data.email,
          name: byEmail.data.name,
          did: byEmail.data.did
        }
      };
    }
  }

  return null;
}

function profileRecordId(did) {
  return `profile-picture:${did}`;
}

function dataUrlToDwn(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;

  const mime = match[1].toLowerCase();
  const base64 = match[2].replace(/\s+/g, '');
  const bytes = Buffer.from(base64, 'base64');

  if (!bytes.length) return null;
  if (bytes.length > 900000) {
    throw new Error('Use a profile picture under 900 KB.');
  }

  const encodedData = bytes.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return { mime, bytes, encodedData };
}

async function miniDwnProcess(target, message, encodedData) {
  const maxAttempts = 4;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${MINI_DWN_ENDPOINT}/json-rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer milan-v49-embedded-production-dwn-key'
        },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `${Date.now()}-${attempt}`,
          method: 'dwn.processMessage',
          params: {
            target,
            message,
            ...(encodedData ? { encodedData } : {})
          }
        })
      });

      const contentType = String(
        response.headers.get('content-type') || ''
      ).toLowerCase();

      const raw = await response.text();

      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        const preview = raw.replace(/\s+/g, ' ').slice(0, 220);
        throw new Error(
          `Mini-DWN returned non-JSON (${response.status}, ${contentType || 'no content-type'}): ${preview}`
        );
      }

      const reply = body?.result?.reply;
      const status = reply?.status?.code;

      if ([408, 425, 429, 500, 502, 503, 504, 530].includes(response.status)) {
        if (attempt < maxAttempts) {
          const retryAfterHeader = response.headers.get('retry-after');
          const retryAfterSeconds = Number(retryAfterHeader);

          const waitMs =
            Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
              ? Math.min(retryAfterSeconds * 1000, 10000)
              : Math.min(500 * (2 ** (attempt - 1)), 4000);

          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }

        throw new Error(
          `Mini-DWN HTTP ${response.status} after ${maxAttempts} attempts`
        );
      }

      if (!response.ok) {
        throw new Error(`Mini-DWN HTTP ${response.status}`);
      }

      if (status >= 400) {
        throw new Error(
          reply?.status?.detail || `Mini-DWN status ${status}`
        );
      }

      return reply || {};
    } catch (err) {
      lastError = err;

      const messageText = String(err?.message || err);

      const transient =
        /Mini-DWN HTTP (408|425|429|500|502|503|504|530)/.test(messageText) ||
        /timed out|aborted|ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(messageText);

      if (!transient || attempt >= maxAttempts) {
        throw err;
      }

      const waitMs = Math.min(500 * (2 ** (attempt - 1)), 4000);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error('Mini-DWN request failed');
}

async function writeProfilePicture(did, file, user) {
  if (!file?.buffer?.length) {
    throw new Error('Profile picture file is missing.');
  }

  if (!user?.dwn?.spaceId || !did) {
    throw new Error('User DWN space is unavailable.');
  }

  const recordId = profileRecordId(did);
  const spaceId = String(user.dwn.spaceId).trim();

  const mediaPath =
    `/api/dwn/media/write/${encodeURIComponent(spaceId)}/${encodeURIComponent(recordId)}`;

  const media = await realDwn.putBuffer(
    mediaPath,
    file.buffer,
    file.mimetype,
    {
      'X-Milan-File-Name': encodeURIComponent(file.originalname || `${recordId}.jpg`)
    }
  );

  const record = {
    id: recordId,
    title: 'MILAN Profile Picture',
    schema: 'profile-picture',
    accessMode: 'private',
    dataFormat: file.mimetype,
    fileName: file.originalname || `${recordId}.jpg`,
    mediaPath,
    mediaBytes: file.buffer.length,
    dateCreated: new Date().toISOString(),
    dateModified: new Date().toISOString()
  };

  const metadata = await realDwn.postJson('/api/dwn/records/write', {
    spaceId,
    ownerDid: did,
    userId: user.id,
    record
  });

  return {
    recordId,
    dwnRecordId: recordId,
    spaceId,
    mime: file.mimetype,
    fileName: file.originalname || `${recordId}.jpg`,
    persistedInDwn: true,
    media,
    metadata
  };
}

function queueProfilePictureSync(did, dataUrl, recordId) {
  // Deliberately do not await this. The API response can return as soon as
  // the local profile is safely persisted; Mini-DWN sync continues in-process.
  void writeProfilePicture(did, dataUrl)
    .then(() => {
      console.log('[profile] background DP sync complete:', recordId);
    })
    .catch(error => {
      console.warn('[profile] background DP sync pending/failed:', error.message);
    });
}

async function readProfilePicture(user) {
  const did = String(user?.did || '').trim();
  const spaceId = String(user?.dwn?.spaceId || '').trim();

  if (!did) throw new Error('User DID is missing.');
  if (!spaceId) throw new Error('User DWN space is missing.');

  const recordId = profileRecordId(did);
  const mediaPath =
    `/api/dwn/media/read/${encodeURIComponent(spaceId)}/${encodeURIComponent(recordId)}`;

  try {
    const result = await realDwn.getBuffer(mediaPath);

    return {
      recordId,
      avatar: `data:${result.contentType || user?.profile?.avatarMime || 'image/jpeg'};base64,${result.buffer.toString('base64')}`,
      mime: result.contentType || user?.profile?.avatarMime || 'image/jpeg',
      source: 'production-dwn-media'
    };
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function readProfilePictureFromUserDwn(user, recordId) {
  const did = String(user?.did || '').trim();
  if (!did) throw new Error('User DID is missing.');

  const result = await readProfilePicture(user);

  if (!result) return null;

  return {
    ...result,
    recordId: result.recordId || recordId
  };
}

async function writeDurableProfileAvatar(email, avatar, recordId, did) {
  const { syncDatabaseSnapshot } = require('../services/cloudDwnRegistry');

  const result = await syncDatabaseSnapshot(
    profileAvatarSnapshotName(email),
    {
      avatar,
      recordId,
      ownerDid: did,
      updatedAt: new Date().toISOString()
    }
  );

  if (!result || result.ok === false) {
    throw new Error(
      result?.error ||
      result?.skipped ||
      'Durable profile avatar sync failed.'
    );
  }

  return result;
}

router.get('/', auth, async (req, res) => {
  const users = readJson(global.usersFile, {});
  const found = await resolveAccount(req, users);

  if (!found) {
    return res.status(404).json({ error: 'User not found' });
  }

  let avatar = '';

  // PRIMARY SOURCE: persistent DWN record for this user.
  try {
    const dwnPicture = await readProfilePictureFromUserDwn(
      found.user,
      profileRecordId(found.user.did)
    );

    if (dwnPicture?.avatar) {
      avatar = dwnPicture.avatar;

      found.user.profile = {
        ...(found.user.profile || {}),
        avatar,
        avatarRecordId: dwnPicture.recordId,
        avatarSync: 'synced',
        updated_at: new Date().toISOString()
      };

      users[found.email] = found.user;

      try {
        writeJson(global.usersFile, users);
      } catch (_) {}
    }
  } catch (error) {
    console.warn('[profile] DWN avatar read failed:', error.message);
  }

  // FALLBACK: retain the last known avatar so UI never blanks during
  // a temporary DWN/network failure.
  if (!avatar) {
    avatar = String(found.user.profile?.avatar || '').trim();
  }

  return res.json({
    ...(found.user.profile || {}),
    avatar,
    avatarRecordId:
      found.user.profile?.avatarRecordId ||
      profileRecordId(found.user.did),
    avatarSync: avatar ? 'synced' : 'missing'
  });
});
router.put('/', auth, uploadDp.single('avatar'), async (req, res) => {
  const users = readJson(global.usersFile, {});
  const found = await resolveAccount(req, users);

  if (!found) {
    return res.status(404).json({ error: 'User not found' });
  }

  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Profile picture file is required.'
      });
    }

    const saved = await writeProfilePicture(
      found.user.did,
      req.file,
      found.user
    );

    const avatarDataUrl =
      `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    found.user.profile = {
      ...(found.user.profile || {}),
      avatar: avatarDataUrl,
      avatarRecordId: saved.dwnRecordId,
      avatarMime: saved.mime,
      avatarFileName: saved.fileName,
      avatarSync: 'synced',
      updated_at: new Date().toISOString()
    };

    users[found.email] = found.user;
    writeJson(global.usersFile, users);

    addActivity(req.userId, 'profile.updated');

    return res.status(200).json({
      avatarRecordId: saved.dwnRecordId,
      avatarMime: saved.mime,
      avatarFileName: saved.fileName,
      avatarSync: 'synced'
    });
  } catch (error) {
    console.error('[profile] original-file DP save failed:', error.message);
    return res.status(502).json({
      error: 'Profile picture save failed',
      detail: error.message
    });
  }
});

router.put('/settings', auth, (req, res) => {
  const users = readJson(global.usersFile);
  const found = findUserById(users, req.userId);

  if (!found) {
    return res.status(404).json({ error: 'User not found' });
  }

  found.user.settings = {
    ...(found.user.settings || {}),
    ...req.body,
    updated_at: new Date().toISOString()
  };

  users[found.email] = found.user;
  writeJson(global.usersFile, users);

  res.json(found.user.settings);
});

module.exports = router;
