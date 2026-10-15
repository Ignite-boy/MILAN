'use strict';

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createApiRateLimiter(options = {}) {
  const limit = positiveInteger(options.limit, 300);
  const windowMs = positiveInteger(options.windowMs, 60_000);
  const maxBuckets = positiveInteger(options.maxBuckets, 20_000);
  const sweepEvery = positiveInteger(options.sweepEvery, 256);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const buckets = new Map();
  let requestCount = 0;

  function sweepExpired(nowMs) {
    for (const [ip, bucket] of buckets) {
      if (nowMs >= bucket.resetAt) buckets.delete(ip);
    }
  }

  return function apiRateLimiter(req, res, next) {
    const timestamp = now();
    const ip = req.ip || req.socket?.remoteAddress || 'local';
    requestCount += 1;

    let bucket = buckets.get(ip);
    const needsNewBucket = !bucket || timestamp >= bucket.resetAt;
    if (requestCount % sweepEvery === 0 ||
        (needsNewBucket && !bucket && buckets.size >= maxBuckets)) {
      sweepExpired(timestamp);
      bucket = buckets.get(ip);
    }

    if (!bucket || timestamp >= bucket.resetAt) {
      if (!bucket && buckets.size >= maxBuckets) {
        res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
        return res.status(503).json({
          error: 'API temporarily unavailable due to high request volume. Please retry shortly.'
        });
      }
      bucket = { count: 0, resetAt: timestamp + windowMs };
      buckets.set(ip, bucket);
    }

    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    if (bucket.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000))));
      return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }
    return next();
  };
}

module.exports = createApiRateLimiter;
