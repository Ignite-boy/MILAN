'use strict';

const crypto = require('node:crypto');

// Cashfree's x-idempotency-key header contract requires a UUID. Derive a stable
// RFC-4122 version-5 UUID from the unique MILAN order ID, so retries for the
// same order reuse one valid provider key without adding a database field.
function cashfreeIdempotencyKey(orderId) {
  const normalizedOrderId = String(orderId || '').trim();
  if (!normalizedOrderId) throw new TypeError('MILAN order ID is required.');

  const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
  const digest = crypto.createHash('sha1')
    .update(Buffer.concat([namespace, Buffer.from(normalizedOrderId, 'utf8')]))
    .digest();

  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;

  const hex = digest.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}

module.exports = cashfreeIdempotencyKey;
