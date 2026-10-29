const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const dwnStore = require('../services/dwnService');
const { readJson, writeJson, writeJsonAndSync, atomicWriteJson, findUserById, findUserByDid, addActivity } = require('../utils/store');
const { sendSnapshotSyncFailure } = require('../services/persistenceFailure');
const { pullDatabaseSnapshot } = require('../services/cloudDwnRegistry');
const notify = require('../services/notifyService');
const milanDb = require('../services/milanDb');
const router = express.Router();
const uuidv4 = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function users(){ return readJson(global.usersFile, {}); }
function current(req){ return findUserById(users(), req.userId); }
function connections(){ return readJson(global.connectionsFile, {}); }

async function refreshConnectionsFromCloud(){
  const local = connections();
  try{
    const pulled = await pullDatabaseSnapshot('connections.json');
    if(
      pulled?.ok &&
      !pulled?.missing &&
      pulled?.data &&
      typeof pulled.data === 'object' &&
      !Array.isArray(pulled.data)
    ){
      const remote = pulled.data;
      if(Object.keys(remote).length === 0 && Object.keys(local).length > 0){
        return local;
      }
      // Cloud pulls update the local cache only. writeJson() would sync the pulled snapshot back to the authoritative store and could overwrite a newer cross-device request during a race.
      atomicWriteJson(global.connectionsFile, remote);
      return remote;
    }
  }catch(_){}
  return local;
}

function reactionFile(){ return global.socialReactionsFile; }
function commentFile(){ return global.socialCommentsFile; }
function notifyFile(){ return global.notificationsFile; }
function readReactions(){ return readJson(reactionFile(), {}); }
function saveReactions(data){ return writeJsonAndSync(reactionFile(), data); }
function readComments(){ return readJson(commentFile(), {}); }
function saveComments(data){ return writeJsonAndSync(commentFile(), data); }
function readNotifications(){ return readJson(notifyFile(), {}); }
function saveNotifications(data){ writeJson(notifyFile(), data); }
function saveFile(){ return global.socialSavesFile; }
function readSaves(){ return readJson(saveFile(), {}); }
function writeSaves(data){ return writeJsonAndSync(saveFile(), data); }
function profileFor(user){
  const p = user.profile || {};
  return {
    id: user.id,
    email: user.email,
    did: user.did,
    name: p.display_name || user.email?.split('@')[0] || 'MILAN User',
    bio: p.bio || '',
    website: p.website || '',
    avatar: p.avatar || '',
    dwn: user.dwn || { endpoint: user.dwnEndpoint || '', spaceId: user.settings?.dwnSpaceId || '' },
    createdAt: user.created_at || null
  };
}
function connectionRow(myDid, otherDid){
  if (myDid === otherDid) return null;
  return Object.values(connections()).find(c => (c.fromDid === myDid && c.toDid === otherDid) || (c.fromDid === otherDid && c.toDid === myDid)) || null;
}
function connectionStatus(myDid, otherDid, context = null){
  if (myDid === otherDid) return 'self';
  if (context?.connectionStatusByDid instanceof Map) {
    return context.connectionStatusByDid.get(otherDid) || 'none';
  }
  const row = connectionRow(myDid, otherDid);
  if (!row) return 'none';
  if (row.status === 'approved') return 'friends';
  if (row.status === 'pending') return row.fromDid === myDid ? 'sent' : 'received';
  return row.status || 'none';
}
function isFriend(myDid, otherDid, context = null){
  return connectionStatus(myDid, otherDid, context) === 'friends';
}

// Capture social data once per request and reuse indexed lookups for every post.
function createConnectionStatusByDid(myDid){
  const connectionStatusByDid = new Map();
  for (const row of Object.values(connections() || {})) {
    let otherDid = null;
    if (row?.fromDid === myDid) otherDid = row.toDid;
    else if (row?.toDid === myDid) otherDid = row.fromDid;
    if (!otherDid || connectionStatusByDid.has(otherDid)) continue;

    const status = row.status === 'approved'
      ? 'friends'
      : row.status === 'pending'
        ? (row.fromDid === myDid ? 'sent' : 'received')
        : (row.status || 'none');
    connectionStatusByDid.set(otherDid, status);
  }
  return connectionStatusByDid;
}

function createDecorationContext(myDid, sharedConnectionStatusByDid = null){
  const usersByDid = new Map();
  for (const user of Object.values(users() || {})) {
    if (user?.did && !usersByDid.has(user.did)) usersByDid.set(user.did, user);
  }

  return {
    usersByDid,
    connectionStatusByDid: sharedConnectionStatusByDid || createConnectionStatusByDid(myDid),
    reactions: readReactions(),
    comments: readComments()
  };
}
function notifyByDid(targetDid, type, actorDid, details={}){
  const target = findUserByDid(users(), targetDid);
  if (!target?.user?.id) return;
  const all = readNotifications();
  if (!Array.isArray(all[target.user.id])) all[target.user.id] = [];
  all[target.user.id].unshift({ id: uuidv4(), type, actorDid, details, read: false, createdAt: now() });
  all[target.user.id] = all[target.user.id].slice(0, 200);
  saveNotifications(all);
  // Instant push to any live SSE/WebSocket connection of the recipient.
  try { require('../services/livePush').push(target.user.id, 'notify', { notifType: type }); } catch (_) {}
}
function reactionSummary(recordId, myDid, snapshot = null){
  const all = snapshot || readReactions();
  const rows = all[recordId] || {};
  const counts = {};
  let mine = null;
  for (const [did, item] of Object.entries(rows)) {
    const type = item?.type || 'like';
    counts[type] = (counts[type] || 0) + 1;
    if (did === myDid) mine = type;
  }
  return { total: Object.values(counts).reduce((a,b)=>a+b,0), counts, mine };
}
function commentsFor(recordId){
  const all = readComments();
  return (all[recordId] || []).filter(c => !c.deleted).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
}
function commentsCount(recordId, snapshot = null){
  if (!snapshot) return commentsFor(recordId).length;
  const rows = snapshot[recordId] || [];
  let count = 0;
  for (const comment of rows) if (!comment.deleted) count++;
  return count;
}
function decorateRecord(record, myDid, context = null){
  const owner = context
    ? context.usersByDid.get(record.owner)
    : findUserByDid(users(), record.owner)?.user;
  const ownerProfile = owner ? profileFor(owner) : { did: record.owner, name: record.owner?.slice(0,18) || 'Unknown', avatar: '' };
  const data = record.data || {};
  let text = typeof data === 'string' ? data : (data.caption || data.text || data.note || (data.kind === 'media' ? data.caption : ''));
  if (!text && typeof data === 'object' && data.kind !== 'media') text = JSON.stringify(data, null, 2);
  const friendStatus = connectionStatus(myDid, record.owner, context);
  return {
    ...record,
    ownerProfile,
    social: {
      friendStatus,
      reactions: reactionSummary(record.id, myDid, context?.reactions),
      commentsCount: commentsCount(record.id, context?.comments),
      canMessage: record.owner !== myDid && friendStatus === 'friends',
      textPreview: String(text || '').slice(0, 1000)
    }
  };
}
function isChatRecord(record){
  const data = record?.data && typeof record.data === 'object' ? record.data : {};
  const protocol = String(record?.protocol || '').trim().toLowerCase();
  const protocolPath = String(record?.protocolPath || '').trim().toLowerCase();
  const schema = String(record?.schema || '').trim().toLowerCase();
  const title = String(record?.title || '').trim().toLowerCase();

  return (
    protocol === 'milan.chat' ||
    protocolPath === 'messages' ||
    schema === 'milan.chat.message' ||
    title === 'milan chat message' ||
    String(data.kind || '').trim().toLowerCase() === 'chat_message' ||
    Boolean(
      data.messageId &&
      data.conversationId &&
      data.senderDid &&
      data.recipientDid
    )
  );
}

function allowedForFeed(record, myDid, scope, connectionStatusByDid = null){
  // Private Messenger traffic belongs exclusively to /api/chat. Never expose
  // chat records through any social-feed scope, even when they are shared with
  // the current DID at the DWN layer.
  if (isChatRecord(record)) return false;
  if (scope === 'mine') return record.owner === myDid;
  if (scope === 'friends') {
    const isFriendOfViewer = connectionStatusByDid instanceof Map
      ? connectionStatusByDid.get(record.owner) === 'friends'
      : isFriend(myDid, record.owner);
    return record.owner === myDid || isFriendOfViewer || record.sharedWithDids?.includes(myDid);
  }
  if (scope === 'public') return record.accessMode === 'public';
  return true;
}

router.get('/summary', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  const allUsers = Object.values(users());
  const records = await dwnStore.listVisibleRecords(me.user.did, {});
  const connectionSnapshot = await refreshConnectionsFromCloud();
  const rows = Object.values(connectionSnapshot).filter(c => c.fromDid === me.user.did || c.toDid === me.user.did);
  const notifs = readNotifications()[req.userId] || [];
  res.json({
    ok: true,
    user: profileFor(me.user),
    counts: {
      people: Math.max(0, allUsers.length - 1),
      friends: rows.filter(c => c.status === 'approved').length,
      requests: rows.filter(c => c.status === 'pending' && c.toDid === me.user.did).length,
      visiblePosts: records.filter(r => !isChatRecord(r)).length,
      unreadNotifications: notifs.filter(n => !n.read).length,
      savedPosts: (readSaves()[req.userId] || []).length
    },
    mode: 'milan-social-layer-on-isolated-dwn',
    promise: 'Every user keeps an isolated DWN-backed space; social feed only shows data permitted by owner rules.'
  });
});

router.get('/people', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  const q = String(req.query.q || '').toLowerCase();

  let accounts;
  try {
    const result = await milanDb.query(
      `SELECT user_id AS id, email, name, did, space_id,
              portable_did, 1073741824::bigint AS dwn_quota_bytes
       FROM public.users
       ORDER BY name ASC`
    );
    accounts = result.rows;
  } catch (error) {
    console.error('[social/people] PostgreSQL users lookup failed:', error.message);
    return res.status(500).json({ error: 'People directory unavailable' });
  }

  const localUsers = users();
  await refreshConnectionsFromCloud();

  const rows = (accounts || [])
    .filter(u => u.id !== req.userId)
    .map(account => {
      const local = localUsers[account.email] || {};
      const merged = {
        ...local,
        ...account,
        profile: local.profile || {}
      };
      const row = connectionRow(me.user.did, account.did);
      const status = connectionStatus(me.user.did, account.did);
      const person = {
        ...profileFor(merged),
        name: merged.profile?.display_name || account.name || account.email?.split('@')[0] || 'MILAN User',
        connectionStatus: status,
        connectionId: row?.id || '',
        connectionDirection: !row ? 'none' : (row.fromDid === me.user.did ? 'outgoing' : 'incoming'),
        connectionUpdatedAt: row?.updatedAt || ''
      };

      // This directory is readable by every signed-in user. A display name and
      // a DID are meant to be shared; an email address is not. It is still read
      // above to key the local-user merge, but it must not leave the server.
      delete person.email;

      return person;
    })
    .filter(p => !q || JSON.stringify(p).toLowerCase().includes(q))
    .sort((a,b) => (a.connectionStatus === 'friends' ? -1 : 0) - (b.connectionStatus === 'friends' ? -1 : 0) || a.name.localeCompare(b.name));

  res.json(rows);
});

router.get('/feed', auth, async (req, res) => {
  const me = current(req);
  if (!me) return res.status(404).json({ error: 'User not found' });

  const scope = String(req.query.scope || 'all');
  await refreshConnectionsFromCloud();

  const requestedLimit = Math.max(1, Math.min(100, Number(req.query.limit || 10) || 10));
  const rawOffset = Number(req.query.offset);
  const requestedOffset = Number.isSafeInteger(rawOffset) && rawOffset > 0
    ? Math.min(rawOffset, 1000000) : 0;
  const hasFilters = ['q', 'access', 'type', 'tag']
    .some(key => String(req.query[key] || '').trim() !== '');
  const useDatabasePage = scope === 'all' && !hasFilters;

  if (useDatabasePage) {
    // Offset represents raw database rows. Advance past filtered records without
    // returning them, and point the next page at the next eligible record.
    const pageRows = [];
    const batchSize = requestedLimit + 1;
    let scanOffset = requestedOffset;
    let nextOffset = requestedOffset;
    let hasMore = false;
    let exhausted = false;
    let scanBatches = 0;

    while (scanBatches < 100) {
      const rows = await dwnStore.listVisibleRecords(me.user.did, {
        ...req.query,
        limit: String(batchSize),
        offset: String(scanOffset),
        dbPage: '1'
      });
      scanBatches += 1;

      if (!Array.isArray(rows) || rows.length === 0) {
        exhausted = true;
        nextOffset = scanOffset;
        break;
      }

      let consumed = 0;
      for (const row of rows) {
        consumed += 1;
        if (!allowedForFeed(row, me.user.did, scope)) continue;

        if (pageRows.length < requestedLimit) {
          pageRows.push(row);
        } else {
          // Leave this extra eligible row for the next request.
          hasMore = true;
          nextOffset = scanOffset + consumed - 1;
          break;
        }
      }

      if (hasMore) break;

      scanOffset += rows.length;
      nextOffset = scanOffset;
      if (rows.length < batchSize) {
        exhausted = true;
        break;
      }
    }

    if (!hasMore && !exhausted && scanBatches >= 100) {
      hasMore = true;
      nextOffset = scanOffset;
    }

    const decorationContext = pageRows.length
      ? createDecorationContext(me.user.did)
      : null;
    return res.json({
      items: pageRows.map(row => decorateRecord(row, me.user.did, decorationContext)),
      hasMore,
      nextOffset
    });
  }

  // Keep the established in-memory behavior for filtered/search feeds.
  const rows = await dwnStore.listVisibleRecords(me.user.did, {
    ...req.query,
    limit: '0'
  });
  const connectionStatusByDid = scope === 'friends'
    ? createConnectionStatusByDid(me.user.did)
    : null;
  const visibleRows = rows.filter(row =>
    allowedForFeed(row, me.user.did, scope, connectionStatusByDid)
  );
  const feedRows = visibleRows.slice(requestedOffset, requestedOffset + requestedLimit);
  const decorationContext = feedRows.length
    ? createDecorationContext(me.user.did, connectionStatusByDid)
    : null;
  res.json(feedRows.map(row => decorateRecord(row, me.user.did, decorationContext)));
});
router.get('/records/:id/comments', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  const record = await dwnStore.getRecord(req.params.id, me.user.did);
  if (isChatRecord(record)) {
    return res.status(400).json({ error: 'Chat messages do not support social comments' });
  }
  const rows = commentsFor(req.params.id).map(c => ({ ...c, authorProfile: profileFor(findUserByDid(users(), c.authorDid)?.user || { did:c.authorDid, email:'', profile:{} }) }));
  res.json(rows);
});

router.post('/records/:id/comments', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  const record = await dwnStore.getRecord(req.params.id, me.user.did);
  if (isChatRecord(record)) {
    return res.status(400).json({ error: 'Chat messages do not support social comments' });
  }
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error:'Comment required' });
  const all = readComments();
  if (!Array.isArray(all[req.params.id])) all[req.params.id] = [];
  const c = { id: uuidv4(), recordId:req.params.id, authorDid:me.user.did, text:text.slice(0, 2000), createdAt:now(), updatedAt:now() };
  all[req.params.id].push(c);
  const persistence = await saveComments(all);
  if (sendSnapshotSyncFailure(res, persistence, 'Comment')) return;
  addActivity(req.userId, 'social.comment.created', { recordId:req.params.id });
  if (record.owner && record.owner !== me.user.did) {
    notifyByDid(record.owner, 'comment', me.user.did, { recordId:req.params.id, title:record.title });
    notify.emailEvent(record.owner, 'comment', { actorName: profileFor(me.user).name, recordTitle: record.title, text });
  }
  res.status(201).json({ ...c, authorProfile: profileFor(me.user) });
});

router.post('/records/:id/reactions', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  const record = await dwnStore.getRecord(req.params.id, me.user.did);
  if (isChatRecord(record)) {
    return res.status(400).json({ error: 'Chat messages do not support social reactions' });
  }
  const type = String(req.body.type || 'like').toLowerCase().replace(/[^a-z]/g,'').slice(0,20) || 'like';
  const all = readReactions();
  if (!all[req.params.id]) all[req.params.id] = {};
  const existingReaction = all[req.params.id][me.user.did]?.type;
  if (existingReaction === type) delete all[req.params.id][me.user.did];
  else all[req.params.id][me.user.did] = { type, at:now() };
  const persistence = await saveReactions(all);
  if (sendSnapshotSyncFailure(res, persistence, 'Reaction')) return;
  addActivity(req.userId, 'social.reaction.updated', { recordId:req.params.id, type });
  if (record.owner && record.owner !== me.user.did && all[req.params.id][me.user.did]) {
    notifyByDid(record.owner, 'reaction', me.user.did, { recordId:req.params.id, title:record.title, type });
    notify.emailEvent(record.owner, 'reaction', { actorName: profileFor(me.user).name, recordTitle: record.title, reaction: type });
  }
  res.json(reactionSummary(req.params.id, me.user.did));
});


router.get('/saved', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  const saves = readSaves();
  const ids = saves[req.userId] || [];
  const rows = await dwnStore.listVisibleRecords(me.user.did, req.query);
  const savedRows = rows.filter(r => !isChatRecord(r) && ids.includes(r.id));
  const decorationContext = savedRows.length
    ? createDecorationContext(me.user.did)
    : null;
  res.json(savedRows.map(r => decorateRecord(r, me.user.did, decorationContext)));
});

router.post('/records/:id/save', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  const record = await dwnStore.getRecord(req.params.id, me.user.did);
  if (isChatRecord(record)) {
    return res.status(400).json({ error: 'Chat messages cannot be saved as social posts' });
  }
  const saves = readSaves();
  if (!Array.isArray(saves[req.userId])) saves[req.userId] = [];
  const exists = saves[req.userId].includes(req.params.id);
  saves[req.userId] = exists ? saves[req.userId].filter(id => id !== req.params.id) : [req.params.id, ...saves[req.userId]];
  const persistence = await writeSaves(saves);
  if (sendSnapshotSyncFailure(res, persistence, 'Saved-post update')) return;
  addActivity(req.userId, exists ? 'social.post.unsaved' : 'social.post.saved', { recordId: req.params.id });
  res.json({ saved: !exists, count: saves[req.userId].length });
});

router.get('/advanced/insights', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  const records = (await dwnStore.listVisibleRecords(me.user.did, {})).filter(r => !isChatRecord(r));
  const mine = records.filter(r => r.owner === me.user.did);
  res.json({
    ok: true,
    privacyScore: mine.some(r => r.accessMode === 'public') ? 90 : 100,
    privatePosts: mine.filter(r => r.accessMode === 'private').length,
    sharedPosts: mine.filter(r => r.accessMode === 'shared_did').length,
    publicPosts: mine.filter(r => r.accessMode === 'public').length,
    recommendation: 'Keep private as default. Share only selected records with selected DIDs.'
  });
});

router.get('/notifications', auth, (req, res) => {
  const rows = readNotifications()[req.userId] || [];
  res.json(rows.slice(0, 100));
});

router.patch('/notifications/:id/read', auth, (req, res) => {
  const all = readNotifications();
  const rows = all[req.userId] || [];
  const n = rows.find(x => x.id === req.params.id);
  if (n) n.read = true;
  saveNotifications(all);
  res.json({ ok:true });
});

module.exports = router;
