'use strict';

const DEFAULT_MEDIA_LIMIT_BYTES = 768 * 1024 * 1024;
const configuredLimit =
  process.env.MILAN_MAX_VOROA_MEDIA_BYTES || process.env.MAX_MEDIA_BYTES;

let MAX_MEDIA_BYTES = DEFAULT_MEDIA_LIMIT_BYTES;
if (configuredLimit !== undefined) {
  const parsedLimit = Number(configuredLimit);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit <= 0) {
    throw new Error(
      'MILAN_MAX_VOROA_MEDIA_BYTES/MAX_MEDIA_BYTES must be a positive safe integer byte count'
    );
  }
  MAX_MEDIA_BYTES = parsedLimit;
}

const MAX_MEDIA_MB = Math.round(MAX_MEDIA_BYTES / (1024 * 1024));
module.exports = { DEFAULT_MEDIA_LIMIT_BYTES, MAX_MEDIA_BYTES, MAX_MEDIA_MB };
