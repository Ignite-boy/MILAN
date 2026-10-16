'use strict';

/**
 * Titan/SMTP auth diagnostic.
 *   node scripts/smtp-diagnose.js
 *
 * Loads .env and tries to AUTHENTICATE (transporter.verify) against your SMTP
 * server on the configured port, then also tries the alternate Titan port.
 * Prints the server's raw response so a 535 (bad password) is unambiguous.
 * No email is sent — this only logs in.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const preferredEnv = path.join(os.homedir(), '.config/milan/backend.env');
const fallbackEnv = path.join(__dirname, '..', '.env');
require('dotenv').config({ path: fs.existsSync(preferredEnv) ? preferredEnv : fallbackEnv });
let nodemailer;
try { nodemailer = require('nodemailer'); }
catch (_) { console.error('Run `npm install` first (nodemailer missing).'); process.exit(1); }

const HOST = process.env.SMTP_HOST || '';
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
const PORT = Number(process.env.SMTP_PORT || 587);
const SECURE = String(process.env.SMTP_SECURE || '') === 'true';

console.log('\n── SMTP diagnostic ───────────────────────────────');
console.log('  host :', HOST || 'MISSING');
console.log('  port :', PORT);
console.log('  TLS  :', SECURE ? 'implicit TLS' : 'STARTTLS/unencrypted initial connection');
console.log('  user configured:', Boolean(USER));
console.log('  password configured:', Boolean(PASS));
console.log('──────────────────────────────────────────────────');

if (!HOST || !USER || !PASS || !Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('SMTP_HOST, SMTP_USER, SMTP_PASS and a valid SMTP_PORT are required.');
  process.exit(1);
}

async function tryLogin(port, secure) {
  const t = nodemailer.createTransport({ host: HOST, port, secure, auth: { user: USER, pass: PASS }, connectionTimeout: 12000, greetingTimeout: 12000 });
  process.stdout.write(`→ ${HOST}:${port} secure=${secure} ... `);
  try { await t.verify(); console.log('✓ AUTH OK — these credentials work on this port.'); return true; }
  catch (e) {
    console.log('✗ ' + (e && e.message ? e.message : e));
    if (/535|5\.7\.8|auth/i.test(String(e && e.message))) console.log('   → 535 = username/password rejected by the server (not a network/TLS issue).');
    return false;
  }
}

(async () => {
  const primaryOk = await tryLogin(PORT, SECURE);
  let alternateOk = false;
  let alternatePort = null;

  if (!primaryOk && (PORT === 587 || PORT === 465)) {
    alternatePort = PORT === 587 ? 465 : 587;
    alternateOk = await tryLogin(alternatePort, alternatePort === 465);
  }

  console.log('\nResult:');
  if (primaryOk) {
    console.log('  ✓ SMTP authentication succeeded on the configured port.');
  } else if (alternateOk) {
    console.log('  ✓ SMTP authentication succeeded on alternate port', alternatePort);
    console.log('    Review SMTP_PORT and SMTP_SECURE in the backend environment.');
  } else {
    console.log('  ✖ SMTP authentication failed on the tested configuration.');
    console.log('    Check the mailbox credentials, SMTP host, port and provider SMTP access.');
  }

  process.exit(primaryOk || alternateOk ? 0 : 2);
})();
