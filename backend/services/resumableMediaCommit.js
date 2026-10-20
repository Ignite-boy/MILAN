'use strict';

async function commitResumableMedia({
  record, ownerDid, ownerUser, mediaFile,
  pushMediaToCloudDwn, markCloudSync,
  assertCloudSyncSucceeded, persistCommitState,
  commitMode = 'synchronous-resumable'
}) {
  let uploadedMedia;
  try {
    uploadedMedia = await pushMediaToCloudDwn(record, ownerUser, mediaFile);
  } catch (err) {
    uploadedMedia = {
      backend: 'voroa',
      pushed: false,
      error: String(err?.message || err || 'Media sync failed')
    };
  }

  if (!uploadedMedia || uploadedMedia.pushed !== true) {
    const message = String(
      uploadedMedia?.error ||
      uploadedMedia?.skipped ||
      'Voroa PostgreSQL media upload was not confirmed.'
    );
    record.cloudDwn = record.cloudDwn || {};
    record.cloudDwn.mediaSync = {
      ...(uploadedMedia || {}),
      backend: 'voroa',
      mode: commitMode,
      pending: false,
      pushed: false,
      failedAt: new Date().toISOString(),
      error: message.slice(0, 500)
    };
    persistCommitState();

    const error = new Error(message);
    const status = Number(uploadedMedia?.status);
    error.status = Number.isInteger(status) && status >= 400 && status <= 599
      ? status
      : 502;
    if (typeof uploadedMedia?.code === 'string' && uploadedMedia.code) {
      error.code = uploadedMedia.code;
    }
    throw error;
  }

  const mediaSync = {
    ...uploadedMedia,
    mode: commitMode,
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
