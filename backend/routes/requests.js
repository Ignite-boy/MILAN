const express = require('express');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const auth = require('../middleware/auth');
const { readJson, writeJsonAndSync, findUserById, findUserByDid, addActivity } = require('../utils/store');
const { sendSnapshotSyncFailure } = require('../services/persistenceFailure');
const dwnStore = require('../services/dwnService');
const notify = require('../services/notifyService');

const router = express.Router();
function displayNameOf(user){ return user?.profile?.display_name || user?.email?.split('@')[0] || 'A MILAN member'; }

function now(){ return new Date().toISOString(); }
function users(){ return readJson(global.usersFile, {}); }
function requests(){ return readJson(global.requestsFile, {}); }
async function saveRequests(data){ return writeJsonAndSync(global.requestsFile, data); }
function current(req){ return findUserById(users(), req.userId); }
async function findRecordById(id){
  const found = await dwnStore.findRecordById(id);
  if (!found) return null;
  return { all: found.all, userId: found.userId, list: found.list, rec: found.record };
}
function cleanDid(did){ return String(did || '').trim(); }
function publicRequest(r){
  return {
    id: r.id,
    fromDid: r.fromDid,
    toDid: r.toDid,
    message: r.message || '',
    scope: r.scope || 'profile_or_record',
    recordId: r.recordId || '',
    recordTitle: r.recordTitle || '',
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    decisionNote: r.decisionNote || ''
  };
}
function listAll(){ return Object.values(requests()).flatMap(v => Array.isArray(v) ? v : []); }
async function upsertForUsers(reqObj, userIds){
  const all = requests();
  for (const userId of userIds) {
    if (!Array.isArray(all[userId])) all[userId] = [];
    const idx = all[userId].findIndex(x => x.id === reqObj.id);
    if (idx >= 0) all[userId][idx] = reqObj;
    else all[userId].unshift(reqObj);
    all[userId] = all[userId].slice(0, 300);
  }
  return await saveRequests(all);
}
function removeDuplicateView(rows){
  const seen = new Set();
  return rows.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .sort((a,b)=>new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt));
}

router.get('/', auth, (req, res) => {
  const me = current(req);
  if (!me) return res.status(404).json({ error: 'User not found' });
  const did = me.user.did;
  const type = String(req.query.type || 'all');
  let rows = listAll().filter(r => r.fromDid === did || r.toDid === did);
  if (type === 'inbox') rows = rows.filter(r => r.toDid === did);
  if (type === 'sent' || type === 'outbox') rows = rows.filter(r => r.fromDid === did);
  res.json(removeDuplicateView(rows).map(publicRequest));
});

router.post('/', auth, async (req, res) => {
  const me = current(req);
  if (!me) return res.status(404).json({ error: 'User not found' });
  const toDid = cleanDid(req.body.toDid);
  if (!toDid.startsWith('did:')) return res.status(400).json({ error: 'Valid receiver DID required' });
  if (toDid === me.user.did) return res.status(400).json({ error: 'You cannot request access from your own DID' });
  const target = findUserByDid(users(), toDid);
  if (!target) return res.status(404).json({ error: 'Receiver DID not found in this local demo' });
  const recordId = String(req.body.recordId || '').trim();
  let recordTitle = String(req.body.recordTitle || '').trim();
  if (recordId) {
    const f = await findRecordById(recordId);
    if (!f) return res.status(404).json({ error: 'Requested record not found' });
    if (f.rec.owner !== toDid) return res.status(400).json({ error: 'This record is not owned by the receiver DID' });
    recordTitle = f.rec.title || recordTitle || 'Requested record';
  }
  const r = {
    id: uuidv4(),
    fromUserId: req.userId,
    toUserId: target.user.id,
    fromDid: me.user.did,
    toDid,
    message: String(req.body.message || '').trim(),
    scope: recordId ? 'record' : String(req.body.scope || 'profile_or_record'),
    recordId,
    recordTitle,
    status: 'pending',
    createdAt: now(),
    updatedAt: now()
  };
  const persistence = await upsertForUsers(r, [req.userId, target.user.id]);
  if (sendSnapshotSyncFailure(res, persistence, 'Access request')) return;
  addActivity(req.userId, 'access.request.sent', { toDid, recordId });
  addActivity(target.user.id, 'access.request.received', { fromDid: me.user.did, recordId });
  notify.emailEvent(target.user.id, 'access_request', { actorName: displayNameOf(me.user), message: r.message, recordTitle: recordTitle });
  res.status(201).json(publicRequest(r));
});

router.patch('/:id/approve', auth, async (req, res) => {
  const me = current(req);
  if (!me) return res.status(404).json({ error: 'User not found' });
  const existing = listAll().find(r => r.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  if (existing.toDid !== me.user.did) return res.status(403).json({ error: 'Only receiver can approve this request' });
  existing.status = 'approved';
  existing.decisionNote = String(req.body.note || '').trim();
  existing.updatedAt = now();

  if (existing.recordId) {
    await dwnStore.approveAccessForRecord(existing.recordId, me.user.did, existing.fromDid, existing.id);
  }

  const persistence = await upsertForUsers(existing, [existing.fromUserId, existing.toUserId]);
  if (sendSnapshotSyncFailure(res, persistence, 'Access-request approval')) return;
  addActivity(req.userId, 'access.request.approved', { requestId: existing.id, fromDid: existing.fromDid, recordId: existing.recordId });
  addActivity(existing.fromUserId, 'access.request.approved.by.receiver', { requestId: existing.id, toDid: existing.toDid, recordId: existing.recordId });
  notify.emailEvent(existing.fromUserId, 'access_request_approved', { actorName: displayNameOf(me.user) });
  res.json(publicRequest(existing));
});

router.patch('/:id/reject', auth, async (req, res) => {
  const me = current(req);
  if (!me) return res.status(404).json({ error: 'User not found' });
  const existing = listAll().find(r => r.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  if (existing.toDid !== me.user.did) return res.status(403).json({ error: 'Only receiver can reject this request' });
  existing.status = 'rejected';
  existing.decisionNote = String(req.body.note || '').trim();
  existing.updatedAt = now();
  const persistence = await upsertForUsers(existing, [existing.fromUserId, existing.toUserId]);
  if (sendSnapshotSyncFailure(res, persistence, 'Access-request rejection')) return;
  addActivity(req.userId, 'access.request.rejected', { requestId: existing.id, fromDid: existing.fromDid });
  addActivity(existing.fromUserId, 'access.request.rejected.by.receiver', { requestId: existing.id, toDid: existing.toDid });
  res.json(publicRequest(existing));
});

router.delete('/:id', auth, async (req, res) => {
  const me = current(req);
  if (!me) return res.status(404).json({ error: 'User not found' });
  const all = requests();
  for (const [uid, list] of Object.entries(all)) {
    all[uid] = (Array.isArray(list) ? list : []).filter(r => !(r.id === req.params.id && (r.fromDid === me.user.did || r.toDid === me.user.did)));
  }
  const persistence = await saveRequests(all);
  if (sendSnapshotSyncFailure(res, persistence, 'Access-request removal')) return;
  res.json({ ok: true });
});

module.exports = router;
