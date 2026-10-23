const jwt = require('jsonwebtoken');
const { readJson, cleanUsersDb } = require('../utils/store');
const { getAuthoritativeUserById } = require('../services/authoritativeUser');
const { tokenVersionMatches } = require('../services/sessionTokens');

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
  const bearerToken = header.startsWith('Bearer ') ? header.slice(7) : null;
  // EventSource cannot attach Authorization headers. Native video elements also
  // cannot set Authorization, so query tokens are allowed only on narrow read-only routes.
  const requestPath = String(req.originalUrl || '').split('?')[0];
  const isSseGet = req.method === 'GET' && requestPath === '/api/events';
  const isMediaStreamGet = (req.method === 'GET' || req.method === 'HEAD') &&
    /^\/api\/records\/[^/]+\/media(?:\/(?:play\.mp4|(?!status(?:\/|$)|repair(?:\/|$)|debug(?:\/|$))[^/]+))?$/.test(requestPath);
  const queryToken = (isSseGet || isMediaStreamGet) && req.query && req.query.token
    ? String(req.query.token) : null;
  const token = bearerToken || queryToken;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, require('../utils/jwtSecret'));
    req.userId = decoded.userId;
    req.userEmail = decoded.email;

    // Legacy tokens without a version cannot bypass revocation.
    // This lookup returns the current authoritative PostgreSQL session version.
    const account = await getAuthoritativeUserById(req.userId);
    if (!account) {
      return res.status(401).json({ error: 'Account not found.' });
    }

    if (!tokenVersionMatches(decoded.tv, account.auth_token_version)) {
      return res.status(401).json({
        error: 'Session expired. Please sign in again.',
        code: 'token_revoked'
      });
    }

    const localState = userState(decoded.email);
    if (localState && localState.status === 'deactivated') {
      return res.status(403).json({
        error: 'Account is deactivated. Sign in again to reactivate.',
        code: 'deactivated'
      });
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
