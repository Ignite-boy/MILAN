'use strict';

const express = require('express');
const bcrypt = require('../services/cryptoPool'); // bcrypt off the event loop (worker_threads)
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { mintRealUserIdentity, toPublicPortableDid } = require('../utils/did');
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
    let msg = result?.error || 'Supabase users.json sync failed';
    if (/404|No compatible route|No compatible route accepted/i.test(msg)) msg = 'Supabase sync failed. Original: ' + msg;
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
  const verificationToken = makeToken();
  const verificationCode = sixDigit();
  const verificationExpiresAt = new Date(
    Date.now() + 24 * 60 * 60 * 1000
  ).toISOString();

  // Create the user's cryptographic identity and persist the account in Supabase.
  const passwordHashPromise = bcrypt.hash(password, 10);
  const identity = await mintRealUserIdentity({ userId: id, email });
  const { did, spaceId, portableDid } = identity;

  const passwordHash = await passwordHashPromise;

  const fullInsert = {
    id,
    email,
    password_hash: passwordHash,
    name: displayName,
    did,
    space_id: spaceId,
    portable_did: portableDid || null,
    dwn_quota_bytes: 1073741824,
    email_verified: false,
    email_verification_token_hash: sha256(verificationToken),
    email_verification_code_hash: sha256(verificationCode),
    email_verification_expires_at: verificationExpiresAt
  };

  // Some existing MILAN Supabase projects may still have the older core-only
  // users schema. Try the complete mapping first, then safely fall back to the
  // core account fields when one of the optional DWN columns is unavailable.
  let { error: insertError } = await supabaseDb
    .from('users')
    .insert(fullInsert);

  if (insertError && isMissingOptionalUserColumn(insertError)) {
    const missingColumnMessage = String(insertError.message || '');

    if (/portable_did/i.test(missingColumnMessage)) {
      console.error('[auth] Encrypted DID persistence column is missing.');
      return res.status(500).json({
        error: 'Account schema must support portable_did before registration can proceed.'
      });
    }

    console.warn('[auth] Retrying registration without optional DWN columns.');
    ({ error: insertError } = await supabaseDb
      .from('users')
      .insert({
        id,
        email,
        password_hash: passwordHash,
        name: displayName,
        did,
        portable_did: portableDid || null,
        email_verified: false,
        email_verification_token_hash: sha256(verificationToken),
        email_verification_code_hash: sha256(verificationCode),
        email_verification_expires_at: verificationExpiresAt
      }));
  }

  if (insertError) {
    if (insertError.code === '23505') {
      return res.status(400).json({ error: 'Email already exists' });
    }

    console.error('[auth] Supabase users insert failed:', insertError);
    return res.status(500).json({
      error: 'Account database registration failed'
    });
  }

  console.log('[auth] account created in Supabase:', email, id);

  const verifyUrl =
    `${APP_URL()}/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;

  let emailSent = false;
  try {
    const mailResult = await sendVerificationEmail({
      to: email,
      name: displayName,
      verifyUrl,
      code: verificationCode
    });
    emailSent = mailResult?.ok === true;
    if (!emailSent) {
      console.warn('[MILAN mail] Verification email was not accepted by the provider.');
    }
  } catch (err) {
    console.warn('[MILAN mail] Registration verification email failed:', err.message);
  }

  return res.status(201).json({
    message: emailSent
      ? 'Account created. Check your email to verify your address.'
      : 'Account created, but the verification email could not be sent. Please retry from the verification page.',
    id,
    email,
    name: displayName,
    did,
    spaceId,
    emailVerified: false,
    emailVerificationRequired: true,
    emailSent,
    real: true
  });
}));

router.post('/login', authThrottle(15, 60_000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  // Select the full row so registration remains compatible with both the
  // current DWN-aware schema and older core-only users tables.
  const { data: user, error: lookupError } = await supabaseDb
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (lookupError) {
    return res.status(500).json({
      error: 'Account database unavailable',
      details: lookupError.message,
      code: lookupError.code
    });
  }
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
  if (!(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });

  if (user.email_verified !== true) {
    return res.status(403).json({
      error: 'Please verify your email before logging in.',
      emailVerificationRequired: true
    });
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email },
    secret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  const spaceId = String(
    user.space_id ||
    deriveUserSpaceId(user.id, user.email)
  ).trim();

  return res.json({
    token,
    id: user.id,
    email: user.email,
    name: user.name,
    did: user.did,
    spaceId,
    portableDid: toPublicPortableDid(user.portable_did),
    dwnQuotaBytes: Number(user.dwn_quota_bytes || 1073741824),
    profile: { display_name: String(user.name || '').trim() },
    settings: {},
    emailVerified: user.email_verified === true,
    twoFactorEnabled: false
  });
}));

router.get('/me', auth, asyncRoute(async (req, res) => {
  const { data: dbUser, error } = await supabaseDb
    .from('users')
    .select('*')
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

  if (dbUser.email_verified !== true) {
    return res.status(403).json({
      error: 'Please verify your email before continuing.',
      emailVerificationRequired: true
    });
  }

  // MILAN ONE:
  // auth/me is identity-only. Avatar persistence has exactly one source:
  // GET /api/profile -> persistent DWN profile.
  return res.json({
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    did: dbUser.did,
    spaceId: String(
      dbUser.space_id ||
      deriveUserSpaceId(dbUser.id, dbUser.email)
    ).trim(),
    portableDid: toPublicPortableDid(dbUser.portable_did),
    dwnQuotaBytes: Number(dbUser.dwn_quota_bytes || 1073741824),
    // see the note in POST /login - keeps the registered name available to
    // every client instead of falling back to the email local-part
    profile: { display_name: String(dbUser.name || '').trim() },
    settings: {},
    emailVerified: dbUser.email_verified === true,
    twoFactorEnabled: false
  });
}));

router.post('/verify-email', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const token = String(req.body.token || '');
  const code = String(req.body.code || '').trim();

  if (!email || (!token && !code)) {
    return res.status(400).json({ error: 'Email and token or code required' });
  }

  const { data: user, error: lookupError } = await supabaseDb
    .from('users')
    .select('id,email,name,email_verified,email_verification_token_hash,email_verification_code_hash,email_verification_expires_at')
    .eq('email', email)
    .maybeSingle();

  if (lookupError) {
    console.error('[auth] Email verification lookup failed:', lookupError.message);
    return res.status(500).json({ error: 'Account database unavailable' });
  }
  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired verification link' });
  }
  if (user.email_verified === true) {
    return res.json({ ok: true, alreadyVerified: true, message: 'Email already verified' });
  }

  const expiresAt = Date.parse(user.email_verification_expires_at || '');
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return res.status(400).json({ error: 'Verification link expired. Please request a new one.' });
  }

  const column = token
    ? 'email_verification_token_hash'
    : 'email_verification_code_hash';
  const proofHash = sha256(token || code);
  const storedHash = token
    ? user.email_verification_token_hash
    : user.email_verification_code_hash;

  if (!safeEqual(storedHash, proofHash)) {
    return res.status(400).json({ error: 'Invalid verification token or code' });
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseDb
    .from('users')
    .update({
      email_verified: true,
      email_verified_at: now,
      email_verification_token_hash: null,
      email_verification_code_hash: null,
      email_verification_expires_at: null
    })
    .eq('id', user.id)
    .eq('email_verified', false)
    .eq(column, proofHash)
    .gt('email_verification_expires_at', now)
    .select('id,email,name')
    .maybeSingle();

  if (updateError) {
    console.error('[auth] Email verification update failed:', updateError.message);
    return res.status(500).json({ error: 'Could not complete email verification. Please try again.' });
  }

  if (!updated) {
    const { data: latest, error: latestError } = await supabaseDb
      .from('users')
      .select('email_verified')
      .eq('id', user.id)
      .maybeSingle();

    if (!latestError && latest?.email_verified === true) {
      return res.json({ ok: true, alreadyVerified: true, message: 'Email already verified' });
    }
    return res.status(400).json({ error: 'Invalid or expired verification link' });
  }

  addActivity(updated.id, 'auth.email_verified', { email: updated.email });
  sendWelcomeEmail({
    to: updated.email,
    name: updated.name || updated.email.split('@')[0]
  }).catch(err => console.warn('[MILAN mail] Welcome email failed:', err.message));

  return res.json({ ok: true, message: 'Email verified successfully' });
}));


router.post('/resend-verification', authThrottle(6, 60_000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email required' });

  const { data: user, error: lookupError } = await supabaseDb
    .from('users')
    .select('id,email,name,email_verified')
    .eq('email', email)
    .maybeSingle();

  if (lookupError) {
    console.error('[auth] Verification resend lookup failed:', lookupError.message);
    return res.status(500).json({ error: 'Could not process verification request. Please try again.' });
  }

  // Keep the response generic so the endpoint does not reveal account existence.
  if (!user || user.email_verified === true) {
    return res.json({
      ok: true,
      message: 'If the account exists and needs verification, a verification email will be sent.'
    });
  }

  const tokenRaw = makeToken();
  const codeRaw = sixDigit();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: updated, error: updateError } = await supabaseDb
    .from('users')
    .update({
      email_verification_token_hash: sha256(tokenRaw),
      email_verification_code_hash: sha256(codeRaw),
      email_verification_expires_at: expiresAt
    })
    .eq('id', user.id)
    .eq('email_verified', false)
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('[auth] Verification resend update failed:', updateError.message);
    return res.status(500).json({ error: 'Could not process verification request. Please try again.' });
  }

  if (updated) {
    const verifyUrl =
      `${APP_URL()}/verify-email?token=${tokenRaw}&email=${encodeURIComponent(email)}`;
    try {
      const result = await sendVerificationEmail({
        to: email,
        name: user.name || email.split('@')[0],
        verifyUrl,
        code: codeRaw
      });
      if (result?.ok !== true) {
        console.warn('[MILAN mail] Resend verification email was not accepted by the provider.');
      }
    } catch (err) {
      console.warn('[MILAN mail] Resend verification email failed:', err.message);
    }
  }

  return res.json({
    ok: true,
    message: 'If the account exists and needs verification, a verification email will be sent.'
  });
}));


router.post('/forgot-password', authThrottle(8, 60_000), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const { data: user, error: lookupError } = await supabaseDb
    .from('users')
    .select('id,email,name')
    .eq('email', email)
    .maybeSingle();

  if (lookupError) {
    console.error('[auth] Password reset lookup failed:', lookupError.message);
    return res.status(503).json({ error: 'Password reset is temporarily unavailable. Please try again.' });
  }

  // Use a generic response so callers cannot discover whether an account exists.
  if (user) {
    const tokenRaw = makeToken();
    const codeRaw = sixDigit();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { data: updated, error: updateError } = await supabaseDb
      .from('users')
      .update({
        password_reset_token_hash: sha256(tokenRaw),
        password_reset_code_hash: sha256(codeRaw),
        password_reset_expires_at: expiresAt
      })
      .eq('id', user.id)
      .select('id')
      .maybeSingle();

    if (updateError || !updated) {
      console.error('[auth] Password reset credential persistence failed:', updateError?.message || 'No row updated');
      return res.status(503).json({ error: 'Password reset is temporarily unavailable. Please try again.' });
    }

    addActivity(user.id, 'auth.password_reset_requested', { email });
    const resetUrl =
      `${APP_URL()}/reset-password?token=${tokenRaw}&email=${encodeURIComponent(email)}`;

    try {
      const mailResult = await sendPasswordResetEmail({
        to: email,
        name: user.name || email.split('@')[0],
        resetUrl,
        code: codeRaw
      });

      if (mailResult?.ok !== true) {
        console.warn('[MILAN mail] Password-reset email was not accepted by the provider.');
      }
    } catch (err) {
      console.warn('[MILAN mail] Password-reset email failed:', err.message);
    }
  }

  return res.json({
    ok: true,
    message: 'If that account exists, a password-reset email has been sent.'
  });
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

  const { data: user, error: lookupError } = await supabaseDb
    .from('users')
    .select('id,email,password_reset_token_hash,password_reset_code_hash,password_reset_expires_at')
    .eq('email', email)
    .maybeSingle();

  if (lookupError) {
    console.error('[auth] Password reset validation lookup failed:', lookupError.message);
    return res.status(503).json({ error: 'Password reset is temporarily unavailable. Please try again.' });
  }
  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }

  const expiresAt = Date.parse(user.password_reset_expires_at || '');
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return res.status(400).json({ error: 'Reset link expired. Please request a new one.' });
  }

  const column = token ? 'password_reset_token_hash' : 'password_reset_code_hash';
  const proofHash = sha256(token || code);
  const storedHash = token
    ? user.password_reset_token_hash
    : user.password_reset_code_hash;

  if (!safeEqual(storedHash, proofHash)) {
    return res.status(400).json({ error: 'Invalid password reset token or code' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();

  // The proof and expiry are checked again during the update, preventing
  // a consumed or expired credential from changing the password a second time.
  const { data: updated, error: updateError } = await supabaseDb
    .from('users')
    .update({
      password_hash: passwordHash,
      password_reset_token_hash: null,
      password_reset_code_hash: null,
      password_reset_expires_at: null,
      updated_at: now
    })
    .eq('id', user.id)
    .eq(column, proofHash)
    .gt('password_reset_expires_at', now)
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('[auth] Password reset update failed:', updateError.message);
    return res.status(503).json({ error: 'Could not reset the password. Please try again.' });
  }
  if (!updated) {
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }

  addActivity(user.id, 'auth.password_reset', { email });
  return res.json({ ok: true, message: 'Password reset successfully' });
}));


module.exports = router;
