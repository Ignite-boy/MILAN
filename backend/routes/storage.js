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
  '500mb': { name: '500 MB', quotaBytes: 524288000, amountInr: 500 },
  '1gb': { name: '1 GB', quotaBytes: 1073741824, amountInr: 1000 }
};

function adminRequired(req, res, next) {
  const expected = process.env.ADMIN_TOKEN || 'milan-local-admin-token';
  const given = req.headers['x-admin-token'] || req.query.adminToken || '';
  if (String(given) !== String(expected)) {
    return res.status(401).json({ error: 'Admin token required' });
  }
  next();
}

router.post('/upgrade-request', auth, async (req, res) => {
  try {
    const planKey = String(req.body?.plan || '').trim();
    const utr = String(req.body?.utr || '').trim();
    const plan = PLANS[planKey];

    if (!plan) return res.status(400).json({ error: 'Invalid storage plan.' });
    if (!/^[A-Za-z0-9._-]{6,80}$/.test(utr)) {
      return res.status(400).json({ error: 'Enter a valid UTR / transaction reference.' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('storage_upgrade_requests')
      .select('id,status')
      .eq('utr', utr)
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
        plan: planKey,
        quota_bytes: plan.quotaBytes,
        amount_inr: plan.amountInr,
        payment_method: 'upi_qr',
        utr,
        status: 'pending'
      })
      .select('id,plan,quota_bytes,amount_inr,utr,status,created_at')
      .single();

    if (error) throw error;

    res.status(201).json({ ok: true, request: data });
  } catch (err) {
    console.error('[storage] upgrade request failed:', err.message);
    res.status(500).json({ error: 'Could not submit storage upgrade request.' });
  }
});

router.get('/upgrade-status', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('storage_upgrade_requests')
      .select('id,plan,quota_bytes,amount_inr,utr,status,created_at,reviewed_at,reviewer_note')
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
      .select('id,user_id,plan,quota_bytes,amount_inr,payment_method,utr,status,created_at,reviewed_at,reviewer_note')
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
    const requestId = String(req.params.id || '').trim();
    const note = String(req.body?.note || '').trim().slice(0, 500);

    const { data: request, error: requestError } = await supabase
      .from('storage_upgrade_requests')
      .select('id,user_id,plan,quota_bytes,amount_inr,utr,status')
      .eq('id', requestId)
      .maybeSingle();

    if (requestError) throw requestError;
    if (!request) return res.status(404).json({ error: 'Storage request not found.' });
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `Request is already ${request.status}.` });
    }

    const plan = PLANS[String(request.plan)];
    if (!plan) return res.status(400).json({ error: 'Invalid stored plan.' });

    const { error: userError } = await supabase
      .from('users')
      .update({
        dwn_quota_bytes: plan.quotaBytes,
        storage_plan: request.plan
      })
      .eq('id', request.user_id);

    if (userError) throw userError;

    const { data: updated, error: updateError } = await supabase
      .from('storage_upgrade_requests')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewer_note: note || 'UPI payment verified and storage upgraded.'
      })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select('id,status,plan,quota_bytes,amount_inr,utr,reviewed_at,reviewer_note')
      .single();

    if (updateError) throw updateError;

    res.json({
      ok: true,
      message: `Storage upgraded to ${plan.name}.`,
      request: updated
    });
  } catch (err) {
    console.error('[storage] admin approve failed:', err.message);
    res.status(500).json({ error: 'Could not approve storage upgrade.' });
  }
});

router.post('/admin/requests/:id/reject', adminRequired, async (req, res) => {
  try {
    const requestId = String(req.params.id || '').trim();
    const note = String(req.body?.note || '').trim().slice(0, 500);

    const { data, error } = await supabase
      .from('storage_upgrade_requests')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewer_note: note || 'Payment could not be verified.'
      })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select('id,status,plan,amount_inr,utr,reviewed_at,reviewer_note')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Pending request not found.' });

    res.json({ ok: true, request: data });
  } catch (err) {
    console.error('[storage] admin reject failed:', err.message);
    res.status(500).json({ error: 'Could not reject storage upgrade.' });
  }
});

module.exports = router;
