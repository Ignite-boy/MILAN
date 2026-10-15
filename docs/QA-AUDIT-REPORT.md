# MILAN — QA Audit Report

_Date: 2026-06-27 · Scope: static code audit of `milan-app` (frontend + backend)_

## How this audit was done (and its limits)

A true "click every button" manual QA pass needs the app running live in a
browser against its real backend and external services (DWN nodes, UPI payment services,
SMTP/Resend/SendGrid, OpenAI/Gemini/Anthropic, YouTube API). That could not be
done in this environment, so this pass is a **static code audit**: reading the
actual source, hunting for concrete defects, and fixing the safe, clear-cut
ones at the root cause. Anything that needs a live run is listed under
"Needs a running environment".

This report is honest about what was and wasn't verified. It does **not** claim
the app is "100% production-ready" — that claim can only be earned with a live
regression pass.

---

## ✅ Fixed in this pass

### 1. JWT secret mismatch — broke auth / token-forgery hole  (HIGH)
**Files:** `backend/middleware/auth.js`, `backend/routes/auth.js`, new `backend/utils/jwtSecret.js`

The token **signer** (`routes/auth.js`) and the token **verifier**
(`middleware/auth.js`) resolved the JWT secret differently:

- Signer: used `JWT_SECRET`, else (dev) an **ephemeral random** key, else (prod) refused to start.
- Verifier: used `JWT_SECRET`, else the **public constant** `'change-this-secret-in-production'`.

Consequences when `JWT_SECRET` was unset:
- Every authenticated request failed with *"Invalid or expired token"* (signed with a random key, verified against a different constant) — auth effectively broken.
- The verifier would accept any token forged with the publicly-known constant.

**Fix (root cause):** extracted a single shared secret module `utils/jwtSecret.js`
and pointed both the signer and verifier at it, so the secret can never diverge.
Production still refuses to start without a strong `JWT_SECRET`; dev uses one
consistent ephemeral secret across both sides.

### 2. (Earlier in session) UI too large → global compact layer
**Files:** `frontend/milan-compact.css` (new), linked last in `app.html`
Added a desktop-only proportional shrink layer (`zoom`) so the whole shell reads
more compact without breaking the mobile/Android layouts.

---

## ⚠️ Found — recommend fixing (not auto-changed, to avoid regressions)

### A. Passwords hashed with unsalted SHA-256  (HIGH, security)
**File:** `backend/routes/auth.js` (`sha256 = v => crypto.createHash('sha256')...`)
SHA-256 without a per-user salt is fast to brute-force and vulnerable to rainbow
tables. Industry standard is **bcrypt/scrypt/argon2**.
**Why not auto-fixed:** changing the hash invalidates every existing stored
password. Safe migration: verify against old SHA-256 on login, then transparently
re-hash with bcrypt and store the new hash. Needs a deliberate migration + live test.

### B. `JWT_SECRET` must be set in production
Confirm the production environment exports a long random `JWT_SECRET` (≥ 32 random
bytes). With the fix above, the server now **refuses to start** in production
without one — verify your deploy sets it, or the app won't boot.

### C. CORS reflects any origin
**File:** `backend/server.js` (`cors({ origin: process.env.CORS_ORIGIN || true })`)
`origin: true` echoes back any requesting origin. `credentials:false` limits the
blast radius (no cookies), but set `CORS_ORIGIN` to your real domain in prod.

---

## 🧪 Needs a running environment (could not verify statically)

These require the live app + browser and should be walked through before launch:

- Auth flows end-to-end: signup, email verify, login, password reset, logout, session expiry, "sign out everywhere".
- File / image / video upload (size limits, type validation, failure handling).
- Feed: like, comment, share, follow, pagination / infinite scroll, real-time updates.
- Payments / MILAN Pay — direct UPI intent and QR checkout are present; manual bank verification is required. Real-device payment and bank-credit reconciliation still need explicit testing.
- Notifications, chat/messaging, search, filters.
- Responsiveness on real mobile / tablet / desktop widths.
- Console-error sweep and network-failure / offline / slow-connection behavior.
- Accessibility (keyboard nav, focus order, contrast, ARIA).

---

## Note on tooling
The sandbox's mirror of the project served **stale/truncated copies** of some JS
files (e.g. `server.js`, `milan-core.js`, `milan-more-menu.js` looked cut
off). The **actual files on disk are complete and valid** — verified directly.
So any `node --check` run inside that sandbox will report false "Unexpected end
of input" errors; ignore those. Run lint/tests in your own local checkout.

## Suggested next steps
1. Set `JWT_SECRET` (and `CORS_ORIGIN`) in the production env.
2. Plan the bcrypt password-migration (item A).
3. Do a live regression pass of the flows under "Needs a running environment".
