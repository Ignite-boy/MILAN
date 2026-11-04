'use strict';

const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const db = require('../services/milanDb');
const createDistributedApiRateLimiter = require('../middleware/distributedApiRateLimiter');
const cashfree = require('../services/cashfreeGateway');

const router = express.Router();

const createOrderRateLimiter = createDistributedApiRateLimiter({
  limit: 8,
  windowMs: 60_000,
  scope: 'cashfree-order-create'
});

const verifyOrderRateLimiter = createDistributedApiRateLimiter({
  limit: 60,
  windowMs: 60_000,
  scope: 'cashfree-order-verify'
});

const PLANS = {
  '500mb': { amountInr: 250, quotaBytes: 524288000 },
  '1gb': { amountInr: 500, quotaBytes: 1073741824 }
};

const ORDER_ID_RE = /^MLNCF_[a-z0-9]+_[a-f0-9]{16}$/;

class CashfreeRouteError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'CashfreeRouteError';
    this.status = status;
    this.code = code;
  }
}

function routeError(status, code, message) {
  return new CashfreeRouteError(status, code, message);
}

function providerReady() {
  const config = cashfree.settings();

  if (!config.enabled) {
    throw routeError(
      503,
      'CASHFREE_DISABLED',
      'Cashfree checkout is currently disabled.'
    );
  }

  if (!config.configured) {
    throw routeError(
      503,
      'CASHFREE_NOT_CONFIGURED',
      'Cashfree provider configuration is incomplete.'
    );
  }

  return config;
}

function makeOrderId() {
  return `MLNCF_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;
}

function publicOrigin(environment) {
  const raw = String(
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_PUBLIC_URL ||
    process.env.SEO_CANONICAL_URL ||
    'https://milanlife.in'
  ).trim();

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw routeError(
      503,
      'CASHFREE_RETURN_URL_INVALID',
      'The public checkout URL is not configured correctly.'
    );
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw routeError(
      503,
      'CASHFREE_RETURN_URL_INVALID',
      'The public checkout URL must be a clean HTTPS origin.'
    );
  }

  return parsed.origin;
}

function makeProviderOrderRequest(order, userId, plan) {
  const config = providerReady();
  const origin = publicOrigin(config.environment);

  return {
    order_id: order.order_id,
    order_amount: plan.amountInr,
    order_currency: 'INR',
    customer_details: {
      customer_id: `milan_${String(userId).replace(/-/g, '')}`,
      customer_phone: order.customer_phone
    },
    order_meta: {
      return_url: `${origin}/milan-pay?order_id={order_id}`,
      notify_url: `${origin}/api/cashfree/webhook`
    }
  };
}

function normalizeJson(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }

  return value && typeof value === 'object' ? value : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoTimeOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sendRouteError(res, error, fallbackMessage) {
  const known =
    error instanceof CashfreeRouteError ||
    error instanceof cashfree.CashfreeGatewayError;

  const status = known ? error.status : 500;
  const code = known ? error.code : 'CASHFREE_INTERNAL_ERROR';
  const message = known ? error.message : fallbackMessage;

  console.error('[Cashfree] Request failed:', code);
  return res.status(status).json({
    ok: false,
    code,
    error: message
  });
}

function assertProviderOrder(providerOrder, localOrder) {
  if (
    !providerOrder ||
    String(providerOrder.order_id || '') !== String(localOrder.order_id) ||
    String(providerOrder.cf_order_id || '') !== String(localOrder.cf_order_id || '') ||
    numberOrNull(providerOrder.order_amount) !== Number(localOrder.amount_inr) ||
    String(providerOrder.order_currency || '').toUpperCase() !== 'INR'
  ) {
    throw routeError(
      502,
      'CASHFREE_PROVIDER_ORDER_MISMATCH',
      'Cashfree order details could not be independently verified.'
    );
  }
}

async function attachProviderOrder(localOrder, userId, plan) {
  if (localOrder.provider_payment_session_id && localOrder.cf_order_id) {
    return {
      paymentSessionId: localOrder.provider_payment_session_id,
      environment: providerReady().environment
    };
  }

  if (
    !localOrder.provider_idempotency_key ||
    !localOrder.customer_phone ||
    !/^[6-9][0-9]{9}$/.test(localOrder.customer_phone)
  ) {
    throw routeError(
      409,
      'CASHFREE_ORDER_STATE_INVALID',
      'The saved Cashfree order cannot safely be resumed. Contact support.'
    );
  }

  const requestBody = makeProviderOrderRequest(localOrder, userId, plan);

  // The same saved UUID and identical request body are reused after timeouts.
  const providerOrder = await cashfree.createOrder(
    requestBody,
    localOrder.provider_idempotency_key
  );

  const cfOrderId = String(providerOrder?.cf_order_id || '');
  const paymentSessionId = String(providerOrder?.payment_session_id || '');

  if (
    String(providerOrder?.order_id || '') !== localOrder.order_id ||
    numberOrNull(providerOrder?.order_amount) !== plan.amountInr ||
    String(providerOrder?.order_currency || '').toUpperCase() !== 'INR' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(cfOrderId) ||
    !paymentSessionId ||
    paymentSessionId.length > 4096
  ) {
    throw routeError(
      502,
      'CASHFREE_PROVIDER_ORDER_INVALID',
      'Cashfree returned an invalid order response. Retry safely or contact support.'
    );
  }

  const attachResult = await db.query(
    `SELECT public.attach_cashfree_order(
       $1::text, $2::uuid, $3::text, $4::text
     ) AS data`,
    [
      localOrder.order_id,
      userId,
      cfOrderId,
      paymentSessionId
    ]
  );

  const attached = normalizeJson(attachResult.rows?.[0]?.data);

  if (!attached?.ok) {
    throw routeError(
      Number(attached?.httpStatus) || 409,
      'CASHFREE_ORDER_ATTACH_FAILED',
      'The Cashfree order could not be securely attached to your account.'
    );
  }

  return {
    paymentSessionId,
    environment: providerReady().environment
  };
}

async function recordPaymentEvent({
  eventHash,
  payloadHash,
  eventType,
  eventTime,
  orderId,
  cfOrderId,
  payment
}) {
  const paymentId =
    payment?.cf_payment_id === null || payment?.cf_payment_id === undefined
      ? null
      : String(payment.cf_payment_id);

  const result = await db.query(
    `SELECT public.process_cashfree_payment_event(
       $1::text,
       $2::text,
       $3::text,
       $4::timestamptz,
       $5::text,
       $6::text,
       $7::text,
       $8::text,
       $9::numeric,
       $10::text,
       $11::numeric,
       $12::text,
       $13::text,
       $14::text
     ) AS data`,
    [
      eventHash,
      payloadHash,
      eventType,
      eventTime,
      orderId,
      cfOrderId,
      paymentId,
      payment?.payment_status || null,
      numberOrNull(payment?.order_amount),
      payment?.order_currency || null,
      numberOrNull(payment?.payment_amount),
      payment?.payment_currency || null,
      payment?.payment_group || null,
      payment?.bank_reference || null
    ]
  );

  return normalizeJson(result.rows?.[0]?.data);
}

async function hasUnresolvedPaymentReview(orderId) {
  const result = await db.query(
    `SELECT (
       EXISTS (
         SELECT 1
           FROM public.cashfree_payment_attempts
          WHERE order_id = $1
            AND processing_status = 'review_required'
       )
       OR EXISTS (
         SELECT 1
           FROM public.cashfree_webhook_events
          WHERE order_id = $1
            AND processing_status = 'review_required'
       )
     ) AS review_required`,
    [orderId]
  );

  return result.rows?.[0]?.review_required === true;
}

function makeReconciliationHashes(order, payment) {
  const safeEvent = {
    source: 'cashfree-reconciliation',
    order_id: order.order_id,
    cf_order_id: order.cf_order_id,
    order_amount: order.order_amount,
    order_currency: order.order_currency,
    payment: {
      cf_payment_id: payment.cf_payment_id ?? null,
      order_id: payment.order_id ?? null,
      payment_status: payment.payment_status ?? null,
      payment_amount: payment.payment_amount ?? null,
      payment_currency: payment.payment_currency ?? null,
      payment_group: payment.payment_group ?? null,
      bank_reference: payment.bank_reference ?? null,
      payment_time: payment.payment_time ?? null,
      payment_completion_time: payment.payment_completion_time ?? null
    }
  };

  const raw = Buffer.from(JSON.stringify(safeEvent), 'utf8');
  const payloadHash = cashfree.hashPayload(raw);
  const eventHash = crypto.createHash('sha256')
    .update('cashfree-reconciliation.', 'utf8')
    .update(raw)
    .digest('hex');

  return { eventHash, payloadHash };
}

async function getVerifiedProviderOrder(orderId, localOrder = null) {
  const providerOrder = await cashfree.getOrder(orderId);

  if (
    !providerOrder ||
    String(providerOrder.order_id || '') !== orderId ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(String(providerOrder.cf_order_id || '')) ||
    numberOrNull(providerOrder.order_amount) === null ||
    String(providerOrder.order_currency || '').toUpperCase() !== 'INR'
  ) {
    throw routeError(
      502,
      'CASHFREE_PROVIDER_ORDER_INVALID',
      'Cashfree order details could not be independently verified.'
    );
  }

  if (localOrder) assertProviderOrder(providerOrder, localOrder);
  return providerOrder;
}

router.get('/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    ok: true,
    ...cashfree.publicConfig()
  });
});

router.post('/orders', createOrderRateLimiter, auth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const config = providerReady();
    const planKey = String(req.body?.plan || '').trim();
    const plan = PLANS[planKey];

    if (!plan) {
      return res.status(400).json({
        ok: false,
        code: 'CASHFREE_INVALID_PLAN',
        error: 'Invalid storage plan.'
      });
    }

    const phone = String(req.body?.phone || '').trim();
    if (!/^[6-9][0-9]{9}$/.test(phone)) {
      return res.status(400).json({
        ok: false,
        code: 'CASHFREE_INVALID_PHONE',
        error: 'Enter a valid 10-digit Indian mobile number.'
      });
    }

    const currentQuotaValue =
      req.account?.dwnQuotaBytes ?? req.account?.dwn_quota_bytes;
    const currentQuota = Number(currentQuotaValue);

    if (
      currentQuotaValue === null ||
      currentQuotaValue === undefined ||
      !Number.isSafeInteger(currentQuota) ||
      currentQuota < 1
    ) {
      throw routeError(
        503,
        'STORAGE_QUOTA_UNAVAILABLE',
        'Your current storage quota could not be verified. No order was created.'
      );
    }

    if (currentQuota >= plan.quotaBytes) {
      return res.status(409).json({
        ok: false,
        code: 'STORAGE_PLAN_NOT_AN_UPGRADE',
        error: 'Your account already has an equal or higher storage quota.'
      });
    }

    const activeRequest = await db.query(
      `SELECT id
         FROM public.storage_upgrade_requests
        WHERE user_id = $1
          AND status = 'pending'
        LIMIT 1`,
      [req.account.id]
    );

    if (activeRequest.rows?.length) {
      return res.status(409).json({
        ok: false,
        code: 'STORAGE_REQUEST_PENDING',
        error: 'Your existing storage request is awaiting verification.'
      });
    }

    const pendingResult = await db.query(
      `SELECT order_id, plan, amount_inr, status, gateway,
              provider_idempotency_key, customer_phone,
              cf_order_id, provider_payment_session_id
         FROM public.payment_orders
        WHERE user_id = $1
          AND gateway IN ('milanpay', 'cashfree')
          AND status = 'pending'
        ORDER BY created_at ASC
        LIMIT 2`,
      [req.account.id]
    );

    const pendingOrders = pendingResult.rows || [];

    if (pendingOrders.length > 1) {
      return res.status(409).json({
        ok: false,
        code: 'PAYMENT_PENDING_ORDER_RECONCILIATION_REQUIRED',
        error: 'Multiple pending payment orders need support reconciliation.'
      });
    }

    let localOrder = pendingOrders[0] || null;
    let created = false;

    if (localOrder) {
      if (localOrder.gateway !== 'cashfree') {
        return res.status(409).json({
          ok: false,
          code: 'OTHER_PAYMENT_ORDER_PENDING',
          error: 'You already have a pending UPI payment order. Resolve it before creating another payment.'
        });
      }

      if (
        localOrder.plan !== planKey ||
        Number(localOrder.amount_inr) !== plan.amountInr
      ) {
        return res.status(409).json({
          ok: false,
          code: 'CASHFREE_PENDING_ORDER_EXISTS',
          error: 'A Cashfree order for a different storage plan is already pending.'
        });
      }

      if (localOrder.customer_phone !== phone) {
        return res.status(409).json({
          ok: false,
          code: 'CASHFREE_PENDING_PHONE_MISMATCH',
          error: 'The pending order is linked to a different mobile number. Contact support before creating another order.'
        });
      }
    } else {
      const orderId = makeOrderId();
      const idempotencyKey = crypto.randomUUID();

      try {
        const inserted = await db.query(
          `INSERT INTO public.payment_orders (
             user_id, order_id, plan, amount_inr, gateway,
             provider_idempotency_key, customer_phone
           )
           VALUES ($1, $2, $3, $4, 'cashfree', $5, $6)
           RETURNING order_id, plan, amount_inr, status, gateway,
                     provider_idempotency_key, customer_phone,
                     cf_order_id, provider_payment_session_id`,
          [
            req.account.id,
            orderId,
            planKey,
            plan.amountInr,
            idempotencyKey,
            phone
          ]
        );

        localOrder = inserted.rows?.[0] || null;
        created = true;
      } catch (error) {
        if (error?.code === '23505') {
          return res.status(409).json({
            ok: false,
            code: 'CASHFREE_PENDING_ORDER_EXISTS',
            error: 'Another pending payment order was created at the same time. Retry once to resume it.'
          });
        }
        throw error;
      }
    }

    if (!localOrder) {
      throw routeError(
        500,
        'CASHFREE_LOCAL_ORDER_MISSING',
        'The local payment order could not be loaded.'
      );
    }

    if (await hasUnresolvedPaymentReview(localOrder.order_id)) {
      return res.status(409).json({
        ok: false,
        code: 'CASHFREE_PAYMENT_REVIEW_REQUIRED',
        error: 'This payment requires reconciliation. Do not retry checkout; contact MILAN support.'
      });
    }

    const provider = await attachProviderOrder(
      localOrder,
      req.account.id,
      plan
    );

    return res.status(created ? 201 : 200).json({
      ok: true,
      provider: 'cashfree',
      orderId: localOrder.order_id,
      amountInr: plan.amountInr,
      currency: 'INR',
      plan: planKey,
      status: 'pending',
      reusedOrder: !created,
      paymentSessionId: provider.paymentSessionId,
      environment: provider.environment
    });
  } catch (error) {
    return sendRouteError(
      res,
      error,
      'Could not create a Cashfree payment order.'
    );
  }
});

router.post(
  '/orders/:orderId/verify',
  verifyOrderRateLimiter,
  auth,
  async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    try {
      const orderId = String(req.params.orderId || '').trim();

      if (!ORDER_ID_RE.test(orderId)) {
        return res.status(400).json({
          ok: false,
          code: 'CASHFREE_INVALID_ORDER_ID',
          error: 'Invalid Cashfree order ID.'
        });
      }

      const localResult = await db.query(
        `SELECT order_id, user_id, plan, amount_inr, status,
                gateway, cf_order_id, provider_payment_id
           FROM public.payment_orders
          WHERE order_id = $1
            AND user_id = $2
            AND gateway = 'cashfree'
          LIMIT 1`,
        [orderId, req.account.id]
      );

      const localOrder = localResult.rows?.[0];
      if (!localOrder) {
        return res.status(404).json({
          ok: false,
          code: 'CASHFREE_ORDER_NOT_FOUND',
          error: 'Cashfree order not found.'
        });
      }

      const plan = PLANS[localOrder.plan];
      if (!plan || Number(localOrder.amount_inr) !== plan.amountInr) {
        throw routeError(
          409,
          'CASHFREE_STORED_ORDER_INVALID',
          'The stored payment plan or amount is invalid. Contact support.'
        );
      }

      if (localOrder.status === 'paid') {
        return res.json({
          ok: true,
          orderId,
          status: 'paid',
          finalized: true,
          amountInr: plan.amountInr,
          plan: localOrder.plan
        });
      }

      if (localOrder.status !== 'pending' || !localOrder.cf_order_id) {
        return res.status(409).json({
          ok: false,
          code: 'CASHFREE_ORDER_NOT_VERIFIABLE',
          error: 'This Cashfree order is not ready for payment verification.'
        });
      }

      const providerOrder = await getVerifiedProviderOrder(
        orderId,
        {
          ...localOrder,
          amount_inr: plan.amountInr
        }
      );

      const payments = await cashfree.getPayments(orderId);
      if (!Array.isArray(payments)) {
        throw routeError(
          502,
          'CASHFREE_PAYMENTS_RESPONSE_INVALID',
          'Cashfree payment history could not be verified.'
        );
      }

      if (payments.length > 100) {
        throw routeError(
          502,
          'CASHFREE_PAYMENTS_RESPONSE_TOO_LARGE',
          'Cashfree returned an unexpectedly large payment history.'
        );
      }

      let reviewRequired = false;
      let processedCount = 0;

      for (const payment of payments) {
        if (
          payment?.order_id &&
          String(payment.order_id) !== orderId
        ) {
          throw routeError(
            502,
            'CASHFREE_PAYMENT_ORDER_MISMATCH',
            'Cashfree returned a payment for a different order.'
          );
        }

        const hashes = makeReconciliationHashes(providerOrder, payment || {});
        const recorded = await recordPaymentEvent({
          ...hashes,
          eventType: 'PAYMENT_RECONCILIATION',
          eventTime: isoTimeOrNull(
            payment?.payment_time || payment?.payment_completion_time
          ),
          orderId,
          cfOrderId: String(providerOrder.cf_order_id),
          payment: {
            ...payment,
            order_amount: providerOrder.order_amount,
            order_currency: providerOrder.order_currency
          }
        });

        processedCount++;
        if (recorded?.reviewRequired) reviewRequired = true;
      }

      reviewRequired = reviewRequired ||
        await hasUnresolvedPaymentReview(orderId);

      const refreshed = await db.query(
        `SELECT status, paid_at
           FROM public.payment_orders
          WHERE order_id = $1
            AND user_id = $2
            AND gateway = 'cashfree'
          LIMIT 1`,
        [orderId, req.account.id]
      );

      const latest = refreshed.rows?.[0];
      if (!latest) {
        throw routeError(
          500,
          'CASHFREE_ORDER_REFRESH_FAILED',
          'Could not refresh the payment status.'
        );
      }

      return res.json({
        ok: true,
        orderId,
        status: latest.status,
        paidAt: latest.paid_at || null,
        plan: localOrder.plan,
        amountInr: plan.amountInr,
        verifiedPayments: processedCount,
        reviewRequired
      });
    } catch (error) {
      return sendRouteError(
        res,
        error,
        'Could not verify the Cashfree payment.'
      );
    }
  }
);

async function webhookHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const rawBody = req.body;
    const timestamp = req.get('x-webhook-timestamp');
    const signature = req.get('x-webhook-signature');

    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      return res.status(400).json({
        ok: false,
        code: 'CASHFREE_WEBHOOK_RAW_BODY_REQUIRED'
      });
    }

    if (!cashfree.verifyWebhookSignature(rawBody, timestamp, signature)) {
      return res.status(401).json({
        ok: false,
        code: 'CASHFREE_WEBHOOK_SIGNATURE_INVALID'
      });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch (_) {
      return res.status(400).json({
        ok: false,
        code: 'CASHFREE_WEBHOOK_INVALID_JSON'
      });
    }

    const eventType = String(event?.type || '').trim();
    if (!eventType.startsWith('PAYMENT_')) {
      // Refund and other event types are not payment-settlement events.
      return res.status(200).json({
        ok: true,
        ignored: true
      });
    }

    const orderId = String(event?.data?.order?.order_id || '').trim();
    if (!ORDER_ID_RE.test(orderId)) {
      console.error('[Cashfree] Signed payment webhook has an invalid merchant order ID.');
      return res.status(200).json({
        ok: true,
        reviewRequired: true
      });
    }

    const providerOrder = await getVerifiedProviderOrder(orderId);
    const webhookCfOrderId =
      event?.data?.order?.cf_order_id === null ||
      event?.data?.order?.cf_order_id === undefined
        ? ''
        : String(event.data.order.cf_order_id);

    if (
      webhookCfOrderId &&
      webhookCfOrderId !== String(providerOrder.cf_order_id)
    ) {
      throw routeError(
        503,
        'CASHFREE_WEBHOOK_ORDER_ID_MISMATCH',
        'Webhook order details do not match the provider order.'
      );
    }

    const webhookPayment = event?.data?.payment || {};
    const webhookPaymentId =
      webhookPayment.cf_payment_id === null ||
      webhookPayment.cf_payment_id === undefined
        ? ''
        : String(webhookPayment.cf_payment_id);

    let verifiedPayment = {
      cf_payment_id: webhookPaymentId || null,
      order_id: orderId,
      payment_status: webhookPayment.payment_status || null,
      payment_amount: webhookPayment.payment_amount ?? null,
      payment_currency: webhookPayment.payment_currency || null,
      payment_group: webhookPayment.payment_group || null,
      bank_reference: webhookPayment.bank_reference || null
    };

    if (/^[A-Za-z0-9_-]{1,64}$/.test(webhookPaymentId)) {
      const fetchedPayment = await cashfree.getPayment(
        orderId,
        webhookPaymentId
      );

      if (
        !fetchedPayment ||
        String(fetchedPayment.order_id || '') !== orderId ||
        String(fetchedPayment.cf_payment_id || '') !== webhookPaymentId
      ) {
        throw routeError(
          503,
          'CASHFREE_WEBHOOK_PAYMENT_MISMATCH',
          'Webhook payment details do not match the provider payment record.'
        );
      }

      verifiedPayment = fetchedPayment;
    }

    const result = await recordPaymentEvent({
      eventHash: cashfree.hashWebhookEvent(timestamp, rawBody),
      payloadHash: cashfree.hashPayload(rawBody),
      eventType,
      eventTime: isoTimeOrNull(event?.event_time),
      orderId,
      cfOrderId: String(providerOrder.cf_order_id),
      payment: {
        ...verifiedPayment,
        order_amount: providerOrder.order_amount,
        order_currency: providerOrder.order_currency
      }
    });

    // A durable review_required event is acknowledged to prevent futile retries.
    return res.status(200).json({
      ok: true,
      duplicateEvent: result?.duplicateEvent === true,
      reviewRequired: result?.reviewRequired === true,
      paymentStatus: result?.paymentStatus || null
    });
  } catch (error) {
    // Provider or database failures are retryable; never acknowledge lost events.
    console.error(
      '[Cashfree] Webhook processing failed:',
      error?.code || 'CASHFREE_WEBHOOK_INTERNAL_ERROR'
    );

    return res.status(503).json({
      ok: false,
      code: error?.code || 'CASHFREE_WEBHOOK_RETRY',
      error: 'Cashfree webhook could not be durably processed. Retry is required.'
    });
  }
}

module.exports = router;
module.exports.webhookHandler = webhookHandler;
module.exports.PLANS = PLANS;
