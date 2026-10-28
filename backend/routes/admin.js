const express = require('express');
const milanDb = require('../services/milanDb');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { readJson, writeJson, cleanUsersDb, repairUsersFile } = require('../utils/store');
const dwnStore = require('../services/dwnService');
const { mailStatus, sendTestEmail } = require('../services/mailService');

const router = express.Router();

function adminAsyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function adminRequired(req, res, next) {
  const expected = String(process.env.ADMIN_TOKEN || '').trim();
  const given = String(req.headers['x-admin-token'] || '');

  if (!expected ||
      expected === 'change-this-admin-token' ||
      expected === 'milan-local-admin-token') {
    return res.status(503).json({ error: 'Admin access is not configured securely.' });
  }

  const givenBuffer = Buffer.from(given);
  const expectedBuffer = Buffer.from(expected);

  if (!given ||
      givenBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(givenBuffer, expectedBuffer)) {
    return res.status(401).json({ error: 'Admin token required' });
  }

  next();
}
function fileSizeSafe(file) { try { return fs.statSync(file).size; } catch (_) { return 0; } }
function walkSize(dir) {
  let total = 0;
  try {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) total += walkSize(full);
      else total += fileSizeSafe(full);
    }
  } catch (_) {}
  return total;
}
async function userRows() {
  const result = await milanDb.query(`
    SELECT user_id::text AS id, email, did,
           name AS "displayName",
           space_id AS "dwnSpaceId",
           created_at AS "createdAt",
           updated_at AS "updatedAt",
           email_verified AS "emailVerified"
    FROM public.users
    ORDER BY created_at DESC
  `);
  return result.rows;
}

router.get('/overview', adminRequired, adminAsyncRoute(async (_req, res) => {
  const users = await userRows();
  const status = dwnStore.getStatus();
  const recordsIndex = readJson(status.indexFile, {});
  const records = Object.values(recordsIndex).flatMap(v => Array.isArray(v) ? v : []);
  const requests = Object.values(readJson(global.requestsFile, {})).flatMap(v => Array.isArray(v) ? v : []);
  res.json({
    ok: true,
    app: 'MILAN Admin Overview',
    generatedAt: new Date().toISOString(),
    counts: {
      users: users.length,
      records: records.length,
      privateRecords: records.filter(r => r.accessMode === 'private').length,
      publicRecords: records.filter(r => r.accessMode === 'public').length,
      sharedRecords: records.filter(r => r.accessMode === 'shared_did').length,
      accessRequests: requests.length,
      pendingRequests: requests.filter(r => r.status === 'pending').length
    },
    storage: { ...status, totalBytes: walkSize(status.isolatedUsersDirectory || '') },
    privacy: {
      adminPrivatePayloadVisibility: false,
      oneUserOneDwnSpace: true,
      ownerOnlyByDefault: true,
      explicitDidSharingRequired: true
    }
  });
}));

router.get('/users', adminRequired, adminAsyncRoute(async (_req, res) => {
  const users = await userRows();
  res.json({ ok: true, totalUsers: users.length, users });
}));
router.get('/activity', adminRequired, (_req, res) => res.json(readJson(global.activityFile, {})));
router.get('/feedback', adminRequired, (_req, res) => res.json(readJson(global.feedbackFile, [])));
router.get('/security-reports', adminRequired, (_req, res) => res.json(readJson(global.securityReportsFile, [])));
router.post('/maintenance/compact', adminRequired, (_req, res) => {
  res.json({ ok: true, message: 'Local JSON/DWN compact task acknowledged. Media payloads are already stored outside index files.', at: new Date().toISOString() });
});

/* ── Transactional email: status + test send ─────────────────────── */
// Which provider is configured (no secrets exposed) + verification stats.
router.get('/mail/status', adminRequired, adminAsyncRoute(async (_req, res) => {
  const users = await userRows();
  const verified = users.filter(u => u.emailVerified === true).length;
  res.json({
    ok: true,
    mail: mailStatus(),
    accounts: { total: users.length, verified, unverified: users.length - verified },
    at: new Date().toISOString()
  });
}));

// Send a real test email to confirm delivery from support@milanlife.in.
router.post('/mail/test', adminRequired, async (req, res) => {
  const to = String((req.body && req.body.to) || req.query.to || '').trim();
  if (!to || !/^\S+@\S+\.\S+$/.test(to)) return res.status(400).json({ error: 'A valid "to" email is required' });
  const status = mailStatus();
  if (!status.configured) return res.status(400).json({ ok: false, error: 'No mail provider configured. Set RESEND_API_KEY, SENDGRID_API_KEY, or SMTP_* in your environment.', mail: status });
  const result = await sendTestEmail({ to });
  if (!result.ok) return res.status(502).json({ ok: false, error: result.error || result.reason || 'Send failed', provider: status.provider });
  res.json({ ok: true, sentTo: to, provider: result.provider, id: result.id || null, at: new Date().toISOString() });
});

module.exports = router;
