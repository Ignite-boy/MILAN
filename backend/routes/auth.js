'use strict';

const express = require('express');
const bcrypt = require('../services/cryptoPool'); // bcrypt off the event loop (worker_threads)
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const milanDb = require('../services/milanDb');
const uuidv4 = () => crypto.randomUUID();
const { mintRealUserIdentity, toPublicPortableDid } = require('../utils/did');
const totp = require('../utils/totp');
const { readJson, writeJson, writeJsonAndSync, addActivity, normalizePulledSnapshot, cleanUsersDb, repairUsersFile } = require('../utils/store');
const { assignDwnEndpoint, ensureUserDwn, getDwnInfo, provisionRemoteUserDwn, pullDatabaseSnapshot } = require('../services/cloudDwnRegistry');
const auth = require('../middleware/auth');
const { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail, sendLoginAlertEmail } = require('../services/mailService');

function deriveUserSpaceId(userId = '', email = '') {
  const seed = String(userId) + '|' + String(email);
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return 'milan-' + (userId || hash).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) + '-' + hash.slice(0, 8);
}

function isMissingOptionalUserColumn(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  const message = String(error?.message || '').trim();
  return (
    /space_id|portable_did|dwn_quota_bytes/i.test(message) &&
    (
      code === 'PGRST204' ||
      code === '42703' ||
      /column .* does not exist|could not find the .* column .* in the schema cache|schema cache/i.test(message)
    )
  );
}

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

      writeJson(global.usersFile, mergedUsers);

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

      writeJson(global.usersFile, mergedUsers);

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
  const result = await writeJsonAndSync(global.usersFile, users);
  if (!result || result.ok === false) {
    let msg = result?.error || 'Voroa PostgreSQL users snapshot sync failed';
    if (/404|No compatible route|No compatible route accepted/i.test(msg)) msg = 'Voroa PostgreSQL snapshot sync failed. Original: ' + msg;
    const err = new Error(msg); err.status = 503; throw err;
  }
  return result;
}

router.post('/register', authThrottle(10, 60_000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const name = String(req.body.name || '').trim();

  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters for production use' });

  const id = uuidv4();
  const displayName = name || email.split('@')[0];
  const verificationToken = makeToken();
  const verificationCode = sixDigit();
  const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const passwordHashPromise = bcrypt.hash(password, 10);
  const identity = await mintRealUserIdentity({ userId: id, email });
  const { did, spaceId, portableDid } = identity;
  const passwordHash = await passwordHashPromise;

  try {
    await milanDb.query(
      `INSERT INTO public.users
       (user_id, name, email, password_hash, did, space_id, portable_did,
        email_verified, email_verification_token_hash,
        email_verification_code_hash, email_verification_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10)`,
      [id, displayName, email, passwordHash, did, spaceId, portableDid || null,
       sha256(verificationToken), sha256(verificationCode), verificationExpiresAt]
    );
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email or identity already exists' });
    console.error('[auth] Voroa registration failed:', err.message);
    return res.status(500).json({ error: 'Account database registration failed' });
  }

  console.log('[auth] account created in Voroa PostgreSQL:', email, id);
  const verifyUrl = `${APP_URL()}/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
  let emailSent = false;
  try {
    const mailResult = await sendVerificationEmail({ to: email, name: displayName, verifyUrl, code: verificationCode });
    emailSent = mailResult?.ok === true;
    if (!emailSent) console.warn('[MILAN mail] Verification email was not accepted by the provider.');
  } catch (err) {
    console.warn('[MILAN mail] Registration verification email failed:', err.message);
  }

  return res.status(201).json({
    message: emailSent
      ? 'Account created. Check your email to verify your address.'
      : 'Account created, but the verification email could not be sent. Please retry from the verification page.',
    id, email, name: displayName, did, spaceId,
    emailVerified: false, emailVerificationRequired: true, emailSent, real: true
  });
}));

router.post('/login', authThrottle(15, 60_000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  let user;
  try {
    const result = await milanDb.query('SELECT * FROM public.users WHERE email = $1 LIMIT 1', [email]);
    user = result.rows[0];
  } catch (err) {
    console.error('[auth] Voroa login lookup failed:', err.message);
    return res.status(503).json({ error: 'Account database unavailable' });
  }

  if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
  if (!(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });
  if (user.email_verified !== true) {
    return res.status(403).json({
      error: 'Please verify your email before logging in.',
      emailVerificationRequired: true
    });
  }

  const userId = user.user_id;
  const token = jwt.sign(
    { userId, email: user.email },
    secret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
  const spaceId = String(user.space_id || deriveUserSpaceId(userId, user.email)).trim();

  return res.json({
    token, id: userId, email: user.email, name: user.name, did: user.did, spaceId,
    portableDid: toPublicPortableDid(user.portable_did),
    dwnQuotaBytes: Number(user.dwn_quota_bytes || 1073741824),
    profile: { display_name: String(user.name || '').trim() },
    settings: {}, emailVerified: user.email_verified === true, twoFactorEnabled: false
  });
}));

router.get('/me', auth, asyncRoute(async (req, res) => {
  let dbUser;
  try {
    const result = await milanDb.query('SELECT * FROM public.users WHERE user_id = $1 LIMIT 1', [req.userId]);
    dbUser = result.rows[0];
  } catch (err) {
    console.error('[auth] Voroa /me lookup failed:', err.message);
    return res.status(503).json({ error: 'Account database unavailable' });
  }

  if (!dbUser) return res.status(404).json({ error: 'User not found' });
  if (dbUser.email_verified !== true) {
    return res.status(403).json({
      error: 'Please verify your email before continuing.',
      emailVerificationRequired: true
    });
  }

  return res.json({
    id: dbUser.user_id, email: dbUser.email, name: dbUser.name, did: dbUser.did,
    spaceId: String(dbUser.space_id || deriveUserSpaceId(dbUser.user_id, dbUser.email)).trim(),
    portableDid: toPublicPortableDid(dbUser.portable_did),
    dwnQuotaBytes: Number(dbUser.dwn_quota_bytes || 1073741824),
    profile: { display_name: String(dbUser.name || '').trim() },
    settings: {}, emailVerified: dbUser.email_verified === true, twoFactorEnabled: false
  });
}));

router.post('/verify-email', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const token = String(req.body.token || '');
  const code = String(req.body.code || '').trim();

  if (!email || (!token && !code)) {
    return res.status(400).json({ error: 'Email and token or code required' });
  }

  let user;
  try {
    const result = await milanDb.query(
      `SELECT user_id, email, name, email_verified, email_verification_token_hash,
              email_verification_code_hash, email_verification_expires_at
       FROM public.users WHERE email = $1 LIMIT 1`, [email]
    );
    user = result.rows[0];
  } catch (err) {
    console.error('[auth] Voroa email verification lookup failed:', err.message);
    return res.status(503).json({ error: 'Account database unavailable' });
  }

  if (!user) return res.status(400).json({ error: 'Invalid or expired verification link' });
  if (user.email_verified === true) {
    return res.json({ ok: true, alreadyVerified: true, message: 'Email already verified' });
  }

  const expiresAt = Date.parse(user.email_verification_expires_at || '');
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return res.status(400).json({ error: 'Verification link expired. Please request a new one.' });
  }

  const proofHash = sha256(token || code);
  const storedHash = token ? user.email_verification_token_hash : user.email_verification_code_hash;
  if (!safeEqual(storedHash, proofHash)) {
    return res.status(400).json({ error: 'Invalid verification token or code' });
  }

  let updated;
  try {
    const result = await milanDb.query(
      `UPDATE public.users
       SET email_verified = true, email_verified_at = NOW(),
           email_verification_token_hash = NULL,
           email_verification_code_hash = NULL,
           email_verification_expires_at = NULL
       WHERE user_id = $1 AND email_verified = false
         AND email_verification_expires_at > NOW()
         AND ${token ? 'email_verification_token_hash' : 'email_verification_code_hash'} = $2
       RETURNING user_id, email, name`,
      [user.user_id, proofHash]
    );
    updated = result.rows[0];
  } catch (err) {
    console.error('[auth] Voroa email verification update failed:', err.message);
    return res.status(503).json({ error: 'Could not complete email verification. Please try again.' });
  }

  if (!updated) {
    const latest = await milanDb.query(
      'SELECT email_verified FROM public.users WHERE user_id = $1', [user.user_id]
    );
    if (latest.rows[0]?.email_verified === true) {
      return res.json({ ok: true, alreadyVerified: true, message: 'Email already verified' });
    }
    return res.status(400).json({ error: 'Invalid or expired verification link' });
  }

  addActivity(updated.user_id, 'auth.email_verified', { email: updated.email });
  sendWelcomeEmail({
    to: updated.email,
    name: updated.name || updated.email.split('@')[0]
  }).catch(err => console.warn('[MILAN mail] Welcome email failed:', err.message));

  return res.json({ ok: true, message: 'Email verified successfully' });
}));

router.post('/resend-verification', authThrottle(6, 60_000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email required' });

  let user;
  try {
    const result = await milanDb.query(
      'SELECT user_id, email, name, email_verified FROM public.users WHERE email = $1 LIMIT 1',
      [email]
    );
    user = result.rows[0];
  } catch (err) {
    console.error('[auth] Voroa verification resend lookup failed:', err.message);
    return res.status(503).json({ error: 'Could not process verification request. Please try again.' });
  }

  const genericMessage = 'If the account exists and needs verification, a verification email will be sent.';
  if (!user || user.email_verified === true) return res.json({ ok: true, message: genericMessage });

  const tokenRaw = makeToken();
  const codeRaw = sixDigit();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  let updated;
  try {
    const result = await milanDb.query(
      `UPDATE public.users
       SET email_verification_token_hash = $1,
           email_verification_code_hash = $2,
           email_verification_expires_at = $3
       WHERE user_id = $4 AND email_verified = false
       RETURNING user_id`,
      [sha256(tokenRaw), sha256(codeRaw), expiresAt, user.user_id]
    );
    updated = result.rows[0];
  } catch (err) {
    console.error('[auth] Voroa verification resend update failed:', err.message);
    return res.status(503).json({ error: 'Could not process verification request. Please try again.' });
  }

  if (updated) {
    const verifyUrl = `${APP_URL()}/verify-email?token=${tokenRaw}&email=${encodeURIComponent(email)}`;
    try {
      const result = await sendVerificationEmail({
        to: email, name: user.name || email.split('@')[0], verifyUrl, code: codeRaw
      });
      if (result?.ok !== true) console.warn('[MILAN mail] Resend verification email was not accepted by the provider.');
    } catch (err) {
      console.warn('[MILAN mail] Resend verification email failed:', err.message);
    }
  }

  return res.json({ ok: true, message: genericMessage });
}));

router.post('/forgot-password', authThrottle(8, 60_000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  let user;
  try {
    const result = await milanDb.query(
      'SELECT user_id, email, name FROM public.users WHERE email = $1 LIMIT 1',
      [email]
    );
    user = result.rows[0];
  } catch (err) {
    console.error('[auth] Voroa password-reset lookup failed:', err.message);
    return res.status(503).json({ error: 'Password reset is temporarily unavailable. Please try again.' });
  }

  if (user) {
    const tokenRaw = makeToken();
    const codeRaw = sixDigit();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    try {
      const result = await milanDb.query(
        `UPDATE public.users
         SET password_reset_token_hash = $1,
             password_reset_code_hash = $2,
             password_reset_expires_at = $3,
             updated_at = now()
         WHERE user_id = $4
         RETURNING user_id`,
        [sha256(tokenRaw), sha256(codeRaw), expiresAt, user.user_id]
      );
      if (!result.rows[0]) throw new Error('No user row updated');
    } catch (err) {
      console.error('[auth] Voroa password-reset persistence failed:', err.message);
      return res.status(503).json({ error: 'Password reset is temporarily unavailable. Please try again.' });
    }

    addActivity(user.user_id, 'auth.password_reset_requested', { email });
    const resetUrl = `${APP_URL()}/reset-password?token=${tokenRaw}&email=${encodeURIComponent(email)}`;

    try {
      const mailResult = await sendPasswordResetEmail({
        to: email, name: user.name || email.split('@')[0], resetUrl, code: codeRaw
      });
      if (mailResult?.ok !== true) {
        console.warn('[MILAN mail] Password-reset email was not accepted by the provider.');
      }
    } catch (err) {
      console.warn('[MILAN mail] Password-reset email failed:', err.message);
    }
  }

  return res.json({ ok: true, message: 'If that account exists, a password-reset email has been sent.' });
}));

router.post('/reset-password', authThrottle(15, 60_000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const token = String(req.body.token || '');
  const code = String(req.body.code || '').trim();
  const password = String(req.body.password || '');

  if (!email || (!token && !code)) {
    return res.status(400).json({ error: 'Email and reset token or code required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  let user;
  try {
    const result = await milanDb.query(
      `SELECT user_id, email, password_reset_token_hash,
              password_reset_code_hash, password_reset_expires_at
       FROM public.users WHERE email = $1 LIMIT 1`,
      [email]
    );
    user = result.rows[0];
  } catch (err) {
    console.error('[auth] Voroa password-reset validation failed:', err.message);
    return res.status(503).json({ error: 'Password reset is temporarily unavailable. Please try again.' });
  }

  if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' });

  const expiresAt = Date.parse(user.password_reset_expires_at || '');
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return res.status(400).json({ error: 'Reset link expired. Please request a new one.' });
  }

  const column = token ? 'password_reset_token_hash' : 'password_reset_code_hash';
  const proofHash = sha256(token || code);
  const storedHash = token ? user.password_reset_token_hash : user.password_reset_code_hash;

  if (!safeEqual(storedHash, proofHash)) {
    return res.status(400).json({ error: 'Invalid password reset token or code' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const result = await milanDb.query(
      `UPDATE public.users
       SET password_hash = $1,
           password_reset_token_hash = NULL,
           password_reset_code_hash = NULL,
           password_reset_expires_at = NULL,
           updated_at = now()
       WHERE user_id = $2
         AND ${column} = $3
         AND password_reset_expires_at > now()
       RETURNING user_id`,
      [passwordHash, user.user_id, proofHash]
    );
    if (!result.rows[0]) {
      return res.status(400).json({ error: 'Reset link expired or already used. Please request a new one.' });
    }
    addActivity(user.user_id, 'auth.password_reset_completed', { email });
    return res.json({ ok: true, message: 'Password has been reset successfully. You can now log in.' });
  } catch (err) {
    console.error('[auth] Voroa password-reset update failed:', err.message);
    return res.status(503).json({ error: 'Password reset is temporarily unavailable. Please try again.' });
  }
}));



module.exports = router;
