'use strict';

const COUNTED_COMPONENTS = ['record', 'record_data'];

function quotaError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/**
 * Serializes quota-sensitive permanent writes for one account.
 * The callback must perform its permanent write using the supplied client.
 *
 * Temporary upload sessions/chunks (component_type='event') are deliberately
 * excluded from permanent usage. Every permanent writer must use this guard
 * for the account-row lock to serialize concurrent writes consistently.
 */
async function withStorageQuotaTransaction(pool, options, write) {
  const ownerDid = String(options?.did || '').trim();
  const ownerSpaceId = String(options?.spaceId || '').trim();
  const writes = Array.isArray(options?.writes)
    ? options.writes
    : [options || {}];

  const entries = writes.map(entry => ({
    componentType: String(entry?.componentType || ''),
    itemKey: String(entry?.itemKey || ''),
    newBytes: Number(entry?.newBytes)
  }));

  const invalidEntries = !entries.length ||
    entries.some(entry =>
      !COUNTED_COMPONENTS.includes(entry.componentType) ||
      !entry.itemKey ||
      !Number.isSafeInteger(entry.newBytes) ||
      entry.newBytes < 0
    );
  const rowKeys = entries.map(entry => `${entry.componentType}\u0000${entry.itemKey}`);
  const totalNewBytes = entries.reduce((sum, entry) => sum + entry.newBytes, 0);

  if (!ownerDid || !ownerSpaceId || invalidEntries ||
      new Set(rowKeys).size !== rowKeys.length ||
      !Number.isSafeInteger(totalNewBytes) ||
      typeof write !== 'function') {
    throw quotaError(
      'Invalid storage quota transaction arguments.',
      500,
      'STORAGE_QUOTA_INVALID_ARGUMENTS'
    );
  }

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // Every permanent writer locks the same account row before usage checks.
    const accountResult = await client.query(
      `SELECT user_id, space_id, dwn_quota_bytes
         FROM public.users
        WHERE did = $1
        FOR UPDATE`,
      [ownerDid]
    );

    if (accountResult.rowCount !== 1 ||
        String(accountResult.rows[0].space_id || '') !== ownerSpaceId) {
      throw quotaError(
        'The authoritative account storage quota could not be verified.',
        503,
        'STORAGE_QUOTA_UNAVAILABLE'
      );
    }

    const quotaBytes = Number(accountResult.rows[0].dwn_quota_bytes);
    if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1) {
      throw quotaError(
        'The authoritative account storage quota is invalid.',
        503,
        'STORAGE_QUOTA_UNAVAILABLE'
      );
    }

    const usageResult = await client.query(
      `SELECT COALESCE(SUM(data_size), 0)::numeric AS used_bytes
         FROM public.dwn_storage
        WHERE did = $1
          AND space_id = $2
          AND component_type IN ('record', 'record_data')
          AND COALESCE(deleted, FALSE) = FALSE`,
      [ownerDid, ownerSpaceId]
    );

    const usedBytes = Number(usageResult.rows[0]?.used_bytes ?? 0);
    if (!Number.isSafeInteger(usedBytes) || usedBytes < 0) {
      throw quotaError(
        'Storage usage could not be calculated safely.',
        503,
        'STORAGE_USAGE_UNAVAILABLE'
      );
    }

    // A combined write may replace both the record row and the media row.
    let replacedBytes = 0;
    for (const entry of entries) {
      const existingResult = await client.query(
        `SELECT COALESCE(data_size, 0)::numeric AS data_size
           FROM public.dwn_storage
          WHERE did = $1
            AND space_id = $2
            AND component_type = $3
            AND item_key = $4
            AND COALESCE(deleted, FALSE) = FALSE
          LIMIT 1`,
        [ownerDid, ownerSpaceId, entry.componentType, entry.itemKey]
      );
      const currentBytes = Number(existingResult.rows[0]?.data_size ?? 0);
      replacedBytes += currentBytes;
      if (!Number.isSafeInteger(currentBytes) || currentBytes < 0 ||
          !Number.isSafeInteger(replacedBytes)) {
        throw quotaError(
          'Storage usage could not be calculated safely.',
          503,
          'STORAGE_USAGE_UNAVAILABLE'
        );
      }
    }

    if (replacedBytes > usedBytes) {
      throw quotaError(
        'Storage usage could not be calculated safely.',
        503,
        'STORAGE_USAGE_UNAVAILABLE'
      );
    }

    const projectedBytes = usedBytes - replacedBytes + totalNewBytes;
    if (!Number.isSafeInteger(projectedBytes) || projectedBytes > quotaBytes) {
      throw quotaError(
        'Storage quota exceeded. Delete existing data or upgrade your plan.',
        413,
        'STORAGE_QUOTA_EXCEEDED'
      );
    }

    const result = await write(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  withStorageQuotaTransaction
};
