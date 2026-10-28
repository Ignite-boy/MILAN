'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const did = fs.readFileSync('backend/routes/did.js', 'utf8');
const migration = fs.readFileSync(
  'backend/migrations/20261019_voroa_milan_pay.sql', 'utf8'
);

assert.match(did, /SELECT COUNT\(\*\)::int AS count FROM public\.webauthn_credentials WHERE user_id = \$1/);
assert.match(did, /INSERT INTO public\.webauthn_challenges/);
assert.match(did, /UPDATE public\.webauthn_challenges\s+SET used_at = \$2/);
assert.match(did, /INSERT INTO public\.webauthn_credentials/);
assert.match(did, /UPDATE public\.webauthn_credentials SET counter = \$1, updated_at = NOW\(\) WHERE id = \$2/);
assert.match(did, /FROM public\.users\s+WHERE user_id = \$1/);
assert.match(migration, /GRANT INSERT \(user_id, challenge, purpose, expires_at\)\s+ON TABLE public\.webauthn_challenges TO milan_app;/);
assert.match(migration, /GRANT UPDATE \(used_at\)\s+ON TABLE public\.webauthn_challenges TO milan_app;/);
assert.match(migration, /GRANT UPDATE \(counter, updated_at\)\s+ON TABLE public\.webauthn_credentials TO milan_app;/);

console.log('PASS: WebAuthn route uses Voroa persistence');
console.log('PASS: user lookup, challenge flow, and credential operations use Voroa');
console.log('PASS: WebAuthn runtime grants are column-restricted');
