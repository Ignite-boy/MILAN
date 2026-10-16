# MILAN Transactional Email — Setup & Reference

All MILAN email is sent **from `support@milanlife.in`**. This document covers what was
built, how to turn it on (you said you weren't sure which provider yet — a recommendation
is below), and how to test delivery.

---

## What the app now sends

| Email | Trigger | File |
|---|---|---|
| **Welcome** | On registration | `routes/auth.js` → `mailService.sendWelcomeEmail` |
| **Email verification** | On registration + "resend" | `routes/auth.js` → `sendVerificationEmail` |
| **Password reset** | "Forgot password?" / `/forgot-password` | `routes/auth.js` → `sendPasswordResetEmail` |
| **New sign-in alert** | On every login (toggleable) | `routes/auth.js` → `sendLoginAlertEmail` |
| **Test email** | Admin dashboard → Mail tab | `routes/admin.js` → `sendTestEmail` |

All sends are **fire-and-forget**: if mail fails or no provider is set, registration and
login still succeed. Mail is simply logged and skipped.

### New API endpoints
```
POST /api/auth/verify-email        { email, token } or { email, code }
POST /api/auth/resend-verification { email }
POST /api/auth/forgot-password     { email }
POST /api/auth/reset-password      { email, token|code, password }
GET  /api/admin/mail/status        (admin token)
POST /api/admin/mail/test          { to }   (admin token)
```

### New pages
- `/verify-email` — confirms via link token, or by 6-digit code; can resend.
- `/reset-password` (also `/forgot-password`) — request a link, then set a new password
  (link token or 6-digit code), with a password-strength meter.
- Admin **Mail** tab in `/admin-users` — shows provider status, verified/unverified counts,
  and a one-click **test send**.

---

## Turn it on — pick ONE provider

Set the variables in your environment (Render → Environment, or a local `.env`). See
`backend/.env.example` for the full annotated list.

### ⭐ Recommendation
- **Hosting on Render / any cloud host →** use **Resend**. Outbound SMTP ports are often
  blocked on cloud hosts; Resend sends over HTTPS, so it "just works." You verify the
  `milanlife.in` domain once and paste one API key.
- **You mainly want mail to literally come from your registered `support@milanlife.in`
  mailbox (Zoho / Hostinger / Google Workspace) →** use **SMTP** with that mailbox's
  credentials. `nodemailer` is already a dependency, so no extra install.

### Option A — Resend (recommended for cloud)
1. Create a Resend account, add domain **milanlife.in**, add the DNS records it shows
   (SPF/DKIM) at your domain registrar, wait for "Verified".
2. Create an API key.
3. Set:
   ```
   RESEND_API_KEY=re_xxxxxxxx
   MAIL_FROM=MILAN <support@milanlife.in>
   PUBLIC_BASE_URL=https://milanlife.in
   ```

### Option B — SMTP (your registered mailbox)
Use the SMTP details from whoever hosts the `support@milanlife.in` mailbox. Common ones:
```
# Zoho Mail
SMTP_HOST=smtp.zoho.in     SMTP_PORT=465  SMTP_SECURE=true
# Hostinger
SMTP_HOST=smtp.hostinger.com SMTP_PORT=465 SMTP_SECURE=true
# Google Workspace (use an App Password, not your login password)
SMTP_HOST=smtp.gmail.com   SMTP_PORT=465  SMTP_SECURE=true
```
Then:
```
SMTP_USER=support@milanlife.in
SMTP_PASS=your-mailbox-or-app-password
MAIL_FROM=MILAN <support@milanlife.in>
```
> Note: cloud hosts may block outbound SMTP ports (465/587). If SMTP times out in
> production, switch to Resend (Option A).

### Option C — SendGrid
Verify sender/domain, create an API key, set `SENDGRID_API_KEY=SG.xxxx`.

### Behaviour toggles
```
MAIL_LOGIN_ALERTS=true          # set false to stop the "new sign-in" email
MAIL_REQUIRE_VERIFICATION=true  # New accounts must verify before login; existing accounts are grandfathered
PUBLIC_BASE_URL=https://milanlife.in   # builds the verify/reset links
ADMIN_TOKEN=change-this-admin-token    # protects the admin dashboard + mail test
```

---

## Test delivery

**CLI** (uses your `.env`):
```bash
cd backend
npm install            # ensures nodemailer is present
npm run mail:test -- you@example.com
```
It prints the active provider (no secrets) and sends a real test email.

**Admin dashboard:** open `/admin-users`, unlock with `ADMIN_TOKEN`, go to the **Mail**
tab, enter a recipient, click **Send test**.

If you see *"Not configured"*, no provider env var is set yet.

---

## Security notes
- Verification/reset tokens are random 32-byte values; only their **SHA-256 hash** is
  stored on the user record, with an expiry (24h verify / 1h reset) and single use.
- Token comparison is constant-time (`crypto.timingSafeEqual`).
- `forgot-password` and `resend-verification` always return a generic success message so
  they can't be used to discover which emails are registered.
- All user-supplied values are HTML-escaped in every email template (no injection).
- `/api/admin/mail/status` never returns API keys or SMTP passwords.
