'use strict';

function assertCloudSyncSucceeded(record) {
  const syncResult = record?.cloudDwn?.sync;
  if (syncResult?.pushed === true) return record;

  const message = String(
    syncResult?.error ||
    syncResult?.skipped ||
    'Supabase DWN record sync was not confirmed'
  );
  const error = new Error(message);
  const status = Number(syncResult?.status);
  error.status = Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : 502;
  if (typeof syncResult?.code === 'string' && syncResult.code) {
    error.code = syncResult.code;
  }
  throw error;
}

module.exports = { assertCloudSyncSucceeded };
