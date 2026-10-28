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
        reason: node.error || node.reason || 'Voroa DID/space mapping unavailable',
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
        backend: 'voroa',
        mode: 'voroa-postgresql',
        remoteConfigured: node.storageReady === true,
        remoteReachable: null,
        endpoint: null,
        protocolReady: false
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

router.get('/status', async (_req, res) => {
  const storage = persistenceInfo();

  try {
    const probe = await require('../services/milanDb').query('SELECT 1 AS ok');
    const reachable = probe.rowCount === 1;
    const currentStorage = { ...storage, voroaDatabaseReachable: reachable };

    return res.json({
      ok: reachable,
      backend: 'voroa',
      mode: 'voroa-postgresql',
      storage: currentStorage,
      cloudDwn: {
        mode: 'voroa-postgresql',
        backend: 'voroa',
        root: storage.root,
        endpoint: '',
        realDwnProtocol: false,
        protocolReady: false,
        authoritative: false,
        authorityScope: 'Core snapshots, records, and media only',
        localFilesystemRole: 'compatibility/cache'
      }
    });
  } catch (err) {
    console.error('[milan-db] Status probe failed:', {
      code: err.code || null,
      message: err.message || 'Unknown database error',
      syscall: err.syscall || null,
      hostname: err.hostname || null,
      address: err.address || null,
      port: err.port || null
    });
    return res.status(503).json({
      ok: false,
      backend: 'voroa',
      mode: 'voroa-postgresql',
      storage: { ...storage, voroaDatabaseReachable: false },
      cloudDwn: {
        mode: 'voroa-postgresql',
        backend: 'voroa',
        root: storage.root,
        endpoint: '',
        realDwnProtocol: false,
        protocolReady: false,
        authoritative: false,
        authorityScope: 'Core snapshots, records, and media only',
        localFilesystemRole: 'compatibility/cache'
      },
      error: 'Voroa PostgreSQL connectivity check failed'
    });
  }
});

module.exports = router;
