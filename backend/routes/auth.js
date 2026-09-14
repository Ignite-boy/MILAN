'use strict';

const express = require('express');
const bcrypt = require('../services/cryptoPool'); // bcrypt off the event loop (worker_threads)
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { generateDIDAndRawSeed, mintRealUserIdentity } = require('../utils/did');
const totp = require('../utils/totp');
const { readJson, writeJson, writeJsonAndSync, addActivity, normalizePulledSnapshot, cleanUsersDb, repairUsersFile } = require('../utils/store');
const { assignDwnEndpoint, ensureUserDwn, getDwnInfo, provisionRemoteUserDwn, pullDatabaseSnapshot } = require('../services/cloudDwnRegistry');
const auth = require('../middleware/auth');
const { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail, sendLoginAlertEmail } = require('../services/mailService');
const { createClient } = require('@supabase/supabase-js');
const supabaseDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const router = express.Router();

const JWT_SECRET = require('../utils/jwtSecret');
const secret = () => JWT_SECRET;
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const _authHits = new Map();
function authThrottle(max, windowMs) {
  return (req, res, next) => {
    const ip = clientIp(req);
    const now = Date.now();
    const b = _authHits.get(ip) || { count: 0, reset: now + windowMs };
    if (now > b.reset) { b.count = 0; b.reset = now + windowMs; }
    b.count += 1; _authHits.set(ip, b);
    if (b.count > max) {
      const retry = Math.ceil((b.reset - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: `Too many attempts. Try again in ${retry}s.` });
    }
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of _authHits) if (now > v.reset) _authHits.delete(k); }, 5 * 60_000).unref?.();

const APP_URL = () => (process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || 'https://milanlife.in').replace(/\/+$/, '');
const sha256 = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const sixDigit = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
function makeToken() { return crypto.randomBytes(32).toString('hex'); }
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || 'unknown'; }
function findUserEntryByEmail(users, email) { return users[email] ? [email, users[email]] : null; }
function safeEqual(a, b) {
  try { const ba = Buffer.from(String(a), 'hex'), bb = Buffer.from(String(b), 'hex'); return ba.length === bb.length && crypto.timingSafeEqual(ba, bb); }
  catch (_) { return false; }
}

async function loadUsersFromDwn() {
  try {
    const pulled = await pullDatabaseSnapshot('users.json');
    const normalized = normalizePulledSnapshot(pulled);
    if (normalized.ok && normalized.data && typeof normalized.data === 'object' && !Array.isArray(normalized.data)) {
      global.__milanHydratingFromDwn = true;
      const remoteUsers = cleanUsersDb(normalized.data);
      const localUsers = cleanUsersDb(readJson(global.usersFile, {}));

      // NEVER let a partial/older remote snapshot erase users that already
      // exist locally. Remote records win for the same email; local-only
      // users are preserved until their next authoritative sync.
      const mergedUsers = {
        ...localUsers,
        ...remoteUsers
      };

      if (!process.env.VERCEL) {
        writeJson(global.usersFile, mergedUsers);
      }

      return mergedUsers;
    }
  } catch (err) { console.warn('DWN users hydrate failed:', err.message); }
  finally { global.__milanHydratingFromDwn = false; }
  repairUsersFile(global.usersFile);
  return cleanUsersDb(readJson(global.usersFile, {}));
}

async function loadUsersFromDwnDetailed() {
  try {
    const pulled = await pullDatabaseSnapshot('users.json');
    const normalized = normalizePulledSnapshot(pulled);
    if (normalized.ok && normalized.data && typeof normalized.data === 'object' && !Array.isArray(normalized.data)) {
      global.__milanHydratingFromDwn = true;
      const remoteUsers = cleanUsersDb(normalized.data);
      const localUsers = cleanUsersDb(readJson(global.usersFile, {}));

      // Preserve local-only users when the remote snapshot is incomplete.
      // Remote data remains authoritative for records present remotely.
      const mergedUsers = {
        ...localUsers,
        ...remoteUsers
      };

      if (!process.env.VERCEL) {
        writeJson(global.usersFile, mergedUsers);
      }

      return {
        users: mergedUsers,
        fromRemote: true,
        missing: Object.keys(mergedUsers).length === 0
      };
    }
    repairUsersFile(global.usersFile);
    return { users: cleanUsersDb(readJson(global.usersFile, {})), fromRemote: false, missing: true, error: normalized.error };
  } catch (err) {
    repairUsersFile(global.usersFile);
    return { users: cleanUsersDb(readJson(global.usersFile, {})), fromRemote: false, missing: false, error: err.message };
  } finally { global.__milanHydratingFromDwn = false; }
}

async function persistUsersAuthoritatively(users) {
  let result;
  if (process.env.VERCEL) {
    const { syncDatabaseSnapshot } = require('../services/cloudDwnRegistry');
    result = await syncDatabaseSnapshot('users.json', users);
  } else result = await writeJsonAndSync(global.usersFile, users);
  if (!result || result.ok === false) {
    let msg = result?.error || 'Production DWN users.json sync failed';
    if (/404|No compatible route|No compatible route accepted/i.test(msg)) msg = 'Production DWN sync failed; verify the configured remote DWN endpoint. Original: ' + msg;
    const err = new Error(msg); err.status = 503; throw err;
  }
  return result;
}

router.post('/register', authThrottle(10, 60_000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const name = String(req.body.name || '').trim();

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  if (password.length < 8) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters for production use'
    });
  }

  const id = uuidv4();
  const displayName = name || email.split('@')[0];

  // Real DWN identity + password hash + one authoritative Supabase INSERT.
  const passwordHashPromise = bcrypt.hash(password, 10);
  const identity = await mintRealUserIdentity({ userId: id, email });
  const { did, spaceId, portableDid } = identity;
  const passwordHash = await passwordHashPromise;

  const { error: insertError } = await supabaseDb
    .from('users')
    .insert({
      id,
      email,
      password_hash: passwordHash,
      name: displayName,
      did
    });

  if (insertError) {
    if (insertError.code === '23505') {
      return res.status(400).json({ error: 'Email already exists' });
    }

    console.error('[auth] Supabase users insert failed:', insertError);
    return res.status(500).json({
      error: 'Account database registration failed',
      details: insertError.message,
      code: insertError.code
    });
  }

  console.log('[auth] account created in Supabase:', email, id);

  // CRITICAL: keep the local user index in sync with the real DWN identity.
  // Supabase is authoritative for login, while users.json carries the
  // per-user isolated DWN space metadata required by profile persistence.
  try {
    const currentUsers = readJson(global.usersFile, {});
    currentUsers[email] = {
      ...(currentUsers[email] || {}),
      id,
      email,
      name: displayName,
      did,
      portableDid,
      dwn: {
        ...((currentUsers[email] || {}).dwn || {}),
        assignedAt: new Date().toISOString(),
        spaceId,
        endpoint: `${process.env.REAL_DWN_NODE_ENDPOINT || 'https://mini-dwn.onrender.com'}/api/isolated-dwn/${spaceId}`,
        dwnEndpoint: `${process.env.REAL_DWN_NODE_ENDPOINT || 'https://mini-dwn.onrender.com'}/api/isolated-dwn/${spaceId}`,
        mode: 'production-remote-dwn',
        isolation: 'single-user',
        realDwnConfigured: true,
        realCloudConfigured: true,
        realDwnProtocol: true,
        remoteOnly: true
      },
      dwnEndpoint: `${process.env.REAL_DWN_NODE_ENDPOINT || 'https://mini-dwn.onrender.com'}/api/isolated-dwn/${spaceId}`,
      settings: {
        ...((currentUsers[email] || {}).settings || {}),
        dwnSpaceId: spaceId,
        dwnEndpoint: `${process.env.REAL_DWN_NODE_ENDPOINT || 'https://mini-dwn.onrender.com'}/api/isolated-dwn/${spaceId}`,
        dwnIsolation: 'single-user',
        dwnMode: 'production-remote-dwn'
      },
      profile: {
        ...((currentUsers[email] || {}).profile || {}),
        avatar: '',
        avatarRecordId: `profile-picture:${did}`,
        avatarSync: 'missing'
      }
    };

    writeJson(global.usersFile, currentUsers);

    console.log('[auth] local DWN user provisioned:', email, spaceId);
  } catch (localProvisionError) {
    console.error('[auth] local DWN user provision failed:', localProvisionError.message);
    return res.status(500).json({
      error: 'DWN user provisioning failed',
      details: localProvisionError.message
    });
  }

  return res.status(201).json({
    message: 'Registered successfully',
    id,
    email,
    name: displayName,
    did,
    spaceId,
    real: true
  });
}));

router.post('/login', authThrottle(15, 60_000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const { data: user, error: lookupError } = await supabaseDb.from('users').select('id,email,password_hash,name,did').eq('email', email).maybeSingle();
  if (lookupError) return res.status(500).json({ error: 'Account database unavailable', details: lookupError.message, code: lookupError.code });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
  if (!(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ userId: user.id, email: user.email }, secret(), { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
  return res.json({ token, id: user.id, email: user.email, name: user.name, did: user.did, profile: {}, settings: {}, emailVerified: true, twoFactorEnabled: false });
}));

router.get('/me', auth, asyncRoute(async (req, res) => {
  const { data: dbUser, error } = await supabaseDb
    .from('users')
    .select('id,email,name,did')
    .eq('id', req.userId)
    .maybeSingle();

  if (error) {
    return res.status(500).json({
      error: 'Account database unavailable',
      details: error.message,
      code: error.code
    });
  }

  if (!dbUser) return res.status(404).json({ error: 'User not found' });

  // MILAN ONE:
  // auth/me is identity-only. Avatar persistence has exactly one source:
  // GET /api/profile -> persistent DWN profile.
  return res.json({
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    did: dbUser.did,
    profile: {},
    settings: {},
    emailVerified: true,
    twoFactorEnabled: false
  });
}));

router.post('/verify-email', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); const token = String(req.body.token || ''); const code = String(req.body.code || '').trim();
  if (!email || (!token && !code)) return res.status(400).json({ error: 'Email and token or code required' });
  const { users } = await loadUsersFromDwnDetailed(); const entry = findUserEntryByEmail(users, email);
  if (!entry) return res.status(400).json({ error: 'Invalid or expired verification link' });
  const [, user] = entry; if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true, message: 'Email already verified' });
  const ev = user.emailVerification; if (!ev || !ev.expires || Date.now() > ev.expires) return res.status(400).json({ error: 'Verification link expired. Please request a new one.' });
  const ok = (token && safeEqual(ev.tokenHash, sha256(token))) || (code && safeEqual(ev.codeHash, sha256(code))); if (!ok) return res.status(400).json({ error: 'Invalid verification token or code' });
  user.emailVerified = true; user.emailVerifiedAt = new Date().toISOString(); delete user.emailVerification; users[email] = user; await persistUsersAuthoritatively(users); addActivity(user.id, 'auth.email_verified', { email }); res.json({ ok: true, message: 'Email verified successfully' });
}));

router.post('/resend-verification', authThrottle(6, 60_000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); if (!email) return res.status(400).json({ error: 'Email required' }); const { users } = await loadUsersFromDwnDetailed(); const entry = findUserEntryByEmail(users, email); if (!entry) return res.json({ ok: true, message: 'If that account exists, a verification email has been sent.' }); const [, user] = entry; if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true, message: 'Email already verified' }); const tokenRaw = makeToken(); const codeRaw = sixDigit(); user.emailVerification = { tokenHash: sha256(tokenRaw), codeHash: sha256(codeRaw), expires: Date.now() + 24 * 60 * 60 * 1000 }; users[email] = user; await persistUsersAuthoritatively(users); const verifyUrl = `${APP_URL()}/verify-email?token=${tokenRaw}&email=${encodeURIComponent(email)}`; sendVerificationEmail({ to: email, name: user.profile?.display_name || email.split('@')[0], verifyUrl, code: codeRaw }).catch(err => console.warn('[MILAN mail] resend verification error:', err.message)); res.json({ ok: true, message: 'If that account exists, a verification email has been sent.' });
}));

router.post('/forgot-password', authThrottle(8, 60_000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Valid email required' }); const { users } = await loadUsersFromDwnDetailed(); const entry = findUserEntryByEmail(users, email); if (entry) { const [, user] = entry; const tokenRaw = makeToken(); const codeRaw = sixDigit(); user.passwordReset = { tokenHash: sha256(tokenRaw), codeHash: sha256(codeRaw), expires: Date.now() + 60 * 60 * 1000 }; users[email] = user; await persistUsersAuthoritatively(users); addActivity(user.id, 'auth.password_reset_requested', { email }); const resetUrl = `${APP_URL()}/reset-password?token=${tokenRaw}&email=${encodeURIComponent(email)}`; sendPasswordResetEmail({ to: email, name: user.profile?.display_name || email.split('@')[0], resetUrl, code: codeRaw }).catch(err => console.warn('[MILAN mail] reset email error:', err.message)); } res.json({ ok: true, message: 'If that account exists, a password-reset email has been sent.' });
}));

router.post('/reset-password', authThrottle(15, 60_000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); const token = String(req.body.token || ''); const code = String(req.body.code || '').trim(); const password = String(req.body.password || '');
  if (!email || (!token && !code)) return res.status(400).json({ error: 'Email and reset token or code required' }); if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const { users } = await loadUsersFromDwnDetailed(); const entry = findUserEntryByEmail(users, email); if (!entry) return res.status(400).json({ error: 'Invalid or expired reset link' }); const [, user] = entry; const pr = user.passwordReset; if (!pr || !pr.expires || Date.now() > pr.expires) return res.status(400).json({ error: 'Reset link expired. Please request a new one.' }); const ok = (token && safeEqual(pr.tokenHash, sha256(token))) || (code && safeEqual(pr.codeHash, sha256(code))); if (!ok) return res.status(400).json({ error: 'Invalid password reset token or code' }); user.password_hash = await bcrypt.hash(password, 10); delete user.passwordReset; users[email] = user; await persistUsersAuthoritatively(users); addActivity(user.id, 'auth.password_reset', { email }); res.json({ ok: true, message: 'Password reset successfully' });
}));

module.exports = router;
