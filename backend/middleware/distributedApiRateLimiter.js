'use strict';

const crypto = require('crypto');
const createApiRateLimiter = require('./apiRateLimiter');

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createDistributedApiRateLimiter(options = {}) {
  const limit = positiveInteger(options.limit, 60);
  const windowMs = positiveInteger(options.windowMs, 60_000);
  const scope = String(options.scope || '').trim();
  const rpcTimeoutMs = positiveInteger(options.rpcTimeoutMs, 2000);

  if (!scope || windowMs % 1000 !== 0 ||
      windowMs > 86_400_000 || limit > 1000) {
    throw new TypeError('Invalid distributed rate-limiter configuration.');
  }

  const localFallback = createApiRateLimiter({
    limit,
    windowMs,
    maxBuckets: 10_000
  });

  function unavailable(res) {
    res.setHeader('Retry-After', '5');
    return res.status(503).json({
      error: 'Request protection is temporarily unavailable. Please retry shortly.'
    });
  }

  function resolveDatabase() {
    if (Object.prototype.hasOwnProperty.call(options, 'db')) {
      return options.db;
    }
    try {
      return require('../services/milanDb');
    } catch (_) {
      return null;
    }
  }

  return function distributedApiRateLimiter(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');

    if (process.env.MILAN_PAY_SHARED_RATE_LIMIT_ENABLED !== 'true') {
      return localFallback(req, res, next);
    }

    const secret = String(process.env.MILAN_PAY_RATE_LIMIT_HMAC_SECRET || '');
    const ip = String(req.ip || '').trim();
    const database = resolveDatabase();

    if (secret.length < 32 || !ip ||
        !database || typeof database.query !== 'function') {
      return unavailable(res);
    }

    // Only the keyed digest is persisted; never send the raw client IP to PostgreSQL.
    const keyHash = crypto.createHmac('sha256', secret)
      .update(scope)
      .update('\0')
      .update(ip)
      .digest('hex');

    let timeoutId;
    const timeout = new Promise(resolve => {
      timeoutId = setTimeout(() => resolve({ timedOut: true }), rpcTimeoutMs);
    });

    const operation = Promise.resolve()
      .then(() => database.query(
        'SELECT public.consume_api_rate_limit($1, $2, $3) AS rate_limit_result',
        [keyHash, limit, windowMs / 1000]
      ))
      .then(result => ({
        data: Array.isArray(result?.rows) && result.rows.length
          ? result.rows[0].rate_limit_result
          : undefined,
        error: null
      }));

    Promise.race([operation, timeout])
      .then(result => {
        clearTimeout(timeoutId);

        if (result?.timedOut || result?.error) {
          return unavailable(res);
        }

        const data = result?.data;
        if (!data || typeof data.allowed !== 'boolean' ||
            !Number.isInteger(data.limit) ||
            !Number.isInteger(data.remaining) ||
            !Number.isInteger(data.retryAfterSeconds) ||
            data.limit !== limit ||
            data.remaining < 0 || data.remaining > limit ||
            data.retryAfterSeconds < 1) {
          return unavailable(res);
        }

        res.setHeader('X-RateLimit-Limit', String(data.limit));
        res.setHeader('X-RateLimit-Remaining', String(data.remaining));

        if (!data.allowed) {
          res.setHeader('Retry-After', String(data.retryAfterSeconds));
          return res.status(429).json({
            error: 'Too many requests. Please try again shortly.'
          });
        }

        return next();
      })
      .catch(() => {
        clearTimeout(timeoutId);
        return unavailable(res);
      });
  };
}

module.exports = createDistributedApiRateLimiter;
