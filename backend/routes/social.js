const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const dwnStore = require('../services/dwnService');
const { readJson, writeJson, findUserById, findUserByDid, addActivity } = require('../utils/store');
const notify = require('../services/notifyService');
const { createClient } = require('@supabase/supabase-js');
const supabaseDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const router = express.Router();
const uuidv4 = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function users(){ return readJson(global.usersFile, {}); }
function current(req){ return findUserById(users(), req.userId); }
function connections(){ return readJson(global.connectionsFile, {}); }
function reactionFile(){ return global.socialReactionsFile; }
function commentFile(){ return global.socialCommentsFile; }
function notifyFile(){ return global.notificationsFile; }
function readReactions(){ return readJson(reactionFile(), {}); }
function saveReactions(data){ writeJson(reactionFile(), data); }
function readComments(){ return readJson(commentFile(), {}); }
function saveComments(data){ writeJson(commentFile(), data); }
function readNotifications(){ return readJson(notifyFile(), {}); }
function saveNotifications(data){ writeJson(notifyFile(), data); }
function saveFile(){ return global.socialSavesFile; }
function readSaves(){ return readJson(saveFile(), {}); }
function writeSaves(data){ writeJson(saveFile(), data); }
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
function connectionStatus(myDid, otherDid){
  if (myDid === otherDid) return 'self';
  const row = connectionRow(myDid, otherDid);
  if (!row) return 'none';
  if (row.status === 'approved') return 'friends';
  if (row.status === 'pending') return row.fromDid === myDid ? 'sent' : 'received';
  return row.status || 'none';
}
function isFriend(myDid, otherDid){ return connectionStatus(myDid, otherDid) === 'friends'; }
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
function reactionSummary(recordId, myDid){
  const all = readReactions();
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
function decorateRecord(record, myDid){
  const owner = findUserByDid(users(), record.owner)?.user;
  const ownerProfile = owner ? profileFor(owner) : { did: record.owner, name: record.owner?.slice(0,18) || 'Unknown', avatar: '' };
  const data = record.data || {};
  let text = typeof data === 'string' ? data : (data.caption || data.text || data.note || (data.kind === 'media' ? data.caption : ''));
  if (!text && typeof data === 'object' && data.kind !== 'media') text = JSON.stringify(data, null, 2);
  return {
    ...record,
    ownerProfile,
    social: {
      friendStatus: connectionStatus(myDid, record.owner),
      reactions: reactionSummary(record.id, myDid),
      commentsCount: commentsFor(record.id).length,
      canMessage: record.owner !== myDid && isFriend(myDid, record.owner),
      textPreview: String(text || '').slice(0, 1000)
    }
  };
}
function allowedForFeed(record, myDid, scope){
  if (scope === 'mine') return record.owner === myDid;
  if (scope === 'friends') return record.owner === myDid || isFriend(myDid, record.owner) || record.sharedWithDids?.includes(myDid);
  if (scope === 'public') return record.accessMode === 'public';
  return true;
}

router.get('/summary', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  const allUsers = Object.values(users());
  const records = await dwnStore.listVisibleRecords(me.user.did, {});
  const rows = Object.values(connections()).filter(c => c.fromDid === me.user.did || c.toDid === me.user.did);
  const notifs = readNotifications()[req.userId] || [];
  res.json({
    ok: true,
    user: profileFor(me.user),
    counts: {
      people: Math.max(0, allUsers.length - 1),
      friends: rows.filter(c => c.status === 'approved').length,
      requests: rows.filter(c => c.status === 'pending' && c.toDid === me.user.did).length,
      visiblePosts: records.length,
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

  const { data: accounts, error } = await supabaseDb
    .from('users')
    .select('id,email,name,did,space_id,portable_did,dwn_quota_bytes')
    .order('name', { ascending: true });

  if (error) {
    console.error('[social/people] Supabase users lookup failed:', error);
    return res.status(500).json({ error: 'People directory unavailable', details: error.message });
  }

  const localUsers = users();

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
      return {
        ...profileFor(merged),
        name: merged.profile?.display_name || account.name || account.email?.split('@')[0] || 'MILAN User',
        connectionStatus: status,
        connectionId: row?.id || '',
        connectionDirection: !row ? 'none' : (row.fromDid === me.user.did ? 'outgoing' : 'incoming'),
        connectionUpdatedAt: row?.updatedAt || ''
      };
    })
    .filter(p => !q || JSON.stringify(p).toLowerCase().includes(q))
    .sort((a,b) => (a.connectionStatus === 'friends' ? -1 : 0) - (b.connectionStatus === 'friends' ? -1 : 0) || a.name.localeCompare(b.name));

  res.json(rows);
});

router.get('/feed', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  const scope = String(req.query.scope || 'all');
  const rows = await dwnStore.listVisibleRecords(me.user.did, req.query);
  const feed = rows.filter(r => allowedForFeed(r, me.user.did, scope)).map(r => decorateRecord(r, me.user.did));
  res.json(feed);
});

router.get('/records/:id/comments', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  await dwnStore.getRecord(req.params.id, me.user.did);
  const rows = commentsFor(req.params.id).map(c => ({ ...c, authorProfile: profileFor(findUserByDid(users(), c.authorDid)?.user || { did:c.authorDid, email:'', profile:{} }) }));
  res.json(rows);
});

router.post('/records/:id/comments', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  const record = await dwnStore.getRecord(req.params.id, me.user.did);
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error:'Comment required' });
  const all = readComments();
  if (!Array.isArray(all[req.params.id])) all[req.params.id] = [];
  const c = { id: uuidv4(), recordId:req.params.id, authorDid:me.user.did, text:text.slice(0, 2000), createdAt:now(), updatedAt:now() };
  all[req.params.id].push(c); saveComments(all);
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
  const type = String(req.body.type || 'like').toLowerCase().replace(/[^a-z]/g,'').slice(0,20) || 'like';
  const all = readReactions();
  if (!all[req.params.id]) all[req.params.id] = {};
  const existingReaction = all[req.params.id][me.user.did]?.type;
  if (existingReaction === type) delete all[req.params.id][me.user.did];
  else all[req.params.id][me.user.did] = { type, at:now() };
  saveReactions(all);
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
  res.json(rows.filter(r => ids.includes(r.id)).map(r => decorateRecord(r, me.user.did)));
});

router.post('/records/:id/save', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  await dwnStore.getRecord(req.params.id, me.user.did);
  const saves = readSaves();
  if (!Array.isArray(saves[req.userId])) saves[req.userId] = [];
  const exists = saves[req.userId].includes(req.params.id);
  saves[req.userId] = exists ? saves[req.userId].filter(id => id !== req.params.id) : [req.params.id, ...saves[req.userId]];
  writeSaves(saves);
  addActivity(req.userId, exists ? 'social.post.unsaved' : 'social.post.saved', { recordId: req.params.id });
  res.json({ saved: !exists, count: saves[req.userId].length });
});

router.get('/advanced/insights', auth, async (req, res) => {
  const me = current(req); if (!me) return res.status(404).json({ error:'User not found' });
  const records = await dwnStore.listVisibleRecords(me.user.did, {});
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
