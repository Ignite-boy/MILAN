'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { parseTokenVersion, tokenVersionMatches } = require('../backend/services/sessionTokens');
const { createAuthSessionStore } = require('../backend/services/authSessionStore');

async function main() {
  assert.equal(parseTokenVersion(0), 0);
  assert.equal(parseTokenVersion('4'), 4);
  assert.equal(parseTokenVersion(-1), null);
  assert.equal(parseTokenVersion('NaN'), null);
  assert.equal(parseTokenVersion(undefined), null);
  assert.equal(tokenVersionMatches(3, 3), true);
  assert.equal(tokenVersionMatches('3', 3), true);
  assert.equal(tokenVersionMatches(2, 3), false);
  assert.equal(tokenVersionMatches(undefined, 0), false);
  assert.equal(tokenVersionMatches(0, undefined), false);
  console.log('PASS: missing, invalid and revoked token versions fail closed.');

  const secret = 'session-token-self-test-secret-long-enough';
  const token = jwt.sign(
    { userId: 'test-user', email: 'test@example.com', tv: 7, iat: 1000 },
    secret, { expiresIn: 60 }
  );
  assert.equal(jwt.verify(token, secret, { clockTimestamp: 1059 }).tv, 7);
  assert.throws(() => jwt.verify(token, secret, { clockTimestamp: 1060 }), { name: 'TokenExpiredError' });
  assert.throws(() => jwt.verify(token, 'a-different-self-test-secret-long-enough'), { name: 'JsonWebTokenError' });
  console.log('PASS: JWT expiration and signature verification remain enforced.');

  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('AND password_hash = $3')) {
        return { rows: [{ auth_token_version: 9 }] };
      }
      if (sql.includes('UPDATE public.users')) {
        return { rows: [{ auth_token_version: 8 }] };
      }
      return { rows: [] };
    }
  };
  const sessions = createAuthSessionStore(db);
  assert.equal(await sessions.bumpTokenVersion('test-user'), 8);
  assert.deepEqual(await sessions.changePasswordAndRevoke({
    userId: 'test-user',
    expectedPasswordHash: 'old-hash',
    passwordHash: 'new-hash'
  }), { ok: true, tokenVersion: 9 });
  assert.match(queries[0].sql, /auth_token_version = COALESCE/);
  assert.match(queries[1].sql, /AND password_hash = \$3/);
  assert.equal(queries[1].params[0], 'new-hash');
  console.log('PASS: version bumps and password changes use conditional PostgreSQL writes.');

  const noRows = createAuthSessionStore({ async query() { return { rows: [] }; } });
  assert.deepEqual(await noRows.changePasswordAndRevoke({
    userId: 'missing-user', expectedPasswordHash: 'old', passwordHash: 'new'
  }), { ok: false, reason: 'concurrent-change' });
  await assert.rejects(() => noRows.bumpTokenVersion('missing-user'), /session version could not be updated/i);
  console.log('PASS: missing database rows do not count as successful revocation.');

  const root = path.resolve(__dirname, '..');
  const read = name => fs.readFileSync(path.join(root, name), 'utf8');
  const auth = read('backend/routes/auth.js');
  const did = read('backend/routes/did.js');
  const middleware = read('backend/middleware/auth.js');
  const settings = read('backend/routes/settings.js');
  const livePush = read('backend/services/livePush.js');
  const migration = read('backend/migrations/20261023_voroa_auth_sessions.sql');

  assert.match(auth, /userId, email: user\.email, tv/);
  assert.match(auth, /auth_token_version = COALESCE/);
  assert.match(did, /email_verified,\s*auth_token_version/);
  assert.match(did, /email: user\.email,\s*tv/);
  assert.match(middleware, /tokenVersionMatches\(decoded\.tv, account\.auth_token_version\)/);
  assert.match(settings, /authSessions\.changePasswordAndRevoke/);
  assert.match(settings, /authSessions\.bumpTokenVersion/);
  assert.match(settings, /SELECT auth_token_version FROM public\.users/);
  assert.match(livePush, /tokenVersionMatches\(decoded\.tv, account\.auth_token_version\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS auth_token_version integer NOT NULL DEFAULT 0/);
  assert.match(migration, /GRANT UPDATE \(auth_token_version\) ON TABLE public\.users TO milan_app/);
  console.log('PASS: password login, DID login, HTTP, WebSocket, reset and schema use the session-version contract.');
  console.log('ALL SESSION TOKEN SELF-TESTS PASSED.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
