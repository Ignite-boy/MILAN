    dwnDirectory: DWN_DIR,
    databaseDirectory: DATABASE_DIR,
    indexFile: INDEX_FILE,
    recordsDirectory: RECORDS_DIR,
    auditDirectory: AUDIT_DIR,
    mediaDirectory: MEDIA_DIR,
    isolatedUsersDirectory: ISOLATED_USERS_DIR,
    hasDwnInstance: !!dwnInstance,
    limits: {
      maxMediaBytes: MAX_MEDIA_BYTES,
      maxMediaMB: MAX_MEDIA_MB,
      maxTextBytes: MAX_TEXT_BYTES
    },
    cloud: persistenceInfo(),
    note: 'MILAN Supabase mode. Supabase is authoritative for user snapshots, records, and media; local files are compatibility/cache storage.'
  };
}

async function createRecord(userId, ownerDid, body = {}) {
  const awaitCloudSync = body.awaitCloudSync === true;
  validatePayload(body);
  const data = body.data;
  if (data === undefined || data === null || String(typeof data === 'object' ? JSON.stringify(data) : data).trim() === '') {
    const err = new Error('Record content required');
    err.status = 400;
    throw err;
  }
  const access = normalizeAccess(body);
  if (access.error) {
    const err = new Error(access.error);
    err.status = 400;
    throw err;
  }
  const { all, list } = ownerRecordsRaw(userId);
  const now = new Date().toISOString();
  const requestedId = String(body.recordId || '').trim().slice(0, 180);
  const id = requestedId || uuidv4();
  const existingForRequestedId = requestedId
    ? list.find(item => String(item?.id || '') === requestedId)
    : null;

  if (existingForRequestedId) {
    existingForRequestedId.dateModified = existingForRequestedId.dateModified || now;
    if (awaitCloudSync) {
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await markCloudSync(existingForRequestedId, ownerDid);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 250));
        }
      }
      if (lastError) throw lastError;
    }
    return toClient(existingForRequestedId, ownerDid);
  }

  const record = {
    id,
    dwnRecordId: uuidv4(),
    owner: ownerDid,
    recipient: ownerDid,
    schema: body.schema || 'web5-vault-record',
    title: String(body.title || 'Untitled record').trim().slice(0, 140),
    dataFormat: body.dataFormat || 'text/plain',
    protocol: String(body.protocol || '').trim(),
    protocolPath: String(body.protocolPath || '').trim(),
    data,
    tags: sanitizeTags(body.tags),
    favorite: !!body.favorite,
    dateCreated: now,
    dateModified: now,
    storageEngine: 'Supabase-authoritative storage',
    dwnSdkReady: dwnInitStatus.sdkReady,
    storagePath: path.relative(path.join(__dirname, '..'), recordFile(userId, id)).replace(/\\/g, '/')
  };
  applyAccess(record, access.mode, access.dids);

  /* ---------------------------------------------------------
     Publish must not be blocked by cloud sync latency.
     Persist the record first, then sync to the authoritative
     cloud/DWN store asynchronously.
     --------------------------------------------------------- */

  record.cloudDwn = record.cloudDwn || {};
  record.cloudDwn.sync = {
    ok: false,
    status: 'pending',
    queuedAt: new Date().toISOString()
  };

  list.unshift(record);
  persistRecord(userId, record);
  all[userId] = list;
  writeIndex(all);

  // Chat messages can request synchronous cloud visibility so the recipient
  // can read the message immediately from another Vercel instance.
  if (awaitCloudSync) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await markCloudSync(record, ownerDid);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        console.error(
          `Synchronous cloud sync failed for record ${record.id} (attempt ${attempt}/3):`,
          err.message
        );
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 250));
      }
    }
    if (lastError) throw lastError;
  } else {
    // Return the persisted record immediately; Supabase cloud sync continues in background.
    runBackground(() => markCloudSync(record, ownerDid)
      .then(() => {
      record.cloudDwn = record.cloudDwn || {};
      record.cloudDwn.sync = {
        ok: true,
        status: 'synced',
        syncedAt: new Date().toISOString()
      };

      try {