'use strict';

async function commitResumableMedia({
  record, ownerDid, ownerUser, mediaFile,
  pushMediaToCloudDwn, markCloudSync,
  assertCloudSyncSucceeded, persistCommitState
}) {
  let uploadedMedia;
  try {
    uploadedMedia = await pushMediaToCloudDwn(record, ownerUser, mediaFile);
  } catch (err) {
    uploadedMedia = {
      backend: 'supabase',
      pushed: false,
      error: String(err?.message || err || 'Media sync failed')
    };
  }

  if (!uploadedMedia || uploadedMedia.pushed !== true) {
    const message = String(
      uploadedMedia?.error ||
      uploadedMedia?.skipped ||
      'Supabase media upload was not confirmed.'
    );
    record.cloudDwn = record.cloudDwn || {};
    record.cloudDwn.mediaSync = {
      ...(uploadedMedia || {}),
      backend: 'supabase',
      mode: 'synchronous-resumable',
      pending: false,
      pushed: false,
      failedAt: new Date().toISOString(),
      error: message.slice(0, 500)
    };
    persistCommitState();

    const error = new Error(message);
    error.status = 502;
    throw error;
  }

  const mediaSync = {
    ...uploadedMedia,
    mode: 'synchronous-resumable',
    pending: false,
    pushed: true
  };

  try {
    await markCloudSync(record, ownerDid);
    assertCloudSyncSucceeded(record);
  } catch (err) {
    record.cloudDwn = record.cloudDwn || {};
    record.cloudDwn.mediaSync = mediaSync;
    persistCommitState();
    throw err;
  }

  record.cloudDwn = record.cloudDwn || {};
  record.cloudDwn.mediaSync = mediaSync;
  persistCommitState();
  return mediaSync;
}

module.exports = { commitResumableMedia };
