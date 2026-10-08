'use strict';

/**
 * MILAN Settings — Facebook-style account controls, stored in each user's
 * own DWN-synced record (decentralized: no central settings DB).
 *
 * Sections: Account · Privacy · Notifications · Security (password, 2FA,
 * sessions) · Blocking · Data (export, deactivate, delete).
 */

const express = require('express');
const bcrypt = require('../services/cryptoPool'); // bcrypt off the event loop (worker_threads)
const { readJson, writeJson, writeJsonAndSync, findUserById, addActivity, cleanUsersDb, repairUsersFile } = require('../utils/store');
const totp = require('../utils/totp');
const notify = require('../services/notifyService');
const auth = require('../middleware/auth');

const router = express.Router();
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ── Defaults (Facebook-equivalent options) ──────────────────────── */
const DEFAULTS = {
  account: { language: 'en' },
  privacy: {
    profileVisibility: 'public',        // public | connections | private
    defaultPostAudience: 'private',     // public | connections | private
    whoCanFriendRequest: 'everyone',    // everyone | connections_of_connections | noone
    whoCanMessage: 'everyone',          // everyone | connections | noone
    searchableByEmail: true,
    showActivityStatus: true,
    showInPeopleDiscovery: true
  },
  notifications: {
    emailLoginAlerts: true,
    emailFriendRequests: true,
    emailComments: true,
    emailReactions: false,
    emailMentions: true,
    emailProductUpdates: false,
    pushFriendRequests: true,
    pushComments: true,
    pushReactions: true,
    pushMessages: true
  },
  travelLocation: {
    scope: 'blocked',
    duration: '15m',
    updatedAt: null
  }
};

function getUsers() { repairUsersFile(global.usersFile); return cleanUsersDb(readJson(global.usersFile, {})); }
async function saveUsers(users) {
  const r = await writeJsonAndSync(global.usersFile, users).catch(e => ({ ok: false, error: e.message }));
  if (!r || r.ok === false) { writeJson(global.usersFile, users); return { ok: true, synced: false }; }
  return { ok: true, synced: true };
}
function locate(req) {
  const users = getUsers();
  const found = findUserById(users, req.userId);
  return found ? { users, email: found.email, user: found.user } : { users, email: null, user: null };
}
function mergeSettings(user) {
  const s = user.settings || {};
  return {
    ...s,
    account: { ...DEFAULTS.account, ...(s.account || {}) },
    privacy: { ...DEFAULTS.privacy, ...(s.privacy || {}) },
    notifications: { ...DEFAULTS.notifications, ...(s.notifications || {}) },
    travelLocation: { ...DEFAULTS.travelLocation, ...(s.travelLocation || {}) },
    blocked: Array.isArray(s.blocked) ? s.blocked : [],
    status: user.status || 'active'
  };
}
// Never leak the 2FA secret / pending secret to the client.
function publicSettings(user) {
  const s = mergeSettings(user);
  return {
    account: { ...s.account, username: user.username || '', email: user.email, did: user.did },
    privacy: s.privacy,
    notifications: s.notifications,
    travelLocation: s.travelLocation,
    security: {
      twoFactorEnabled: !!(user.security && user.security.twoFactorEnabled),
      twoFactorPending: !!(user.security && user.security.pendingSecret),
      passwordChangedAt: user.passwordChangedAt || null,
      emailVerified: user.emailVerified !== false,
      tokenVersion: user.tokenVersion || 0
    },
    blocked: s.blocked,
    status: s.status,
    profile: user.profile || {}
  };
}

/* ── Read everything ─────────────────────────────────────────────── */
router.get('/', auth, asyncRoute(async (req, res) => {
  const { user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true, settings: publicSettings(user) });
}));

/* ── Account ─────────────────────────────────────────────────────── */
router.put('/account', auth, asyncRoute(async (req, res) => {
  const { users, email, user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { display_name, bio, website, avatar, cover, language, username, date_of_birth, interests } = req.body || {};
  user.profile = {
    ...(user.profile || {}),
    display_name: display_name != null ? String(display_name).trim().slice(0, 80) : (user.profile?.display_name || ''),
    bio: bio != null ? String(bio).trim().slice(0, 300) : (user.profile?.bio || ''),
    website: website != null ? String(website).trim().slice(0, 200) : (user.profile?.website || ''),
    avatar: avatar != null ? String(avatar).trim() : (user.profile?.avatar || ''),
    cover: cover != null ? String(cover).trim() : (user.profile?.cover || ''),
    date_of_birth: date_of_birth != null ? String(date_of_birth).trim().slice(0, 10) : (user.profile?.date_of_birth || ''),
    interests: interests != null ? String(interests).trim().slice(0, 300) : (user.profile?.interests || ''),
    date_of_birth: date_of_birth != null ? String(date_of_birth).trim().slice(0, 10) : (user.profile?.date_of_birth || ''),
    interests: interests != null ? String(interests).trim().slice(0, 300) : (user.profile?.interests || ''),
    updated_at: new Date().toISOString()
  };
  if (username != null) {
    const uname = String(username).trim().toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 30);
    if (uname) {
      const taken = Object.values(users).some(u => u.username === uname && u.id !== user.id);
      if (taken) return res.status(409).json({ error: 'That username is already taken' });
      user.username = uname;
    }
  }
  user.settings = { ...mergeSettings(user), account: { ...mergeSettings(user).account, language: language ? String(language).slice(0, 8) : mergeSettings(user).account.language } };
  users[email] = user;
  const r = await saveUsers(users);
  addActivity(user.id, 'settings.account_updated');
  res.json({ ok: true, synced: r.synced, settings: publicSettings(user) });
}));

/* ── Privacy ─────────────────────────────────────────────────────── */
router.put('/privacy', auth, asyncRoute(async (req, res) => {
  const { users, email, user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const cur = mergeSettings(user);
  const allowed = {
    profileVisibility: ['public', 'connections', 'private'],
    defaultPostAudience: ['public', 'connections', 'private'],
    whoCanFriendRequest: ['everyone', 'connections_of_connections', 'noone'],
    whoCanMessage: ['everyone', 'connections', 'noone']
  };
  const p = { ...cur.privacy };
  for (const k of Object.keys(allowed)) if (req.body[k] != null && allowed[k].includes(req.body[k])) p[k] = req.body[k];
  for (const k of ['searchableByEmail', 'showActivityStatus', 'showInPeopleDiscovery']) if (req.body[k] != null) p[k] = !!req.body[k];
  user.settings = { ...cur, privacy: p };
  users[email] = user;
  const r = await saveUsers(users);
  addActivity(user.id, 'settings.privacy_updated');
  res.json({ ok: true, synced: r.synced, privacy: p });
}));

/* ── Travel Location Policy ───────────────────────────────────────── */
router.put('/travel-location', auth, asyncRoute(async (req, res) => {
  const { users, email, user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const cur = mergeSettings(user);
  const allowedScope = ['blocked', 'city', 'coarse', 'approximate', 'precise'];
  const allowedDuration = ['15m', '1h', 'trip'];

  const next = { ...cur.travelLocation };
  if (req.body?.scope != null && allowedScope.includes(String(req.body.scope))) {
    next.scope = String(req.body.scope);
  }
  if (req.body?.duration != null && allowedDuration.includes(String(req.body.duration))) {
    next.duration = String(req.body.duration);
  }
  next.updatedAt = new Date().toISOString();

  user.settings = { ...cur, travelLocation: next };
  users[email] = user;

  const r = await saveUsers(users);
  addActivity(user.id, 'settings.travel_location_updated', {
    scope: next.scope,
    duration: next.duration
  });

  res.json({ ok: true, synced: r.synced, travelLocation: next });
}));

/* ── Notifications ───────────────────────────────────────────────── */
router.put('/notifications', auth, asyncRoute(async (req, res) => {
  const { users, email, user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const cur = mergeSettings(user);
  const n = { ...cur.notifications };
  for (const k of Object.keys(DEFAULTS.notifications)) if (req.body[k] != null) n[k] = !!req.body[k];
  user.settings = { ...cur, notifications: n };
  users[email] = user;
  const r = await saveUsers(users);
  addActivity(user.id, 'settings.notifications_updated');
  res.json({ ok: true, synced: r.synced, notifications: n });
}));

/* ── Security: change password ───────────────────────────────────── */
router.post('/security/password', auth, asyncRoute(async (req, res) => {
  const { users, email, user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (!(await bcrypt.compare(currentPassword, user.password_hash || ''))) return res.status(401).json({ error: 'Current password is incorrect' });
  user.password_hash = await bcrypt.hash(newPassword, 10);
  user.passwordChangedAt = new Date().toISOString();
  user.tokenVersion = (user.tokenVersion || 0) + 1; // invalidate other sessions
  users[email] = user;
  await saveUsers(users);
  addActivity(user.id, 'settings.password_changed');
  notify.emailSecurity(user, { subject: 'Your MILAN password was changed', heading: 'Password changed', intro: 'Your MILAN account password was just changed. All other devices have been signed out.', bullets: [`When: ${new Date().toUTCString()}`, "If this wasn't you, reset your password immediately."] });
  res.json({ ok: true, message: 'Password changed. Other devices have been signed out.', tokenVersion: user.tokenVersion });
}));

/* ── Security: 2FA (TOTP) ────────────────────────────────────────── */
router.post('/security/2fa/init', auth, asyncRoute(async (req, res) => {
  const { users, email, user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.security && user.security.twoFactorEnabled) return res.status(400).json({ error: '2FA is already enabled' });
  const secret = totp.generateSecret();
  user.security = { ...(user.security || {}), pendingSecret: secret };
  users[email] = user;
  await saveUsers(users);
  res.json({ ok: true, secret, otpauthUrl: totp.otpauthURL({ secret, label: email, issuer: 'MILAN' }) });
}));

router.post('/security/2fa/enable', auth, asyncRoute(async (req, res) => {
  const { users, email, user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const code = String(req.body.code || '');
  const pending = user.security && user.security.pendingSecret;
  if (!pending) return res.status(400).json({ error: 'Start 2FA setup first' });
  if (!totp.verify(code, pending)) return res.status(400).json({ error: 'Invalid code. Check your authenticator app and try again.' });
  // Generate one-time recovery codes (store only their hashes).
  const recovery = Array.from({ length: 8 }, () => require('crypto').randomBytes(5).toString('hex'));
  const recoveryHashes = recovery.map(c => require('crypto').createHash('sha256').update(c).digest('hex'));
  user.security = { twoFactorEnabled: true, twoFactorSecret: pending, recoveryHashes, enabledAt: new Date().toISOString() };
  users[email] = user;
  await saveUsers(users);
  addActivity(user.id, 'settings.2fa_enabled');
  notify.emailSecurity(user, { subject: 'Two-factor authentication enabled', heading: 'Two-factor turned on', intro: 'Two-factor authentication is now enabled on your MILAN account. Your account is more secure.', bullets: [`When: ${new Date().toUTCString()}`] });
  res.json({ ok: true, message: 'Two-factor authentication enabled', recoveryCodes: recovery });
}));

router.post('/security/2fa/disable', auth, asyncRoute(async (req, res) => {
  const { users, email, user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const password = String(req.body.password || '');
  if (!(await bcrypt.compare(password, user.password_hash || ''))) return res.status(401).json({ error: 'Password is incorrect' });
  user.security = { ...(user.security || {}), twoFactorEnabled: false, twoFactorSecret: undefined, pendingSecret: undefined, recoveryHashes: undefined };
  users[email] = user;
  await saveUsers(users);
  addActivity(user.id, 'settings.2fa_disabled');
  notify.emailSecurity(user, { subject: 'Two-factor authentication disabled', heading: 'Two-factor turned off', intro: 'Two-factor authentication was just disabled on your MILAN account.', bullets: [`When: ${new Date().toUTCString()}`, "If this wasn't you, change your password and re-enable 2FA."] });
  res.json({ ok: true, message: 'Two-factor authentication disabled' });
}));

/* ── Security: sessions / where you're logged in ─────────────────── */
router.get('/security/sessions', auth, asyncRoute(async (req, res) => {
  const { user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const activity = readJson(global.activityFile, {});
  const mine = Array.isArray(activity[user.id]) ? activity[user.id] : [];
  const logins = mine.filter(a => a.action === 'auth.login').slice(0, 20)
    .map(a => ({ at: a.at, ip: a.details?.ip || 'unknown', userAgent: a.details?.userAgent || '' }));
  res.json({ ok: true, currentTokenVersion: user.tokenVersion || 0, lastLoginAt: user.last_login_at || null, loginCount: user.login_count || 0, recentLogins: logins });
}));

router.post('/security/logout-all', auth, asyncRoute(async (req, res) => {
  const { users, email, user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  users[email] = user;
  await saveUsers(users);
  addActivity(user.id, 'settings.logout_all');
  res.json({ ok: true, message: 'Signed out of all other sessions. Your current device may need to sign in again.', tokenVersion: user.tokenVersion });
}));

/* ── Blocking ────────────────────────────────────────────────────── */
router.get('/blocking', auth, asyncRoute(async (req, res) => {
  const { user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true, blocked: mergeSettings(user).blocked });
}));
router.post('/blocking', auth, asyncRoute(async (req, res) => {
  const { users, email, user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const did = String(req.body.did || '').trim();
  const blockedEmail = String(req.body.email || '').trim().toLowerCase();
  if (!did && !blockedEmail) return res.status(400).json({ error: 'Provide a DID or email to block' });
  const cur = mergeSettings(user);
  if (cur.blocked.some(b => (did && b.did === did) || (blockedEmail && b.email === blockedEmail))) return res.json({ ok: true, blocked: cur.blocked });
  cur.blocked.push({ did, email: blockedEmail, at: new Date().toISOString() });
  user.settings = cur; users[email] = user;
  await saveUsers(users);
  addActivity(user.id, 'settings.user_blocked', { did, email: blockedEmail });
  res.json({ ok: true, blocked: cur.blocked });
}));
router.delete('/blocking/:id', auth, asyncRoute(async (req, res) => {
  const { users, email, user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const id = decodeURIComponent(req.params.id);
  const cur = mergeSettings(user);
  cur.blocked = cur.blocked.filter(b => b.did !== id && b.email !== id);
  user.settings = cur; users[email] = user;
  await saveUsers(users);
  res.json({ ok: true, blocked: cur.blocked });
}));

/* ── Data: export, deactivate, delete ────────────────────────────── */
router.get('/data/export', auth, asyncRoute(async (req, res) => {
  const { user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const activity = readJson(global.activityFile, {});
  const safeUser = { ...user }; delete safeUser.password_hash; delete safeUser.raw_seed;
  if (safeUser.security) { safeUser.security = { ...safeUser.security, twoFactorSecret: undefined, pendingSecret: undefined, recoveryHashes: undefined }; }
  const payload = { exportedAt: new Date().toISOString(), app: 'MILAN', account: safeUser, activity: activity[user.id] || [] };
  res.setHeader('Content-Disposition', 'attachment; filename="milan-my-data.json"');
  res.json(payload);
}));

router.post('/account/deactivate', auth, asyncRoute(async (req, res) => {
  const { users, email, user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.status = 'deactivated';
  user.deactivatedAt = new Date().toISOString();
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  users[email] = user;
  await saveUsers(users);
  addActivity(user.id, 'account.deactivated');
  res.json({ ok: true, message: 'Account deactivated. Sign in again any time to reactivate.' });
}));

router.post('/account/delete', auth, asyncRoute(async (req, res) => {
  const { users, email, user } = locate(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const password = String(req.body.password || '');
  if (!(await bcrypt.compare(password, user.password_hash || ''))) return res.status(401).json({ error: 'Password is incorrect' });
  const uid = user.id;
  // Purge from central index files (DWN isolated records are owner-controlled and removed with the node).
  delete users[email];
  await saveUsers(users);
  for (const f of [global.activityFile, global.requestsFile, global.connectionsFile, global.notificationsFile, global.socialReactionsFile, global.socialCommentsFile, global.socialSavesFile]) {
    try { const data = readJson(f, {}); if (data && typeof data === 'object' && data[uid]) { delete data[uid]; writeJson(f, data); } } catch (_) {}
  }
  res.json({ ok: true, message: 'Account and associated data deleted.' });
}));

router.use((err, _req, res, _next) => {
  console.error('Settings route failed:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Settings request failed' });
});

module.exports = router;
