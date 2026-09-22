const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { uploadToDWN, downloadFromDWN } = require('../utils/dwnStorage');
const { createClient } = require('@supabase/supabase-js');
const auth = require('../middleware/auth');
const { readJson, writeJson, writeJsonAndSync, findUserById, addActivity } = require('../utils/store');
const { ensureUserDwn, pushRecordToCloudDwn } = require('../services/cloudDwnRegistry');
const router = express.Router();
const uploadDp = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 900000 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\//i.test(file.mimetype));
  }
});

const supabaseDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function resolveAccount(req, users) {
  if (req.account?.id && req.account?.did && req.account?.spaceId) {
    return {
      email: req.account.email,
      user: {
        ...req.account,
        dwn: {
          ...(req.account.dwn || {}),
          spaceId: req.account.spaceId
        },
        settings: {
          ...(req.account.settings || {}),
          dwnSpaceId: req.account.spaceId
        }
      }
    };
  }

  // Backward-compatible fallback for non-authoritative/internal callers.
  // Authenticated production requests should always arrive with req.account.
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
    const localEntry = users[byId.data.email];
    const sameAccountLocal =
      localEntry &&
      String(localEntry.id || '') === String(byId.data.id || '')
        ? localEntry
        : {};

    return {
      email: byId.data.email,
      user: {
        ...sameAccountLocal,
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
      const localEntry = users[byEmail.data.email];
      const sameAccountLocal =
        localEntry &&
        String(localEntry.id || '') === String(byEmail.data.id || '')
          ? localEntry
          : {};

      return {
        email: byEmail.data.email,
        user: {
          ...sameAccountLocal,
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

function profileAvatarSnapshotName(email) {
  const safe = String(email || 'user').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `profile-avatar-${safe || 'user'}.json`;
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

async function writeProfilePicture(did, file, user) {
  if (!file?.buffer?.length) {
    throw new Error('Profile picture file is missing.');
  }

  const spaceId = String(
    user?.dwn?.spaceId ||
    user?.settings?.dwnSpaceId ||
    ''
  ).trim();

  if (!did) throw new Error('User DID is missing.');
  if (!spaceId) throw new Error('User DWN space is unavailable.');

  const recordId = profileRecordId(did);

  const result = await pushRecordToCloudDwn(
    {
      id: recordId,
      title: 'MILAN Profile Picture',
      schema: 'profile-picture',
      accessMode: 'private',
      dataFormat: file.mimetype || 'image/jpeg',
      binaryData: file.buffer,
      data: {
        type: 'profile-picture',
        fileName: file.originalname || `${recordId}.jpg`,
        mimeType: file.mimetype || 'image/jpeg'
      }
    },
    user
  );

  if (!result?.pushed) {
    throw new Error(
      result?.error ||
      'Supabase DWN profile picture write failed.'
    );
  }

  return {
    recordId,
    dwnRecordId: result.recordId || recordId,
    spaceId,
    mime: file.mimetype || 'image/jpeg',
    fileName: file.originalname || `${recordId}.jpg`,
    persistedInDwn: true,
    source: 'supabase-dwn',
    status: 200,
    dataSize: result.dataSize || file.buffer.length
  };
}

function dwnByteaToBuffer(value) {
  if (Buffer.isBuffer(value)) return value;

  if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }

  if (typeof value === 'string') {
    const text = value.trim();

    if (/^\\x[0-9a-f]*$/i.test(text)) {
      return Buffer.from(text.slice(2), 'hex');
    }

    try {
      return Buffer.from(text, 'base64');
    } catch (_) {
      return Buffer.from(text, 'utf8');
    }
  }

  return null;
}

async function readProfilePicture(user) {
  const did = String(user?.did || '').trim();
  const spaceId = String(
    user?.dwn?.spaceId ||
    user?.settings?.dwnSpaceId ||
    ''
  ).trim();

  if (!did) throw new Error('User DID is missing.');
  if (!spaceId) throw new Error('User DWN space is missing.');

  const recordId = profileRecordId(did);

  const { data: record, error: recordError } = await supabaseDb
    .from('dwn_records')
    .select('record_id,owner_did,data_format,data_size,deleted,metadata')
    .eq('record_id', recordId)
    .eq('owner_did', did)
    .maybeSingle();

  if (recordError) throw recordError;
  if (!record || record.deleted) return null;

  const { data: row, error: dataError } = await supabaseDb
    .from('dwn_record_data')
    .select('data')
    .eq('record_id', recordId)
    .maybeSingle();

  if (dataError) throw dataError;
  if (!row?.data) return null;

  const bytes = dwnByteaToBuffer(row.data);
  if (!bytes?.length) return null;

  const mime = record.data_format || 'image/jpeg';

  return {
    recordId,
    avatar: `data:${mime};base64,${bytes.toString('base64')}`,
    mime,
    source: 'supabase-dwn',
    spaceId,
    dataSize: record.data_size || bytes.length
  };
}

async function readProfilePictureFromUserDwn(user, recordId) {
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

  ensureUserDwn(found.user, found.email);
  users[found.email] = found.user;
  try {
    // GET /api/profile must never block on auxiliary database snapshot sync.
    // The user's profile/DWN read remains the authoritative path.
    writeJson(global.usersFile, users);
  } catch (error) {
    console.warn('[profile] DWN mapping persistence warning:', error.message);
  }

  // FAST PATH: the persisted local profile record is already updated by
  // the successful DP upload. Do not block page refresh on a remote DWN read.
  let avatar = String(found.user.profile?.avatar || '').trim();

  // Remote DWN read is only needed when the local profile has no avatar.
  // This keeps refresh fast and resilient when the remote DWN is unavailable.
  if (!avatar) {
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

  ensureUserDwn(found.user, found.email);
  users[found.email] = found.user;
  try { await writeJsonAndSync(global.usersFile, users); } catch (error) {
    console.warn('[profile] DWN mapping persistence warning:', error.message);
  }

  try {
    // The main app uploads a multipart file, while the profile-edit modal
    // submits a data URL in JSON.  Persist both paths identically; otherwise
    // the modal can show a temporary preview that disappears after reload.
    let avatarFile = req.file || null;
    const submittedAvatar = String(req.body?.avatar || '').trim();

    if (!avatarFile && submittedAvatar) {
      const parsedAvatar = dataUrlToDwn(submittedAvatar);
      if (!parsedAvatar || !/^image\//i.test(parsedAvatar.mime)) {
        return res.status(400).json({ error: 'Profile picture must be a valid image.' });
      }

      avatarFile = {
        buffer: parsedAvatar.bytes,
        mimetype: parsedAvatar.mime,
        originalname: 'profile-picture.' + (parsedAvatar.mime.split('/')[1] || 'jpg')
      };
    }

    const profile = {
      ...(found.user.profile || {}),
      ...(req.body?.display_name != null ? { display_name: String(req.body.display_name).trim() } : {}),
      ...(req.body?.username != null ? { username: String(req.body.username).trim().replace(/^@+/, '').toLowerCase() } : {}),
      ...(req.body?.bio != null ? { bio: String(req.body.bio).trim() } : {}),
      ...(req.body?.website != null ? { website: String(req.body.website).trim() } : {})
    };

    if (avatarFile) {
      const saved = await writeProfilePicture(
        found.user.did,
        avatarFile,
        found.user
      );

      profile.avatar = `data:${avatarFile.mimetype};base64,${avatarFile.buffer.toString('base64')}`;
      profile.avatarRecordId = saved.dwnRecordId;
      profile.avatarMime = saved.mime;
      profile.avatarFileName = saved.fileName;
      profile.avatarSync = 'synced';
    }

    found.user.profile = {
      ...profile,
      updated_at: new Date().toISOString()
    };

    users[found.email] = found.user;
    try {
      await writeJsonAndSync(global.usersFile, users);
    } catch (error) {
      // The profile-picture DWN record is already persisted authoritatively.
      // Do not turn a successful avatar write into a 502 because the
      // auxiliary users.json snapshot sync is temporarily unavailable.
      console.warn('[profile] users snapshot sync warning:', error.message);
    }

    addActivity(req.userId, 'profile.updated');

    return res.status(200).json({
      ...found.user.profile,
      avatarRecordId: found.user.profile.avatarRecordId || '',
      avatarMime: found.user.profile.avatarMime || '',
      avatarFileName: found.user.profile.avatarFileName || '',
      avatarSync: found.user.profile.avatarSync || 'missing'
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
