'use strict';

const { parseTokenVersion } = require('./sessionTokens');

function createAuthSessionStore(db) {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('A PostgreSQL-compatible query client is required.');
  }

  async function bumpTokenVersion(userId) {
    const result = await db.query(
      `UPDATE public.users
          SET auth_token_version = COALESCE(auth_token_version, 0) + 1,
              updated_at = NOW()
        WHERE user_id::text = $1
        RETURNING auth_token_version`,
      [String(userId || '')]
    );
    const row = result && result.rows && result.rows[0];
    const version = parseTokenVersion(row && row.auth_token_version);
    if (version === null) {
      throw new Error('Authoritative session version could not be updated.');
    }
    return version;
  }

  async function changePasswordAndRevoke({ userId, expectedPasswordHash, passwordHash }) {
    const result = await db.query(
      `UPDATE public.users
          SET password_hash = $1,
              auth_token_version = COALESCE(auth_token_version, 0) + 1,
              updated_at = NOW()
        WHERE user_id::text = $2
          AND password_hash = $3
        RETURNING auth_token_version`,
      [passwordHash, String(userId || ''), String(expectedPasswordHash || '')]
    );
    const row = result && result.rows && result.rows[0];
    const version = parseTokenVersion(row && row.auth_token_version);
    if (version === null) return { ok: false, reason: 'concurrent-change' };
    return { ok: true, tokenVersion: version };
  }

  return { bumpTokenVersion, changePasswordAndRevoke };
}

module.exports = { createAuthSessionStore };
