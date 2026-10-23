'use strict';

function sendSnapshotSyncFailure(res, result, resource) {
  if (result && result.ok !== false) return false;
  console.warn('[persistence] local snapshot saved but cloud synchronization failed:',
    String(resource || 'snapshot'), String(result && result.error || 'remote-sync-failed'));
  res.status(503).json({
    ok: false,
    code: 'SNAPSHOT_SYNC_FAILED',
    error: `${resource || 'Change'} was saved locally, but cloud synchronization failed. Refresh before retrying.`,
    localSaved: true,
    cloudSynced: false,
    retryAdvice: 'Refresh the current state before retrying to avoid duplicate or toggle actions.'
  });
  return true;
}
module.exports = { sendSnapshotSyncFailure };
