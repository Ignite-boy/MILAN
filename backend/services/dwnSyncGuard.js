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
  error.status = 502;
  throw error;
}

module.exports = { assertCloudSyncSucceeded };
