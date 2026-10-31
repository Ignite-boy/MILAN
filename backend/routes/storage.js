'use strict';

const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const db = require('../services/milanDb');
const createDistributedApiRateLimiter = require('../middleware/distributedApiRateLimiter');

const router = express.Router();

const submitUpgradeRequestLimiter = createDistributedApiRateLimiter({
  limit: 6, windowMs: 60_000, scope: 'storage-upgrade-request'
});
const adminStorageActionLimiter = createDistributedApiRateLimiter({
  limit: 30, windowMs: 60_000, scope: 'storage-admin-actions'
});

const PLANS = {
  '500mb': { name: '500 MB', quotaBytes: 524288000, amountInr: 250 },
  '1gb': { name: '1 GB', quotaBytes: 1073741824, amountInr: 500 }
};

function adminRequired(req, res, next) {
  const expected = String(process.env.ADMIN_TOKEN || '').trim();
  const given = String(req.headers['x-admin-token'] || '');

  if (!expected ||
      expected === 'change-this-admin-token' ||
      expected === 'milan-local-admin-token') {
    return res.status(503).json({ error: 'Admin approval is not configured securely.' });
  }

  const givenBuffer = Buffer.from(given);
  const expectedBuffer = Buffer.from(expected);

  if (!given || givenBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(givenBuffer, expectedBuffer)) {
    return res.status(401).json({ error: 'Admin token required' });
  }
  return next();
}

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.post('/upgrade-request', submitUpgradeRequestLimiter, auth, async (req, res) => {
  const planKey = String(req.body?.plan || '').trim();
  const orderId = String(req.body?.orderId || '').trim();
  const utr = String(req.body?.utr || '').trim();
  const plan = PLANS[planKey];

  try {
    if (!plan) return res.status(400).json({ error: 'Invalid storage plan.' });

    const currentQuotaBytes = Number(
      req.account.dwnQuotaBytes || req.account.dwn_quota_bytes || 1073741824
    );
    if (!Number.isSafeInteger(currentQuotaBytes) || currentQuotaBytes < 1) {
      return res.status(503).json({
        error: 'Your current storage quota could not be verified.'
      });
    }
    if (currentQuotaBytes >= plan.quotaBytes) {
      return res.status(409).json({
        code: 'STORAGE_PLAN_NOT_AN_UPGRADE',
        error: 'Your account already has an equal or higher storage quota.'
      });
    }
    if (!/^MLNPAY_[A-Za-z0-9_-]+_[a-z0-9]+_[a-f0-9]+$/i.test(orderId)) {
      return res.status(400).json({ error: 'Enter a valid MILAN Pay order ID.' });
    }
    if (!/^[A-Za-z0-9._-]{6,80}$/.test(utr)) {
      return res.status(400).json({ error: 'Enter a valid UTR / transaction reference.' });
    }

    const orderResult = await db.query(
      `SELECT order_id, user_id, plan, amount_inr, status, gateway
         FROM public.payment_orders
        WHERE order_id = $1 AND user_id = $2
        LIMIT 1`,
      [orderId, req.account.id]
    );

    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: 'MILAN Pay order not found for this account.' });

    if (order.gateway !== 'milanpay' || order.status !== 'pending' ||
        order.plan !== planKey || Number(order.amount_inr) !== plan.amountInr) {
      return res.status(409).json({
        error: 'Order status, plan, or amount does not match. Create a valid pending MILAN Pay order.'
      });
    }

    const linked = await db.query(
      `SELECT id, user_id, order_id, plan, quota_bytes, amount_inr, utr, status, created_at
         FROM public.storage_upgrade_requests
        WHERE order_id = $1 AND user_id = $2
        LIMIT 1`,
      [orderId, req.account.id]
    );
    const existing = linked.rows[0];
    if (existing) {
      const sameUtr =
        String(existing.utr || '').trim().toLowerCase() === utr.toLowerCase();
      const samePlan =
        existing.plan === planKey &&
        Number(existing.amount_inr) === plan.amountInr;

      if (sameUtr && samePlan) {
        return res.status(200).json({
          ok: true,
          reused: true,
          message: 'This UTR was already submitted. The existing request remains subject to independent bank verification.',
          request: existing
        });
      }

      return res.status(409).json({
        error: 'A verification request already exists for this order with a different UTR.',
        status: existing.status
      });
    }

    const duplicateUtr = await db.query(
      `SELECT id, status
         FROM public.storage_upgrade_requests
        WHERE lower(btrim(utr)) = lower(btrim($1))
        LIMIT 1`,
      [utr]
    );
    if (duplicateUtr.rows.length) {
      return res.status(409).json({
        error: 'This UTR has already been submitted.',
        status: duplicateUtr.rows[0].status
      });
    }

    const active = await db.query(
      `SELECT id
         FROM public.storage_upgrade_requests
        WHERE user_id = $1 AND status = 'pending'
        LIMIT 1`,
      [req.account.id]
    );
    if (active.rows.length) {
      return res.status(409).json({ error: 'You already have a pending storage upgrade request.' });
    }

    const inserted = await db.query(
      `INSERT INTO public.storage_upgrade_requests
         (user_id, order_id, plan, quota_bytes, amount_inr, payment_method, utr)
         VALUES ($1, $2, $3, $4, $5, 'upi_qr', $6)
       RETURNING id, order_id, plan, quota_bytes, amount_inr, utr, status, created_at`,
      [req.account.id, orderId, planKey, plan.quotaBytes, order.amount_inr, utr]
    );

    return res.status(201).json({
      ok: true,
      message: 'UTR submitted. Storage remains unchanged until an administrator independently verifies the bank transaction.',
      request: inserted.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') {
      try {
        const conflictLookup = await db.query(
          `SELECT id, user_id, order_id, plan, quota_bytes, amount_inr, utr, status, created_at
             FROM public.storage_upgrade_requests
            WHERE order_id = $1 AND user_id = $2
            LIMIT 1`,
          [orderId, req.account.id]
        );
        const existing = conflictLookup.rows[0];
        const sameUtr = existing &&
          String(existing.utr || '').trim().toLowerCase() === utr.toLowerCase();
        const samePlan = existing &&
          existing.plan === planKey &&
          Number(existing.amount_inr) === plan.amountInr;

        if (sameUtr && samePlan) {
          return res.status(200).json({
            ok: true,
            reused: true,
            message: 'This UTR was already submitted. The existing request remains subject to independent bank verification.',
            request: existing
          });
        }
      } catch (lookupError) {
        console.error('[storage] upgrade conflict lookup failed:', lookupError.message);
      }

      return res.status(409).json({
        error: 'This UTR, order or pending request is already linked to a verification request.'
      });
    }
    console.error('[storage] upgrade request failed:', error.message);
    return res.status(500).json({ error: 'Could not submit the storage verification request.' });
  }
});

router.get('/upgrade-status', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, order_id, plan, quota_bytes, amount_inr, utr, status,
              created_at, reviewed_at, reviewer_note
         FROM public.storage_upgrade_requests
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 10`,
      [req.account.id]
    );

    return res.json({
      ok: true,
      storage: {
        plan: req.account.storage_plan || 'free',
        quotaBytes: Number(req.account.dwn_quota_bytes || 1073741824)
      },
      requests: result.rows
    });
  } catch (error) {
    console.error('[storage] status failed:', error.message);
    return res.status(500).json({ error: 'Could not load storage status.' });
  }
});

router.get('/admin/requests', adminStorageActionLimiter, adminRequired, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, user_id, plan, quota_bytes, amount_inr, payment_method,
              order_id, utr, status, created_at, reviewed_at, reviewer_note
         FROM public.storage_upgrade_requests
        WHERE status = 'pending'
        ORDER BY created_at ASC`
    );
    return res.json({ ok: true, requests: result.rows });
  } catch (error) {
    console.error('[storage] admin list failed:', error.message);
    return res.status(500).json({ error: 'Could not load storage upgrade requests.' });
  }
});

router.post('/admin/requests/:id/approve', adminStorageActionLimiter, adminRequired, async (req, res) => {
  try {
    if (req.body?.bankVerified !== true) {
      return res.status(400).json({
        error: 'Explicit bank-transaction verification confirmation is required.'
      });
    }

    const requestId = String(req.params.id || '').trim();
    const note = String(req.body?.note || '').trim().slice(0, 500);

    const result = await db.query(
      'SELECT public.admin_approve_milan_pay_storage_request($1, $2) AS data',
      [requestId, note || null]
    );
    const data = result.rows[0]?.data;

    if (!data || data.ok !== true) {
      return res.status(Number(data?.httpStatus) || 409).json({
        error: data?.error || 'Could not approve the verified storage request.'
      });
    }
    return res.json(data);
  } catch (error) {
    console.error('[storage] admin approve failed:', error.message);
    return res.status(500).json({ error: 'Could not approve storage request.' });
  }
});

router.post('/admin/requests/:id/reject', adminStorageActionLimiter, adminRequired, async (req, res) => {
  try {
    const requestId = String(req.params.id || '').trim();
    const note = String(req.body?.note || '').trim().slice(0, 500);

    const lookup = await db.query(
      `SELECT id, order_id, status
         FROM public.storage_upgrade_requests
        WHERE id::text = $1
        LIMIT 1`,
      [requestId]
    );
    const existing = lookup.rows[0];

    if (!existing) return res.status(404).json({ error: 'Storage request not found.' });
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: 'Storage request is no longer pending.' });
    }

    if (!existing.order_id) {
      const legacyResult = await db.query(
        'SELECT public.admin_reject_legacy_milan_storage_request($1, $2) AS data',
        [requestId, note || null]
      );
      const legacyData = legacyResult.rows[0]?.data;

      if (!legacyData || legacyData.ok !== true) {
        return res.status(Number(legacyData?.httpStatus) || 409).json({
          error: legacyData?.error || 'Could not reject the legacy storage request.'
        });
      }
      return res.json(legacyData);
    }

    const result = await db.query(
      'SELECT public.admin_reject_milan_pay_storage_request($1, $2) AS data',
      [requestId, note || null]
    );
    const data = result.rows[0]?.data;

    if (!data || data.ok !== true) {
      return res.status(Number(data?.httpStatus) || 409).json({
        error: data?.error || 'Could not reject the storage request.'
      });
    }
    return res.json(data);
  } catch (error) {
    console.error('[storage] admin reject failed:', error.message);
    return res.status(500).json({ error: 'Could not reject storage request.' });
  }
});

module.exports = router;
