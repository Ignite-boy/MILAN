const express = require('express');
const auth = require('../middleware/auth');
const { readJson, findUserById } = require('../utils/store');
const { getDwnInfo, persistenceInfo, realUserDwnNodeStatus } = require('../services/cloudDwnRegistry');

const router = express.Router();

router.get('/health', auth, async (req, res) => {
  try {
    const users = readJson(global.usersFile, {});
    const found = findUserById(users, req.userId);

    if (!found || !found.user?.did) {
      return res.status(404).json({
        ok: false,
        state: 'disconnected',
        reason: 'user-did-not-found'
      });
    }

    const info = getDwnInfo(found.user);
    if (!info.spaceId) {
      return res.status(503).json({
        ok: false,
        state: 'disconnected',
        reason: 'missing-space-id'
      });
    }

    const node = await realUserDwnNodeStatus(found.user).catch(error => ({
      ok: false,
      error: error.message
    }));

    if (!node.ok) {
      return res.status(503).json({
        ok: false,
        state: 'disconnected',
        did: found.user.did,
        spaceId: info.spaceId,
        reason: node.error || node.reason || 'Supabase tenant unavailable',
        checkedAt: new Date().toISOString()
      });
    }

    return res.json({
      ok: true,
      state: 'connected',
      did: found.user.did,
      spaceId: info.spaceId,
      dwn: {
        nodeReady: node.nodeReady === true,
        backend: 'supabase',
        mode: 'supabase',
        remoteConfigured: false,
        remoteReachable: null,
        endpoint: process.env.SUPABASE_URL || null
      },
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      state: 'disconnected',
      reason: error.message,
      checkedAt: new Date().toISOString()
    });
  }
});

router.get('/status', (_req, res) => {
  const storage = persistenceInfo();
  res.json({
    ok: storage.mode === 'supabase' && storage.remoteWriteEnabled === true,
    backend: 'supabase',
    mode: 'supabase',
    storage,
    cloudDwn: {
      mode: 'supabase',
      backend: 'supabase',
      root: storage.root,
      endpoint: storage.remoteEndpoint || '',
      realDwnProtocol: false,
      authoritative: true,
      localFilesystemRole: 'compatibility/cache'
    }
  });
});

module.exports = router;
