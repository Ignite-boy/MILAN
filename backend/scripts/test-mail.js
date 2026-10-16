'use strict';

/**
 * MILAN mail smoke test.
 *
 *   node scripts/test-mail.js you@example.com
 *   npm run mail:test -- you@example.com
 *
 * Loads .env, prints which provider is configured (no secrets), then sends a
 * real test email from support@milanlife.in to the address you pass.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const preferredEnv = path.join(os.homedir(), '.config/milan/backend.env');
const fallbackEnv = path.join(__dirname, '..', '.env');
require('dotenv').config({ path: fs.existsSync(preferredEnv) ? preferredEnv : fallbackEnv });
const { mailStatus, sendTestEmail } = require('../services/mailService');

(async () => {
  const to = process.argv[2] || process.env.MAIL_TEST_TO;
  const status = mailStatus();

  console.log('\n── MILAN mail configuration ─────────────────────────────');
  console.log('  configured :', status.configured);
  console.log('  provider   :', status.provider);
  console.log('  from       :', status.from);
  console.log('  reply-to   :', status.replyTo);
  console.log('  app url    :', status.appUrl);
  if (status.smtp) console.log('  smtp       :', `${status.smtp.host}:${status.smtp.port} secure=${status.smtp.secure} user=${status.smtp.user}`);
  console.log('─────────────────────────────────────────────────────────\n');

  if (!status.configured) {
    console.error('✖ No mail provider configured. Set RESEND_API_KEY, SENDGRID_API_KEY, or SMTP_* in .env, then retry.');
    process.exit(1);
  }
  if (!to) {
    console.error('✖ Usage: node scripts/test-mail.js <recipient@example.com>');
    process.exit(1);
  }

  console.log(`→ Sending test email to ${to} via ${status.provider} ...`);
  const result = await sendTestEmail({ to });
  if (result.ok) {
    console.log(`✓ Sent successfully via ${result.provider}${result.id ? ` (id: ${result.id})` : ''}.`);
    process.exit(0);
  } else {
    console.error('✖ Send failed:', result.error || result.reason || 'unknown error');
    process.exit(1);
  }
})();
