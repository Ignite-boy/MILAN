'use strict';

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const auth = require('../middleware/auth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
    return res.status(503).json({
      error: 'Admin approval is not configured securely.'
    });
  }

  const crypto = require('crypto');
  const givenBuffer = Buffer.from(given);
  const expectedBuffer = Buffer.from(expected);

  if (!given ||
      givenBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(givenBuffer, expectedBuffer)) {
    return res.status(401).json({ error: 'Admin token required' });
  }

  next();
}

// Storage/payment responses contain user quota, UTR and bank-review metadata.
// Prevent browser and intermediary caches from persisting these responses.
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.post('/upgrade-request', auth, async (req, res) => {
  try {
    const planKey = String(req.body?.plan || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    const utr = String(req.body?.utr || '').trim();
    const plan = PLANS[planKey];

    if (!plan) {
      return res.status(400).json({ error: 'Invalid storage plan.' });
    }

    if (!/^MLNPAY_[A-Za-z0-9_-]+_[a-z0-9]+_[a-f0-9]+$/i.test(orderId)) {
      return res.status(400).json({ error: 'Enter a valid MILAN Pay order ID.' });
    }

    if (!/^[A-Za-z0-9._-]{6,80}$/.test(utr)) {
      return res.status(400).json({ error: 'Enter a valid UTR / transaction reference.' });
    }

    const { data: order, error: orderError } = await supabase
      .from('payment_orders')
      .select('order_id,user_id,plan,amount_inr,status,gateway')
      .eq('order_id', orderId)
      .eq('user_id', req.account.id)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order) {
      return res.status(404).json({ error: 'MILAN Pay order not found for this account.' });
    }

    if (order.gateway !== 'milanpay' ||
        order.status !== 'pending' ||
        order.plan !== planKey ||
        Number(order.amount_inr) !== plan.amountInr) {
      return res.status(409).json({
        error: 'Order status, plan, or amount does not match. Create a valid pending MILAN Pay order.'
      });
    }

    const { data: linked, error: linkedError } = await supabase
      .from('storage_upgrade_requests')
      .select('id,status')
      .eq('order_id', orderId)
      .limit(1)
      .maybeSingle();

    if (linkedError) throw linkedError;
    if (linked) {
      return res.status(409).json({
        error: 'A verification request already exists for this order.',
        status: linked.status
      });
    }

    const { data: existing, error: existingError } = await supabase
      .from('storage_upgrade_requests')
      .select('id,status')
      .eq('utr', utr)
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
      return res.status(409).json({
        error: 'This UTR has already been submitted.',
        status: existing.status
      });
    }

    const { data: active, error: activeError } = await supabase
      .from('storage_upgrade_requests')
      .select('id')
      .eq('user_id', req.account.id)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();

    if (activeError) throw activeError;
    if (active) {
      return res.status(409).json({
        error: 'You already have a pending storage upgrade request.'
      });
    }

    const { data, error } = await supabase
      .from('storage_upgrade_requests')
      .insert({
        user_id: req.account.id,
        order_id: orderId,
        plan: planKey,
        quota_bytes: plan.quotaBytes,
        amount_inr: Number(order.amount_inr),
        payment_method: 'upi_qr',
        utr,
        status: 'pending'
      })
      .select('id,order_id,plan,quota_bytes,amount_inr,utr,status,created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'This UTR or order is already linked to a verification request.'
        });
      }
      throw error;
    }

    return res.status(201).json({
      ok: true,
      message: 'UTR submitted. Storage remains unchanged until an administrator independently verifies the bank transaction.',
      request: data
    });
  } catch (err) {
    console.error('[storage] upgrade request failed:', err.message);
    return res.status(500).json({
      error: 'Could not submit the storage verification request.'
    });
  }
});

router.get('/upgrade-status', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('storage_upgrade_requests')
      .select('id,order_id,plan,quota_bytes,amount_inr,utr,status,created_at,reviewed_at,reviewer_note')
      .eq('user_id', req.account.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    res.json({
      ok: true,
      storage: {
        plan: req.account.storage_plan || 'free',
        quotaBytes: Number(req.account.dwn_quota_bytes || 104857600)
      },
      requests: data || []
    });
  } catch (err) {
    console.error('[storage] status failed:', err.message);
    res.status(500).json({ error: 'Could not load storage status.' });
  }
});

router.get('/admin/requests', adminRequired, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('storage_upgrade_requests')
      .select('id,user_id,plan,quota_bytes,amount_inr,payment_method,order_id,utr,status,created_at,reviewed_at,reviewer_note')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ ok: true, requests: data || [] });
  } catch (err) {
    console.error('[storage] admin list failed:', err.message);
    res.status(500).json({ error: 'Could not load storage upgrade requests.' });
  }
});

router.post('/admin/requests/:id/approve', adminRequired, async (req, res) => {
  try {
    if (req.body?.bankVerified !== true) {
      return res.status(400).json({
        error: 'Explicit bank-transaction verification confirmation is required.'
      });
    }

    const requestId = String(req.params.id || '').trim();
    const note = String(req.body?.note || '').trim().slice(0, 500);

    const { data, error } = await supabase.rpc(
      'admin_approve_milan_pay_storage_request',
      {
        p_request_id: requestId,
        p_note: note || null
      }
    );

    if (error) throw error;

    if (!data || data.ok !== true) {
      const status = Number(data?.httpStatus) || 409;
      return res.status(status).json({
        error: data?.error || 'Could not approve the verified storage request.'
      });
    }

    return res.json(data);
  } catch (err) {
    console.error('[storage] admin approve failed:', err.message);
    return res.status(500).json({
      error: 'Could not approve storage request.'
    });
  }
});

router.post('/admin/requests/:id/reject', adminRequired, async (req, res) => {
  try {
    const requestId = String(req.params.id || '').trim();
    const note = String(req.body?.note || '').trim().slice(0, 500);

    const { data: existing, error: lookupError } = await supabase
      .from('storage_upgrade_requests')
      .select('id,order_id,status')
      .eq('id', requestId)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (!existing) return res.status(404).json({ error: 'Storage request not found.' });
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: 'Storage request is no longer pending.' });
    }

    // Preserve the ability to reject older requests not connected to MILAN Pay orders.
    if (!existing.order_id) {
      const { data, error } = await supabase
        .from('storage_upgrade_requests')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          reviewer_note: note || 'Legacy UPI request rejected after review.'
        })
        .eq('id', requestId)
        .eq('status', 'pending')
        .select('id,status,plan,amount_inr,utr,reviewed_at,reviewer_note')
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(409).json({ error: 'Storage request is no longer pending.' });
      return res.json({ ok: true, request: data });
    }

    const { data, error } = await supabase.rpc(
      'admin_reject_milan_pay_storage_request',
      { p_request_id: requestId, p_note: note || null }
    );

    if (error) throw error;
    if (!data || data.ok !== true) {
      return res.status(Number(data?.httpStatus) || 409).json({
        error: data?.error || 'Could not reject the storage request.'
      });
    }

    return res.json(data);
  } catch (err) {
    console.error('[storage] admin reject failed:', err.message);
    return res.status(500).json({ error: 'Could not reject storage request.' });
  }
});

module.exports = router;
