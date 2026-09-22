const jwt = require('jsonwebtoken');
const { readJson, cleanUsersDb } = require('../utils/store');
const { getAuthoritativeUserById } = require('../services/authoritativeUser');

// Lightweight TTL cache of { email -> {tokenVersion, status} } so we can enforce
// "sign out of all sessions" and deactivation without a disk read on every request.
let _cache = null, _cacheAt = 0;
const CACHE_TTL_MS = 15000;
function userState(email) {
  if (!email) return null;
  const now = Date.now();
  if (!_cache || now - _cacheAt > CACHE_TTL_MS) {
    try { _cache = cleanUsersDb(readJson(global.usersFile, {})); } catch (_) { _cache = _cache || {}; }
    _cacheAt = now;
  }
  return _cache[email] || null;
}
// Allow other modules (e.g. settings) to bust the cache after a change.
function invalidateAuthCache() { _cache = null; _cacheAt = 0; }

module.exports = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query && req.query.token ? String(req.query.token) : null);
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, require('../utils/jwtSecret'));
    req.userId = decoded.userId;
    req.userEmail = decoded.email;

    // Enforce token version + account status only for tokens that carry the claim
    // (backward compatible with older tokens issued before this feature).
    if (decoded.tv !== undefined) {
      const u = userState(decoded.email);
      if (u) {
        if ((u.tokenVersion || 0) !== decoded.tv) {
          return res.status(401).json({ error: 'Session expired. Please sign in again.', code: 'token_revoked' });
        }
        if (u.status === 'deactivated') {
          return res.status(403).json({ error: 'Account is deactivated. Sign in again to reactivate.', code: 'deactivated' });
        }
      }
    }

    // Authoritative identity mapping: JWT userId -> Supabase user -> DID -> DWN space.
    const account = await getAuthoritativeUserById(req.userId);
    if (!account) {
      return res.status(401).json({ error: 'Account not found.' });
    }

    req.account = account;
    req.did = account.did;
    req.spaceId = account.spaceId;
    req.dwnQuotaBytes = account.dwnQuotaBytes;

    next();
  } catch (err) {
    if (err && /Authoritative user lookup failed|Authoritative DID\/space mapping is incomplete/.test(String(err.message || ''))) {
      return res.status(503).json({ error: err.message, code: 'authoritative_mapping_unavailable' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
module.exports.invalidateAuthCache = invalidateAuthCache;
