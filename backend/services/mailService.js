'use strict';

/**
 * MILAN Mail Service
 * -------------------
 * Sends ALL transactional email from support@milanlife.in:
 *   • Welcome / account-created
 *   • Email verification (confirm address)
 *   • Password reset
 *   • New login / security alert
 *   • Generic test email (admin "send test" button)
 *
 * Provider strategy (first configured one wins):
 *   1. RESEND_API_KEY            -> Resend HTTPS API (recommended in cloud deployments, no SMTP port needed)
 *   2. SENDGRID_API_KEY          -> SendGrid HTTPS API
 *   3. SMTP_HOST + SMTP_USER...  -> Generic SMTP via nodemailer (use this with your registered mailbox)
 *   4. none                      -> logs the mail and returns { ok:false, skipped:true }
 *
 * Nothing here ever throws into the auth flow: registration / login must succeed even
 * if mail delivery fails. Callers should `.catch()` and ignore.
 */

const FROM_EMAIL = process.env.MAIL_FROM || 'MILAN <support@milanlife.in>';
const FROM_ADDRESS = process.env.MAIL_FROM_ADDRESS || 'support@milanlife.in';
const REPLY_TO = process.env.MAIL_REPLY_TO || FROM_ADDRESS;
const APP_URL = (process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || 'https://milanlife.in').replace(/\/+$/, '');

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* ──────────────────────────────────────────────────────────────
 * Shared branded shell — every email reuses this premium layout so
 * the whole suite is visually consistent with the MILAN brand.
 * ────────────────────────────────────────────────────────────── */
function shell({ preheader = '', heading = '', bodyHtml = '', email = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(heading || 'MILAN')}</title>
</head>
<body style="margin:0;padding:0;background:#0b1020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1020;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#11182b;border:1px solid #1e2a44;border-radius:20px;overflow:hidden;">
        <tr><td style="padding:32px 36px 8px;">
          <div style="font-size:22px;font-weight:800;letter-spacing:.18em;color:#e8eefb;">M I L A N</div>
          <div style="font-size:13px;color:#7e8db0;margin-top:4px;letter-spacing:.02em;">Your Space. Your People.</div>
        </td></tr>
        ${heading ? `<tr><td style="padding:18px 36px 0;">
          <h1 style="font-size:21px;font-weight:700;color:#f3f6fc;margin:14px 0 4px;line-height:1.35;">${heading}</h1>
        </td></tr>` : ''}
        <tr><td style="padding:8px 36px 8px;">${bodyHtml}</td></tr>
        <tr><td style="padding:24px 36px 32px;">
          <p style="font-size:12px;color:#5d6b8c;line-height:1.7;margin:0;border-top:1px solid #1e2a44;padding-top:18px;">
            Sent by MILAN · Founder: Nitesh Pandey<br>
            <a href="mailto:${escapeHtml(FROM_ADDRESS)}" style="color:#7e8db0;text-decoration:none;">${escapeHtml(FROM_ADDRESS)}</a> ·
            <a href="${APP_URL}/about" style="color:#7e8db0;text-decoration:none;">About</a> ·
            <a href="${APP_URL}/privacy" style="color:#7e8db0;text-decoration:none;">Privacy</a>
          </p>
        </td></tr>
      </table>
      ${email ? `<div style="max-width:560px;margin-top:16px;font-size:11px;color:#42506e;text-align:center;line-height:1.6;">
        This email was sent to ${escapeHtml(email)} regarding your MILAN account.
      </div>` : ''}
    </td></tr>
  </table>
</body>
</html>`;
}

function button(href, label) {
  return `<a href="${href}" style="display:inline-block;background:#3a6df0;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 30px;border-radius:12px;">${label}</a>`;
}

function codeBox(label, value) {
  return `<div style="background:#0d1426;border:1px solid #1e2a44;border-radius:12px;padding:14px 16px;margin:6px 0;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#7e8db0;margin-bottom:6px;">${label}</div>
    <div style="font-family:'SF Mono',Consolas,monospace;font-size:18px;letter-spacing:.18em;color:#9fc0ff;word-break:break-all;line-height:1.6;">${value}</div>
  </div>`;
}

/* ── 1) Welcome email ─────────────────────────────────────────── */
function welcomeEmail({ name = '', email = '', did = '' } = {}) {
  const safeName = escapeHtml(name || (email ? email.split('@')[0] : 'there'));
  const safeDid = escapeHtml(did || '');
  const subject = 'Welcome to MILAN — your space is ready';

  const text = [
    `Hi ${name || 'there'},`, '',
    'Welcome to MILAN — the privacy-first decentralized social network where you truly own your data.', '',
    'Your account is ready. Every MILAN member gets their own Decentralized Web Node (DWN) and a Decentralized Identifier (DID), so your posts, media and connections stay under your control. No ads. No tracking. No data selling.',
    did ? `\nYour DID:\n${did}\n` : '',
    `Open MILAN: ${APP_URL}/app`, '',
    'Your Space. Your People.', '— The MILAN Team',
    `Founder: Nitesh Pandey · ${FROM_ADDRESS}`
  ].join('\n');

  const bodyHtml = `
    <p style="font-size:15px;line-height:1.7;color:#aeb9d4;margin:0 0 16px;">Welcome, <strong style="color:#e8eefb;">${safeName}</strong> 👋</p>
    <p style="font-size:15px;line-height:1.7;color:#aeb9d4;margin:0 0 16px;">You've joined <strong style="color:#e8eefb;">MILAN</strong>, the privacy-first decentralized social network where you genuinely <strong style="color:#e8eefb;">own your data</strong>.</p>
    <p style="font-size:15px;line-height:1.7;color:#aeb9d4;margin:0 0 20px;">Every member gets their own <strong style="color:#e8eefb;">Decentralized Web Node (DWN)</strong> secured by a <strong style="color:#e8eefb;">Decentralized Identifier (DID)</strong>. Your posts, media and connections stay under your control — no ads, no tracking, no data selling.</p>
    ${safeDid ? codeBox('Your decentralized identity', `<span style="font-size:12px;letter-spacing:0;">${safeDid}</span>`) : ''}
    <div style="margin:22px 0 8px;">${button(`${APP_URL}/app`, 'Open MILAN →')}</div>
    <p style="font-size:13px;color:#7e8db0;line-height:1.7;margin:18px 0 0;border-top:1px solid #1e2a44;padding-top:18px;">Posts are <strong style="color:#aeb9d4;">private by default</strong>. Make something public or share it with selected DIDs only when you choose. You're always in control.</p>`;

  return { subject, text, html: shell({ preheader: 'Your MILAN space is ready — you own your data with DWN + DID.', heading: 'Welcome aboard', bodyHtml, email }) };
}

/* ── 2) Email verification ────────────────────────────────────── */
function verifyEmail({ name = '', email = '', verifyUrl = '', code = '' } = {}) {
  const safeName = escapeHtml(name || (email ? email.split('@')[0] : 'there'));
  const subject = 'Confirm your MILAN email address';
  const text = [
    `Hi ${name || 'there'},`, '',
    'Confirm your email address to secure your MILAN account.', '',
    `Verification link:\n${verifyUrl}`, '',
    code ? `Or enter this 6-digit code in the app: ${code}` : '',
    '', 'This link expires in 24 hours. If you did not create a MILAN account, you can ignore this email.',
    '', '— The MILAN Team', `${FROM_ADDRESS}`
  ].filter(Boolean).join('\n');

  const bodyHtml = `
    <p style="font-size:15px;line-height:1.7;color:#aeb9d4;margin:0 0 16px;">Hi <strong style="color:#e8eefb;">${safeName}</strong>, please confirm this is your email address so we can keep your MILAN account secure.</p>
    <div style="margin:18px 0 8px;">${button(verifyUrl, 'Confirm my email →')}</div>
    ${code ? codeBox('Or enter this code', escapeHtml(code)) : ''}
    <p style="font-size:13px;color:#7e8db0;line-height:1.7;margin:16px 0 0;">This link expires in <strong style="color:#aeb9d4;">24 hours</strong>. If the button doesn't work, copy and paste this URL into your browser:</p>
    <p style="font-size:12px;color:#9fc0ff;word-break:break-all;line-height:1.6;margin:6px 0 0;">${escapeHtml(verifyUrl)}</p>
    <p style="font-size:12px;color:#5d6b8c;line-height:1.7;margin:16px 0 0;">If you didn't create a MILAN account, you can safely ignore this email.</p>`;

  return { subject, text, html: shell({ preheader: 'Confirm your email to secure your MILAN account.', heading: 'Confirm your email', bodyHtml, email }) };
}

/* ── 3) Password reset ────────────────────────────────────────── */
function passwordResetEmail({ name = '', email = '', resetUrl = '', code = '' } = {}) {
  const safeName = escapeHtml(name || (email ? email.split('@')[0] : 'there'));
  const subject = 'Reset your MILAN password';
  const text = [
    `Hi ${name || 'there'},`, '',
    'We received a request to reset your MILAN password.', '',
    `Reset link:\n${resetUrl}`, '',
    code ? `Or enter this 6-digit code in the app: ${code}` : '',
    '', 'This link expires in 1 hour. If you did not request a password reset, ignore this email — your password will not change.',
    '', '— The MILAN Team', `${FROM_ADDRESS}`
  ].filter(Boolean).join('\n');

  const bodyHtml = `
    <p style="font-size:15px;line-height:1.7;color:#aeb9d4;margin:0 0 16px;">Hi <strong style="color:#e8eefb;">${safeName}</strong>, we received a request to reset the password for your MILAN account.</p>
    <div style="margin:18px 0 8px;">${button(resetUrl, 'Reset my password →')}</div>
    ${code ? codeBox('Or enter this code', escapeHtml(code)) : ''}
    <p style="font-size:13px;color:#7e8db0;line-height:1.7;margin:16px 0 0;">This link expires in <strong style="color:#aeb9d4;">1 hour</strong>. If the button doesn't work, paste this URL into your browser:</p>
    <p style="font-size:12px;color:#9fc0ff;word-break:break-all;line-height:1.6;margin:6px 0 0;">${escapeHtml(resetUrl)}</p>
    <p style="font-size:12px;color:#5d6b8c;line-height:1.7;margin:16px 0 0;">If you didn't request this, you can ignore this email and your password will stay the same.</p>`;

  return { subject, text, html: shell({ preheader: 'Reset your MILAN password (link expires in 1 hour).', heading: 'Reset your password', bodyHtml, email }) };
}

/* ── 4) New login / security alert ────────────────────────────── */
function loginAlertEmail({ name = '', email = '', ip = '', userAgent = '', time = '' } = {}) {
  const safeName = escapeHtml(name || (email ? email.split('@')[0] : 'there'));
  const when = time || new Date().toUTCString();
  const subject = 'New sign-in to your MILAN account';
  const text = [
    `Hi ${name || 'there'},`, '',
    'Your MILAN account was just signed in to.', '',
    `Time: ${when}`,
    `IP address: ${ip || 'unknown'}`,
    `Device: ${userAgent || 'unknown'}`, '',
    "If this was you, no action is needed. If you don't recognise this activity, reset your password immediately:",
    `${APP_URL}/reset-password`, '',
    '— The MILAN Team', `${FROM_ADDRESS}`
  ].join('\n');

  const bodyHtml = `
    <p style="font-size:15px;line-height:1.7;color:#aeb9d4;margin:0 0 16px;">Hi <strong style="color:#e8eefb;">${safeName}</strong>, your MILAN account was just signed in to. Here are the details:</p>
    <div style="background:#0d1426;border:1px solid #1e2a44;border-radius:12px;padding:14px 16px;margin:6px 0 16px;">
      <p style="margin:0 0 6px;font-size:13px;color:#aeb9d4;"><span style="color:#7e8db0;">Time:</span> ${escapeHtml(when)}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#aeb9d4;"><span style="color:#7e8db0;">IP address:</span> ${escapeHtml(ip || 'unknown')}</p>
      <p style="margin:0;font-size:13px;color:#aeb9d4;"><span style="color:#7e8db0;">Device:</span> ${escapeHtml(userAgent || 'unknown')}</p>
    </div>
    <p style="font-size:14px;line-height:1.7;color:#aeb9d4;margin:0 0 12px;">If this was you, you can ignore this email.</p>
    <p style="font-size:14px;line-height:1.7;color:#aeb9d4;margin:0 0 12px;">If you don't recognise this sign-in, reset your password right away:</p>
    <div style="margin:8px 0;">${button(`${APP_URL}/reset-password`, 'Secure my account →')}</div>`;

  return { subject, text, html: shell({ preheader: 'A new sign-in to your MILAN account was detected.', heading: 'New sign-in detected', bodyHtml, email }) };
}

/* ── 5b) Generic event/notification email (automation engine) ──── */
function notificationEmail({ heading = 'MILAN', intro = '', bullets = [], name = '', email = '', ctaText = '', ctaUrl = '' } = {}) {
  const safeName = escapeHtml(name || (email ? email.split('@')[0] : 'there'));
  const ctaFull = ctaUrl ? (/^https?:\/\//.test(ctaUrl) ? ctaUrl : `${APP_URL}${ctaUrl.startsWith('/') ? '' : '/'}${ctaUrl}`) : '';
  const bulletsHtml = (bullets && bullets.length)
    ? `<div style="background:#0d1426;border:1px solid #1e2a44;border-radius:12px;padding:12px 16px;margin:6px 0 12px;">${bullets.map(b => `<p style="margin:0 0 6px;font-size:13px;color:#aeb9d4;">${escapeHtml(b)}</p>`).join('')}</div>`
    : '';
  const bodyHtml = `
    <p style="font-size:15px;line-height:1.7;color:#aeb9d4;margin:0 0 14px;">Hi <strong style="color:#e8eefb;">${safeName}</strong>,</p>
    <p style="font-size:15px;line-height:1.7;color:#aeb9d4;margin:0 0 14px;">${escapeHtml(intro)}</p>
    ${bulletsHtml}
    ${ctaFull ? `<div style="margin:18px 0 8px;">${button(ctaFull, escapeHtml(ctaText || 'Open MILAN →'))}</div>` : ''}`;
  const text = [`Hi ${name || 'there'},`, '', intro, ...(bullets || []), '', ctaFull ? `${ctaText || 'Open'}: ${ctaFull}` : '', '', '— MILAN', FROM_ADDRESS].filter(Boolean).join('\n');
  return { html: shell({ preheader: String(intro).slice(0, 90), heading, bodyHtml, email }), text };
}

/* ── 5c) Payment success email ─────────────────────────────── */
function paymentSuccessEmail({ name = '', email = '', plan = '', amount = '', orderId = '', reference = '' } = {}) {
  const safeName = escapeHtml(name || (email ? email.split('@')[0] : 'there'));
  const safePlan = escapeHtml(plan);
  const safeAmount = escapeHtml(String(amount));
  const safeOrderId = escapeHtml(orderId);
  const safeReference = escapeHtml(reference);

  const subject = 'Payment Successful — MILAN Storage Upgrade';
  const text = [
    `Hi ${name || 'there'},`,
    '',
    'Your payment has been verified successfully.',
    `Storage plan: ${plan}`,
    `Amount: ₹${amount}`,
    `Order ID: ${orderId}`,
    `Payment reference: ${reference}`,
    '',
    'Your upgraded MILAN storage is now active.',
    'You can now use your upgraded DWN storage.',
    '',
    '— MILAN',
    FROM_ADDRESS
  ].join('\\n');

  const bodyHtml = `
    <p style="font-size:15px;line-height:1.7;color:#aeb9d4;margin:0 0 14px;">
      Hi <strong style="color:#e8eefb;">${safeName}</strong>,
    </p>
    <p style="font-size:15px;line-height:1.7;color:#aeb9d4;margin:0 0 16px;">
      Your payment has been <strong style="color:#e8eefb;">verified successfully</strong>.
    </p>
    <div style="background:#0d1426;border:1px solid #1e2a44;border-radius:12px;padding:14px 16px;margin:0 0 16px;">
      <p style="margin:0 0 7px;font-size:13px;color:#aeb9d4;"><span style="color:#7e8db0;">Storage plan:</span> <strong style="color:#e8eefb;">${safePlan}</strong></p>
      <p style="margin:0 0 7px;font-size:13px;color:#aeb9d4;"><span style="color:#7e8db0;">Amount:</span> <strong style="color:#e8eefb;">₹${safeAmount}</strong></p>
      <p style="margin:0 0 7px;font-size:13px;color:#aeb9d4;"><span style="color:#7e8db0;">Order ID:</span> ${safeOrderId}</p>
      <p style="margin:0;font-size:13px;color:#aeb9d4;"><span style="color:#7e8db0;">Payment reference:</span> ${safeReference}</p>
    </div>
    <p style="font-size:15px;line-height:1.7;color:#aeb9d4;margin:0;">
      Your upgraded MILAN storage is now active. You can now use your upgraded DWN storage.
    </p>`;

  return {
    subject,
    text,
    html: shell({
      preheader: 'Your MILAN Storage Upgrade payment has been verified successfully.',
      heading: 'Payment successful',
      bodyHtml,
      email
    })
  };
}

/* ── 5) Generic test email (admin) ────────────────────────────── */
function testEmail({ email = '' } = {}) {
  const subject = 'MILAN mail test — delivery is working ✅';
  const text = [
    'This is a MILAN transactional-email test.', '',
    `If you received this, sending from ${FROM_ADDRESS} is configured correctly.`,
    `Time: ${new Date().toUTCString()}`, '', '— MILAN'
  ].join('\n');
  const bodyHtml = `
    <p style="font-size:15px;line-height:1.7;color:#aeb9d4;margin:0 0 16px;">This is a <strong style="color:#e8eefb;">transactional-email test</strong> from MILAN.</p>
    <p style="font-size:15px;line-height:1.7;color:#aeb9d4;margin:0 0 16px;">If you received this message, sending from <strong style="color:#e8eefb;">${escapeHtml(FROM_ADDRESS)}</strong> is configured correctly. 🎉</p>
    <div style="background:#0d1426;border:1px solid #1e2a44;border-radius:12px;padding:14px 16px;">
      <p style="margin:0;font-size:13px;color:#aeb9d4;"><span style="color:#7e8db0;">Sent at:</span> ${escapeHtml(new Date().toUTCString())}</p>
    </div>`;
  return { subject, text, html: shell({ preheader: 'MILAN mail delivery test.', heading: 'Mail delivery test', bodyHtml, email }) };
}

/* ──────────────────────────────────────────────────────────────
 * Provider senders
 * ────────────────────────────────────────────────────────────── */
async function sendViaResend({ to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], reply_to: REPLY_TO, subject, html, text })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.name || `Resend failed ${res.status}`);
  return { ok: true, provider: 'resend', id: data.id };
}

async function sendViaSendgrid({ to, subject, html, text }) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: FROM_ADDRESS, name: 'MILAN' },
      reply_to: { email: REPLY_TO },
      subject,
      content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }]
    })
  });
  if (!res.ok) {
    const data = await res.text().catch(() => '');
    throw new Error(`SendGrid failed ${res.status}: ${data.slice(0, 160)}`);
  }
  return { ok: true, provider: 'sendgrid' };
}

let _smtpTransport = null;
function getSmtpTransport() {
  if (_smtpTransport) return _smtpTransport;
  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch (_) { throw new Error('nodemailer not installed (run `npm i nodemailer`) to use SMTP'); }
  _smtpTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return _smtpTransport;
}

async function sendViaSmtp({ to, subject, html, text }) {
  const transport = getSmtpTransport();
  const info = await transport.sendMail({ from: FROM_EMAIL, to, replyTo: REPLY_TO, subject, html, text });
  return { ok: true, provider: 'smtp', id: info.messageId };
}

/* ──────────────────────────────────────────────────────────────
 * Public API
 * ────────────────────────────────────────────────────────────── */
function activeProvider() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SENDGRID_API_KEY) return 'sendgrid';
  if (process.env.SMTP_HOST && process.env.SMTP_USER) return 'smtp';
  return null;
}

/** Returns provider config status WITHOUT exposing any secret. */
function mailStatus() {
  const provider = activeProvider();
  return {
    configured: !!provider,
    provider: provider || 'none',
    from: FROM_EMAIL,
    fromAddress: FROM_ADDRESS,
    replyTo: REPLY_TO,
    appUrl: APP_URL,
    loginAlerts: String(process.env.MAIL_LOGIN_ALERTS || 'true') !== 'false',
    requireVerification: String(process.env.MAIL_REQUIRE_VERIFICATION || 'false') === 'true',
    smtp: provider === 'smtp' ? { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: String(process.env.SMTP_SECURE || '') === 'true', user: process.env.SMTP_USER } : undefined
  };
}

// Provider rate-limit guard (e.g. Resend allows ~2 requests/sec). We serialize all
// sends with a minimum ~600ms gap so welcome + verification + alerts never trip it.
let _mailChain = Promise.resolve();
let _mailLast = 0;
function _throttle() {
  _mailChain = _mailChain.then(async () => {
    const wait = Math.max(0, 600 - (Date.now() - _mailLast));
    if (wait) await new Promise(r => setTimeout(r, wait));
    _mailLast = Date.now();
  });
  return _mailChain;
}

async function sendMail({ to, subject, html, text }) {
  if (!to) return { ok: false, skipped: true, reason: 'no recipient' };
  await _throttle();
  try {
    if (process.env.RESEND_API_KEY) return await sendViaResend({ to, subject, html, text });
    if (process.env.SENDGRID_API_KEY) return await sendViaSendgrid({ to, subject, html, text });
    if (process.env.SMTP_HOST && process.env.SMTP_USER) return await sendViaSmtp({ to, subject, html, text });
    console.log(`[MILAN mail] No mail provider configured. Would send "${subject}" to ${to} from ${FROM_ADDRESS}.`);
    return { ok: false, skipped: true, reason: 'no provider configured' };
  } catch (err) {
    console.warn('[MILAN mail] send failed:', err.message);
    return { ok: false, error: err.message };
  }
}

const sendWelcomeEmail = ({ to, name, did } = {}) => { const t = welcomeEmail({ name, email: to, did }); return sendMail({ to, ...t }); };
const sendVerificationEmail = ({ to, name, verifyUrl, code } = {}) => { const t = verifyEmail({ name, email: to, verifyUrl, code }); return sendMail({ to, ...t }); };
const sendPasswordResetEmail = ({ to, name, resetUrl, code } = {}) => { const t = passwordResetEmail({ name, email: to, resetUrl, code }); return sendMail({ to, ...t }); };
const sendLoginAlertEmail = ({ to, name, ip, userAgent, time } = {}) => { const t = loginAlertEmail({ name, email: to, ip, userAgent, time }); return sendMail({ to, ...t }); };
const sendTestEmail = ({ to } = {}) => { const t = testEmail({ email: to }); return sendMail({ to, ...t }); };
const sendPaymentSuccessEmail = ({ to, name, plan, amount, orderId, reference } = {}) => { const t = paymentSuccessEmail({ name, email: to, plan, amount, orderId, reference }); return sendMail({ to, ...t }); };

module.exports = {
  sendMail,
  sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail, sendLoginAlertEmail, sendTestEmail, sendPaymentSuccessEmail,
  welcomeEmail, verifyEmail, passwordResetEmail, loginAlertEmail, testEmail, notificationEmail,
  mailStatus, activeProvider, FROM_ADDRESS, FROM_EMAIL
};
