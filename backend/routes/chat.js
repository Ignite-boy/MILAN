'use strict';

const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const dwnStore = require('../services/dwnService');
const milanDb = require('../services/milanDb');
const livePush = require('../services/livePush');
const { readJson } = require('../utils/store');
const { pullDatabaseSnapshot } = require('../services/cloudDwnRegistry');

const router = express.Router();

const CHAT_SCHEMA = 'milan.chat.message';
const CHAT_PROTOCOL = 'milan.chat';
const CHAT_PATH = 'messages';
const CHAT_RECEIPT_SCHEMA = 'milan.chat.receipt';
const CHAT_RECEIPT_PATH = 'receipts';
const CHAT_DELETE_SCHEMA = 'milan.chat.deletion';
const CHAT_DELETE_PATH = 'message-deletions';
const MAX_MESSAGE_CHARS = 5000;
const MAX_HISTORY = 200;
const CHAT_QUERY_RECORD_LIMIT = MAX_HISTORY * 2;
const CHAT_GLOBAL_RECORD_LIMIT = MAX_HISTORY * 20;
// A retry can arrive while the first request is still syncing its two private
// mailboxes. Serialising by message keeps the operation idempotent inside this
// server instance; deterministic record IDs keep it idempotent across restarts.
const chatWriteLocks = new Map();

const didOf = value => String(value || '').trim();

function localConnections() {
  return readJson(global.connectionsFile, {});
}

async function refreshConnectionsFromCloud() {
  const local = localConnections();
  try {
    const pulled = await pullDatabaseSnapshot('connections.json');
    if (
      pulled?.ok &&
      !pulled?.missing &&
      pulled?.data &&
      typeof pulled.data === 'object' &&
      !Array.isArray(pulled.data)
    ) {
      const remote = pulled.data;
      if (Object.keys(remote).length === 0 && Object.keys(local).length > 0) {
        return local;
      }
      return remote;
    }
  } catch (_) {}
  return local;
}

async function friendDidsFor(meDid) {
  const snapshot = await refreshConnectionsFromCloud();
  const result = new Set();

  for (const row of Object.values(snapshot || {})) {
    if (row?.status !== 'approved') continue;
    if (row.fromDid === meDid && row.toDid) result.add(row.toDid);
    if (row.toDid === meDid && row.fromDid) result.add(row.fromDid);
  }

  return result;
}

function peopleSearchScore(person, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return 10;
  const name = String(person.name || '').toLowerCase();
  const did = String(person.did || '').toLowerCase();

  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (did === q) return 2;
  if (did.startsWith(q)) return 3;
  if (name.includes(q)) return 4;
  if (did.includes(q)) return 5;
  return 9;
}

function conversationIdFor(a, b) {
  return crypto
    .createHash('sha256')
    .update([didOf(a), didOf(b)].sort().join('|'))
    .digest('hex')
    .slice(0, 48);
}

function cleanText(value) {
  return String(value == null ? '' : value)
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}

function cleanClientMessageId(value) {
  const id = String(value == null ? '' : value).trim().slice(0, 120);
  if (!id) return '';
  // Client IDs are opaque idempotency keys, not user-facing text. Keeping a
  // constrained format prevents accidental key reuse caused by pasted text.
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(id) ? id : null;
}

async function recipientByDid(did) {
  const value = didOf(did);
  if (!value) return null;

  const result = await milanDb.query(
    'SELECT user_id AS id, email, name, did, space_id FROM public.users WHERE did = $1 LIMIT 1',
    [value]
  );

  return result.rows[0] || null;
}

function toMessage(record) {
  const data = record?.data && typeof record.data === 'object' ? record.data : {};
  return {
    id: String(record?.id || ''),
    messageId: String(data.messageId || record?.id || ''),
    conversationId: String(data.conversationId || ''),
    senderDid: String(data.senderDid || record?.owner || ''),
    recipientDid: String(data.recipientDid || ''),
    text: String(data.text || ''),
    sentAt: data.sentAt || record?.dateCreated || record?.dateModified || new Date().toISOString(),
    dateModified: record?.dateModified || record?.dateCreated || null,
    deliveryStatus: String(data.deliveryStatus || 'sent'),
    deliveredAt: data.deliveredAt || null,
    readAt: data.readAt || null,
    deletedForEveryone: data.deletedForEveryone === true,
    deletedByDid: didOf(data.deletedByDid),
    deletedAt: data.deletedAt || null
  };
}

function chatMessageRecordOptions(data) {
  return {
    schema: CHAT_SCHEMA,
    title: 'MILAN Chat Message',
    dataFormat: 'application/json',
    protocol: CHAT_PROTOCOL,
    protocolPath: CHAT_PATH,
    accessMode: 'private',
    sharedWithDids: [],
    awaitCloudSync: true,
    data
  };
}

function mailboxRecordId(conversationId, messageId, role) {
  return crypto.createHash('sha256')
    .update(['milan-chat-mailbox-v1', conversationId, messageId, role].join('|'))
    .digest('hex')
    .slice(0, 64);
}

async function withChatWriteLock(lockKey, operation) {
  const previous = chatWriteLocks.get(lockKey) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queued = previous.catch(() => {}).then(() => gate);
  chatWriteLocks.set(lockKey, queued);

  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (chatWriteLocks.get(lockKey) === queued) chatWriteLocks.delete(lockKey);
  }
}

async function chatMailboxRecord(ownerDid, conversationId, messageId, role) {
  const owner = didOf(ownerDid);
  const recordId = mailboxRecordId(conversationId, messageId, role);
  if (!owner || !recordId) return null;

  const result = await milanDb.query(
    `SELECT item_key AS record_id, did AS owner_did,
            date_created, date_modified, deleted, data_bytes
       FROM public.dwn_storage
      WHERE component_type = 'record'
        AND did = $1
        AND space_id = (SELECT space_id FROM public.users WHERE did = $1 LIMIT 1)
        AND item_key = $2
        AND deleted = FALSE
      LIMIT 1`,
    [owner, recordId]
  );

  const row = result.rows[0];
  if (!row) return null;

  const data = decodeStoredData(row.data_bytes);
  if (!data || typeof data !== 'object' || data.kind !== 'chat_message') return null;

  return {
    id: String(row.record_id || recordId),
    owner,
    dateCreated: row.date_created || null,
    dateModified: row.date_modified || row.date_created || null,
    data
  };
}

async function createChatMailboxRecord(userId, ownerDid, data) {
  const role = String(data?.mailboxRole || '').trim() || 'mailbox';
  return dwnStore.createRecord(userId, ownerDid, {
    ...chatMessageRecordOptions(data),
    recordId: mailboxRecordId(data.conversationId, data.messageId, role)
  });
}

async function recipientMailboxHasReceipt(ownerDid, conversationId, messageId, readerDid) {
  const owner = didOf(ownerDid);
  const key = didOf(messageId);
  const reader = didOf(readerDid);
  if (!owner || !key || !reader) return false;

  const recordId = receiptRecordId(conversationId, key, reader, owner);
  const result = await milanDb.query(
    `SELECT 1
       FROM public.dwn_storage
      WHERE component_type = 'record'
        AND did = $1
        AND space_id = (SELECT space_id FROM public.users WHERE did = $1 LIMIT 1)
        AND item_key = $2
        AND deleted = FALSE
      LIMIT 1`,
    [owner, recordId]
  );

  return result.rowCount > 0;
}

function chatReceiptRecordOptions(data) {
  return {
    schema: CHAT_RECEIPT_SCHEMA,
    title: 'MILAN Chat Read Receipt',
    dataFormat: 'application/json',
    protocol: CHAT_PROTOCOL,
    protocolPath: CHAT_RECEIPT_PATH,
    accessMode: 'private',
    sharedWithDids: [],
    awaitCloudSync: true,
    data
  };
}

function receiptRecordId(conversationId, messageId, readerDid, ownerDid) {
  return crypto.createHash('sha256')
    .update(['milan-chat-receipt-v1', conversationId, messageId, readerDid, ownerDid].join('|'))
    .digest('hex')
    .slice(0, 64);
}

async function createChatReceiptRecord(userId, ownerDid, data) {
  return dwnStore.createRecord(userId, ownerDid, {
    ...chatReceiptRecordOptions(data),
    recordId: receiptRecordId(data.conversationId, data.messageId, data.readerDid, ownerDid)
  });
}


function chatDeletionRecordId(conversationId, messageId, ownerDid) {
  return crypto.createHash('sha256')
    .update(['milan-chat-hidden-v1', conversationId, messageId, ownerDid].join('|'))
    .digest('hex')
    .slice(0, 64);
}

function chatDeletionRecordOptions(data) {
  return {
    schema: CHAT_DELETE_SCHEMA,
    title: 'MILAN Chat Message Deletion',
    dataFormat: 'application/json',
    protocol: CHAT_PROTOCOL,
    protocolPath: CHAT_DELETE_PATH,
    accessMode: 'private',
    sharedWithDids: [],
    awaitCloudSync: true,
    data
  };
}

async function createChatDeletionMarker(userId, ownerDid, data) {
  return dwnStore.createRecord(userId, ownerDid, {
    ...chatDeletionRecordOptions(data),
    recordId: chatDeletionRecordId(data.conversationId, data.messageId, ownerDid)
  });
}

async function chatDeletionMarker(ownerDid, conversationId, messageId) {
  const owner = didOf(ownerDid);
  const recordId = chatDeletionRecordId(conversationId, messageId, owner);
  if (!owner || !recordId) return null;

  const result = await milanDb.query(
    `SELECT item_key AS record_id, data_bytes
       FROM public.dwn_storage
      WHERE component_type = 'record'
        AND did = $1
        AND space_id = (SELECT space_id FROM public.users WHERE did = $1 LIMIT 1)
        AND item_key = $2
        AND protocol = $3
        AND protocol_path = $4
        AND deleted = FALSE
      LIMIT 1`,
    [owner, recordId, CHAT_PROTOCOL, CHAT_DELETE_PATH]
  );

  if (result.rowCount !== 1) return null;
  const data = decodeStoredData(result.rows[0].data_bytes);
  if (!data || data.kind !== 'chat_message_hidden') return null;
  return { id: String(result.rows[0].record_id || recordId), data };
}

async function conversationHiddenMessageIds(meDid, otherDid) {
  const owner = didOf(meDid);
  const other = didOf(otherDid);
  if (!owner || !other) return [];

  const conversationId = conversationIdFor(owner, other);
  const result = await milanDb.query(
    `SELECT data_bytes
       FROM public.dwn_storage
      WHERE component_type = 'record'
        AND did = $1
        AND space_id = (SELECT space_id FROM public.users WHERE did = $1 LIMIT 1)
        AND deleted = FALSE
        AND protocol = $2
        AND protocol_path = $3
      ORDER BY date_created DESC
      LIMIT $4`,
    [owner, CHAT_PROTOCOL, CHAT_DELETE_PATH, CHAT_GLOBAL_RECORD_LIMIT]
  );

  const hidden = new Set();
  for (const row of result.rows) {
    const data = decodeStoredData(row.data_bytes);
    if (!data || data.kind !== 'chat_message_hidden') continue;
    if (String(data.conversationId || '') !== conversationId) continue;
    const senderDid = didOf(data.senderDid);
    const recipientDid = didOf(data.recipientDid);
    if (!(
      (senderDid === owner && recipientDid === other) ||
      (senderDid === other && recipientDid === owner)
    )) continue;
    const messageId = didOf(data.messageId);
    if (messageId) hidden.add(messageId);
  }
  return [...hidden];
}

async function activeChatMailboxRecordExists(ownerDid, recordId) {
  const owner = didOf(ownerDid);
  const id = didOf(recordId);
  if (!owner || !id) return false;

  const result = await milanDb.query(
    `SELECT 1
       FROM public.dwn_storage
      WHERE component_type = 'record'
        AND did = $1
        AND space_id = (SELECT space_id FROM public.users WHERE did = $1 LIMIT 1)
        AND item_key = $2
        AND deleted = FALSE
      LIMIT 1`,
    [owner, id]
  );
  return result.rowCount > 0;
}

async function deleteChatMailboxRecordIfPresent(userId, ownerDid, recordId) {
  if (!(await activeChatMailboxRecordExists(ownerDid, recordId))) return false;

  const deleted = await dwnStore.deleteRecord(userId, ownerDid, recordId);
  if (!deleted && await activeChatMailboxRecordExists(ownerDid, recordId)) {
    const err = new Error('The chat message could not be permanently removed from its DWN mailbox.');
    err.status = 502;
    throw err;
  }
  return !!deleted;
}

function decodeStoredData(value) {
  if (value == null) return {};
  try {
    if (Buffer.isBuffer(value)) {
      const text = value.toString('utf8');
      return JSON.parse(text);
    }
    const raw = String(value);
    if (raw.startsWith('\\x')) return JSON.parse(Buffer.from(raw.slice(2), 'hex').toString('utf8'));
    if (raw.startsWith('0x')) return JSON.parse(Buffer.from(raw.slice(2), 'hex').toString('utf8'));
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

async function conversationMessages(meDid, otherDid, options = {}) {
  const conversationId = conversationIdFor(meDid, otherDid);
  const afterMs = Date.parse(options.after || '');
  const params = [meDid, CHAT_PROTOCOL, CHAT_PATH];

  let where = `
    component_type = 'record'
    AND did = $1
    AND space_id = (SELECT space_id FROM public.users WHERE did = $1 LIMIT 1)
    AND deleted = FALSE
    AND protocol = $2
    AND protocol_path = $3
  `;

  if (Number.isFinite(afterMs)) {
    params.push(new Date(afterMs).toISOString());
    where += ` AND date_created >= $${params.length}`;
  }

  params.push(CHAT_QUERY_RECORD_LIMIT);

  const messages = await milanDb.query(
    `SELECT item_key AS record_id, did AS owner_did, recipient,
            protocol, protocol_path, date_created, date_modified,
            metadata, deleted, data_bytes
       FROM public.dwn_storage
      WHERE ${where}
      ORDER BY date_created DESC
      LIMIT $${params.length}`,
    params
  );

  const rows = messages.rows;
  if (!rows.length) return [];
  const hiddenMessageIds = new Set(await conversationHiddenMessageIds(meDid, otherDid));

  const receipts = await milanDb.query(
    `SELECT data_bytes
       FROM public.dwn_storage
      WHERE component_type = 'record'
        AND did = $1
        AND space_id = (SELECT space_id FROM public.users WHERE did = $1 LIMIT 1)
        AND deleted = FALSE
        AND protocol = $2
        AND protocol_path = $3
      ORDER BY date_created DESC
      LIMIT $4`,
    [meDid, CHAT_PROTOCOL, CHAT_RECEIPT_PATH, MAX_HISTORY * 4]
  );

  const readAtByMessageId = new Map();

  for (const row of receipts.rows) {
    const data = decodeStoredData(row.data_bytes);
    if (!data || data.kind !== 'chat_receipt' || data.state !== 'read') continue;
    if (String(data.readerDid || '') !== meDid &&
        String(data.readerDid || '') !== otherDid) continue;

    const key = String(data.messageId || '');
    const readAt = data.readAt || null;
    const previous = readAtByMessageId.get(key);

    if (key && readAt &&
        (!previous || (Date.parse(readAt) || 0) > (Date.parse(previous) || 0))) {
      readAtByMessageId.set(key, readAt);
    }
  }

  const visible = rows.map(row => {
    const metadata = row.metadata && typeof row.metadata === 'object'
      ? row.metadata
      : {};

    const data = decodeStoredData(row.data_bytes);

    return {
      id: String(row.record_id || ''),
      messageId: String(data.messageId || row.record_id || ''),
      conversationId: String(data.conversationId || ''),
      senderDid: String(data.senderDid || row.owner_did || ''),
      recipientDid: String(data.recipientDid || row.recipient || ''),
      text: String(data.text || ''),
      sentAt: data.sentAt || row.date_created || row.date_modified || new Date().toISOString(),
      dateModified: row.date_modified || row.date_created || null,
      deliveryStatus: String(data.deliveryStatus || 'sent'),
      deliveredAt: data.deliveredAt || null,
      readAt: data.readAt ||
        readAtByMessageId.get(String(data.messageId || row.record_id || '')) || null,
      deletedForEveryone: data.deletedForEveryone === true,
      deletedByDid: didOf(data.deletedByDid),
      deletedAt: data.deletedAt || null,
      ownerDid: String(row.owner_did || ''),
      sharedWithDids: Array.isArray(metadata.sharedWithDids) ? metadata.sharedWithDids : []
    };
  }).filter(message =>
    (!Number.isFinite(afterMs) || Date.parse(message.sentAt || '') >= afterMs ||
      (message.deletedForEveryone && Date.parse(message.deletedAt || message.dateModified || '') >= afterMs)) &&
    message.conversationId === conversationId &&
    (!hiddenMessageIds.has(String(message.messageId || message.id || '')) || message.deletedForEveryone) &&
    message.ownerDid === meDid &&
    (
      (message.senderDid === meDid && message.recipientDid === otherDid) ||
      (message.senderDid === otherDid && message.recipientDid === meDid)
    )
  );

  const byMessageId = new Map();
  for (const message of visible) {
    const key = message.messageId || message.id;
    const previous = byMessageId.get(key);
    if (!previous ||
        (message.deletedForEveryone && !previous.deletedForEveryone) ||
        (!previous.deletedForEveryone && message.ownerDid === meDid)) {
      byMessageId.set(key, message);
    }
  }

  return [...byMessageId.values()]
    .map(({ ownerDid, sharedWithDids, ...message }) => message)
    .sort((a, b) =>
      (Date.parse(a.sentAt || '') || 0) - (Date.parse(b.sentAt || '') || 0)
    )
    .slice(-MAX_HISTORY);
}

async function listConversations(meDid) {
  const currentDid = didOf(meDid);
  if (!currentDid) return [];

  const friendDids = await friendDidsFor(currentDid);

  const result = await milanDb.query(
    `SELECT item_key AS record_id, did AS owner_did, recipient,
            protocol, protocol_path, date_created, date_modified,
            metadata, deleted, data_bytes
       FROM public.dwn_storage
      WHERE component_type = 'record'
        AND did = $1
        AND space_id = (SELECT space_id FROM public.users WHERE did = $1 LIMIT 1)
        AND deleted = FALSE
        AND protocol = $2
        AND protocol_path = $3
      ORDER BY date_created DESC
      LIMIT $4`,
    [currentDid, CHAT_PROTOCOL, CHAT_PATH, CHAT_GLOBAL_RECORD_LIMIT]
  );

  const rows = result.rows;
  if (!rows.length) return [];

  const uniqueMessages = new Map();

  for (const row of rows) {
    const recordId = String(row.record_id || '');
    const data = decodeStoredData(row.data_bytes);
    if (!data || data.kind !== 'chat_message') continue;

    const ownerDid = didOf(row.owner_did);
    if (ownerDid !== currentDid) continue;

    const senderDid = didOf(data.senderDid || row.owner_did);
    const recipientDid = didOf(data.recipientDid || row.recipient);

    if (!senderDid || !recipientDid ||
        (senderDid !== currentDid && recipientDid !== currentDid)) continue;

    const otherDid = senderDid === currentDid ? recipientDid : senderDid;
    if (!otherDid || otherDid === currentDid || !friendDids.has(otherDid)) continue;

    const conversationId = String(
      data.conversationId || conversationIdFor(currentDid, otherDid)
    );
    const messageId = String(data.messageId || recordId);

    const candidate = {
      recordId, messageId, ownerDid, conversationId, otherDid, senderDid,
      text: data.deletedForEveryone ? 'This message was deleted' : String(data.text || '').slice(0, 160),
      sentAt: data.sentAt || row.date_created || row.date_modified || '',
      deletedForEveryone: data.deletedForEveryone === true
    };

    const previous = uniqueMessages.get(messageId);
    if (!previous ||
        (candidate.deletedForEveryone && !previous.deletedForEveryone) ||
        (!previous.deletedForEveryone && candidate.ownerDid === currentDid)) {
      uniqueMessages.set(messageId, candidate);
    }
  }

  const byConversation = new Map();

  for (const message of uniqueMessages.values()) {
    const item = byConversation.get(message.conversationId) || {
      conversationId: message.conversationId,
      otherDid: message.otherDid,
      lastMessage: message.text,
      lastMessageAt: message.sentAt,
      lastMessageId: message.messageId,
      lastSenderDid: message.senderDid,
      messageCount: 0
    };

    item.messageCount += 1;
    if ((Date.parse(message.sentAt || '') || 0) >=
        (Date.parse(item.lastMessageAt || '') || 0)) {
      item.lastMessage = message.text;
      item.lastMessageAt = message.sentAt;
      item.lastMessageId = message.messageId;
      item.lastSenderDid = message.senderDid;
    }
    byConversation.set(message.conversationId, item);
  }

  const conversationRows = [...byConversation.values()]
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
    .slice(0, 100);

  if (!conversationRows.length) return [];

  const dids = [...new Set(conversationRows.map(row => row.otherDid))];
  const profilesResult = await milanDb.query(
    'SELECT user_id AS id, email, name, did FROM public.users WHERE did = ANY($1::text[])',
    [dids]
  );

  const profiles = new Map(profilesResult.rows.map(user => [
    String(user.did),
    {
      id: user.id,
      name: user.name || user.email?.split('@')[0] || 'MILAN User',
      did: String(user.did)
    }
  ]));

  return conversationRows
    .map(row => ({
      conversationId: row.conversationId,
      person: profiles.get(row.otherDid) || { name: 'MILAN User', did: row.otherDid },
      lastMessage: row.lastMessage,
      lastMessageAt: row.lastMessageAt,
      lastMessageId: row.lastMessageId,
      lastSenderDid: row.lastSenderDid,
      messageCount: row.messageCount
    }))
    .filter(row => row.person?.did && row.person.did !== currentDid);
}

router.get('/people', auth, async (req, res) => {
  const meDid = didOf(req.did || req.account?.did);
  const q = cleanText(req.query.q).toLowerCase().slice(0, 120);

  if (!meDid) return res.status(401).json({ error: 'Authenticated DID unavailable' });

  try {
    const friendDids = await friendDidsFor(meDid);
    if (!friendDids.size) {
      res.setHeader('Cache-Control', 'no-store');
      return res.json([]);
    }

    const accountsResult = await milanDb.query(
      'SELECT user_id AS id, email, name, did FROM public.users WHERE did = ANY($1::text[])',
      [[...friendDids]]
    );
    const accounts = accountsResult.rows;
    const rows = accounts
      .filter(account => account.id !== req.userId && friendDids.has(String(account.did || '')))
      .map(account => ({
        id: account.id,
        name: account.name || account.email?.split('@')[0] || 'MILAN User',
        did: String(account.did || ''),
        connectionStatus: 'friends'
      }))
      .filter(person => {
        if (!q) return true;
        return String(person.name).toLowerCase().includes(q) ||
          String(person.did).toLowerCase().includes(q);
      })
      .sort((a, b) =>
        peopleSearchScore(a, q) - peopleSearchScore(b, q) ||
        a.name.localeCompare(b.name) ||
        a.did.localeCompare(b.did)
      );

    res.setHeader('Cache-Control', 'no-store');
    return res.json(rows.slice(0, 100));
  } catch (err) {
    console.error('[chat/people]', err);
    return res.status(500).json({ error: 'Chat people search unavailable' });
  }
});

router.get('/conversations', auth, async (req, res) => {
  const meDid = didOf(req.did || req.account?.did);
  if (!meDid) return res.status(401).json({ error: 'Authenticated DID unavailable' });

  try {
    const conversations = await listConversations(meDid);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, conversations });
  } catch (err) {
    console.error('[chat/conversations]', err);
    return res.status(500).json({ error: 'Conversations unavailable' });
  }
});

router.post('/with/:did/read', auth, async (req, res) => {
  const meDid = didOf(req.did || req.account?.did);
  const otherDid = didOf(req.params.did);
  const messageIds = Array.isArray(req.body?.messageIds)
    ? [...new Set(req.body.messageIds.map(didOf).filter(Boolean))].slice(0, MAX_HISTORY)
    : [];

  if (!meDid) return res.status(401).json({ error: 'Authenticated DID unavailable' });
  if (!otherDid) return res.status(400).json({ error: 'Recipient DID required' });
  if (meDid === otherDid) return res.status(400).json({ error: 'Cannot mark your own messages as read' });
  if (!messageIds.length) return res.json({ ok: true, read: 0 });

  try {
    const other = await recipientByDid(otherDid);
    if (!other) return res.status(404).json({ error: 'Person not found' });

    const friendDids = await friendDidsFor(meDid);
    if (!friendDids.has(otherDid)) {
      return res.status(403).json({ error: 'You can only mark connected friends as read' });
    }

    const conversation = await conversationMessages(meDid, otherDid);
    const incoming = conversation.filter(message =>
      message.senderDid === otherDid &&
      message.recipientDid === meDid &&
      messageIds.includes(String(message.messageId || ''))
    );

    const conversationId = conversationIdFor(meDid, otherDid);
    const readAt = new Date().toISOString();
    let created = 0;

    for (const message of incoming) {
      const receiptData = {
        kind: 'chat_receipt',
        state: 'read',
        messageId: String(message.messageId),
        conversationId,
        senderDid: otherDid,
        readerDid: meDid,
        readAt
      };

      const receiptResult = await withChatWriteLock(
        ['read', conversationId, message.messageId, meDid].join('|'),
        async () => {
          let readerCopyCreated = false;
          let senderCopyCreated = false;

          if (!(await recipientMailboxHasReceipt(meDid, conversationId, message.messageId, meDid))) {
            await createChatReceiptRecord(req.userId, meDid, {
              ...receiptData,
              mailboxRole: 'reader'
            });
            readerCopyCreated = true;
          }

          if (!(await recipientMailboxHasReceipt(otherDid, conversationId, message.messageId, meDid))) {
            await createChatReceiptRecord(other.id, otherDid, {
              ...receiptData,
              mailboxRole: 'sender'
            });
            senderCopyCreated = true;
          }

          return { readerCopyCreated, senderCopyCreated };
        }
      );

      if (receiptResult.readerCopyCreated) created += 1;
      if (receiptResult.readerCopyCreated || receiptResult.senderCopyCreated) {
        livePush.push(other.id, 'notify', {
          notifType: 'chat_read',
          conversationId,
          readerDid: meDid,
          messageId: String(message.messageId),
          readAt
        });
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, read: created, readAt });
  } catch (err) {
    console.error('[chat/read]', err);
    return res.status(500).json({ error: 'Read receipt sync unavailable' });
  }
});

router.post('/with/:did/typing', auth, async (req, res) => {
  const meDid = didOf(req.did || req.account?.did);
  const otherDid = didOf(req.params.did);
  const active = req.body?.active === true;

  if (!meDid) return res.status(401).json({ error: 'Authenticated DID unavailable' });
  if (!otherDid) return res.status(400).json({ error: 'Recipient DID required' });
  if (meDid === otherDid) return res.status(400).json({ error: 'Cannot type to yourself' });

  try {
    const recipient = await recipientByDid(otherDid);
    if (!recipient) return res.status(404).json({ error: 'Person not found' });

    const friendDids = await friendDidsFor(meDid);
    if (!friendDids.has(otherDid)) {
      return res.status(403).json({ error: 'You can only type to connected friends' });
    }

    livePush.push(recipient.id, 'notify', {
      notifType: 'chat_typing',
      conversationId: conversationIdFor(meDid, otherDid),
      senderDid: meDid,
      active
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true });
  } catch (err) {
    console.error('[chat/typing]', err);
    return res.status(500).json({ error: 'Typing status unavailable' });
  }
});

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    chat: 'ready',
    transport: 'DWN-to-DWN private mailbox records',
    persistence: 'PostgreSQL-authoritative isolated DWN spaces',
    audience: 'Approved MILAN friends only',
    realtime: 'SSE accelerator; PostgreSQL sync fallback'
  });
});

router.get('/with/:did', auth, async (req, res) => {
  const meDid = didOf(req.did || req.account?.did);
  const otherDid = didOf(req.params.did);

  if (!meDid) return res.status(401).json({ error: 'Authenticated DID unavailable' });
  if (!otherDid) return res.status(400).json({ error: 'Recipient DID required' });
  if (meDid === otherDid) return res.status(400).json({ error: 'Cannot chat with yourself' });

  try {
    const recipient = await recipientByDid(otherDid);
    if (!recipient) return res.status(404).json({ error: 'Person not found' });

    const friendDids = await friendDidsFor(meDid);
    if (!friendDids.has(otherDid)) {
      return res.status(403).json({ error: 'You can only chat with connected friends' });
    }

    const messages = await conversationMessages(meDid, otherDid);
    const hiddenMessageIds = await conversationHiddenMessageIds(meDid, otherDid);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      conversationId: conversationIdFor(meDid, otherDid),
      hiddenMessageIds,
      person: {
        id: recipient.id,
        name: recipient.name || recipient.email?.split('@')[0] || 'MILAN User',
        did: recipient.did
      },
      messages
    });
  } catch (err) {
    console.error('[chat/get]', err);
    return res.status(500).json({ error: 'Chat history unavailable' });
  }
});

router.get('/with/:did/messages', auth, async (req, res) => {
  const meDid = didOf(req.did || req.account?.did);
  const otherDid = didOf(req.params.did);
  const after = String(req.query.after || '').trim();

  if (!meDid) return res.status(401).json({ error: 'Authenticated DID unavailable' });
  if (!otherDid) return res.status(400).json({ error: 'Recipient DID required' });
  if (meDid === otherDid) return res.status(400).json({ error: 'Cannot chat with yourself' });

  try {
    const recipient = await recipientByDid(otherDid);
    if (!recipient) return res.status(404).json({ error: 'Person not found' });

    const friendDids = await friendDidsFor(meDid);
    if (!friendDids.has(otherDid)) {
      return res.status(403).json({ error: 'You can only sync chat with connected friends' });
    }

    const messages = await conversationMessages(meDid, otherDid, { after });
    const hiddenMessageIds = await conversationHiddenMessageIds(meDid, otherDid);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      conversationId: conversationIdFor(meDid, otherDid),
      messages,
      hiddenMessageIds
    });
  } catch (err) {
    console.error('[chat/messages]', err);
    return res.status(500).json({ error: 'Live message sync unavailable' });
  }
});

router.post('/with/:did/messages', auth, async (req, res) => {
  const meDid = didOf(req.did || req.account?.did);
  const otherDid = didOf(req.params.did);
  const text = cleanText(req.body?.text);
  const clientMessageId = cleanClientMessageId(req.body?.clientMessageId);

  if (!meDid) return res.status(401).json({ error: 'Authenticated DID unavailable' });
  if (!otherDid) return res.status(400).json({ error: 'Recipient DID required' });
  if (meDid === otherDid) return res.status(400).json({ error: 'Cannot message yourself' });
  if (!text) return res.status(400).json({ error: 'Message cannot be empty' });
  if (clientMessageId === null) return res.status(400).json({ error: 'Invalid client message ID' });

  try {
    const recipient = await recipientByDid(otherDid);
    if (!recipient) return res.status(404).json({ error: 'Person not found' });

    const friendDids = await friendDidsFor(meDid);
    if (!friendDids.has(otherDid)) {
      return res.status(403).json({ error: 'You can only message connected friends' });
    }

    const messageId = clientMessageId || crypto.randomUUID();
    const conversationId = conversationIdFor(meDid, otherDid);
    const sendMessage = async () => {
      const [senderTombstone, recipientTombstone, senderHidden, recipientHidden] = await Promise.all([
        chatMailboxRecord(meDid, conversationId, messageId, 'tombstone-sender'),
        chatMailboxRecord(otherDid, conversationId, messageId, 'tombstone-recipient'),
        chatDeletionMarker(meDid, conversationId, messageId),
        chatDeletionMarker(otherDid, conversationId, messageId)
      ]);
      if (senderTombstone || recipientTombstone || senderHidden || recipientHidden) {
        const err = new Error('This message was already deleted and cannot be sent again with the same message ID.');
        err.status = 409;
        throw err;
      }

      // The only records read here are the deterministic private mailbox
      // records for these two DIDs. A retry never scans an arbitrary history,
      // so it stays correct even after a busy conversation exceeds its window.
      const senderExisting = await chatMailboxRecord(meDid, conversationId, messageId, 'sender');
      const recipientExisting = await chatMailboxRecord(otherDid, conversationId, messageId, 'recipient');
      const saved = senderExisting?.data || recipientExisting?.data || {};
      const now = new Date().toISOString();
      const messageData = {
        kind: 'chat_message',
        messageId,
        conversationId,
        senderDid: meDid,
        recipientDid: otherDid,
        // Preserve the first successfully written payload if the same
        // clientMessageId is retried with altered text.
        text: String(saved.text || text),
        sentAt: saved.sentAt || now,
        deliveryStatus: 'delivered',
        deliveredAt: saved.deliveredAt || now
      };

      // One-to-one DWN mailbox model:
      // 1) the recipient-owned private mailbox receives the message;
      // 2) the sender-owned private mailbox keeps the sender's durable copy.
      // The operation may resume safely after an interrupted half-write.
      if (!recipientExisting) {
        await createChatMailboxRecord(recipient.id, otherDid, {
          ...messageData,
          mailboxRole: 'recipient'
        });
      }

      const senderRecord = senderExisting || await createChatMailboxRecord(req.userId, meDid, {
        ...messageData,
        mailboxRole: 'sender'
      });
      const message = toMessage(senderRecord);
      const duplicate = !!senderExisting && !!recipientExisting;

      if (!duplicate) {
        const realtimeMessage = { ...message, status: 'delivered' };
        try {
          // Notify both parties. The sender notification makes a message sent
          // on phone appear immediately on the sender's other signed-in device.
          livePush.push(recipient.id, 'notify', {
            notifType: 'chat_message', conversationId, senderDid: meDid, messageId, message: realtimeMessage
          });
          livePush.push(req.userId, 'notify', {
            notifType: 'chat_message', conversationId, senderDid: meDid, messageId, message: realtimeMessage
          });
        } catch (_) {}
      }

      return { duplicate, message };
    };

    const outcome = clientMessageId
      ? await withChatWriteLock(['message', conversationId, messageId].join('|'), sendMessage)
      : await sendMessage();

    return res.status(outcome.duplicate ? 200 : 201).json({
      ok: true,
      duplicate: outcome.duplicate,
      conversationId,
      message: outcome.message,
      recipient: {
        id: recipient.id,
        name: recipient.name || recipient.email?.split('@')[0] || 'MILAN User',
        did: recipient.did
      }
    });
  } catch (err) {
    console.error('[chat/send]', err);
    return res.status(err.status || 500).json({
      error: err.message || 'Message could not be sent'
    });
  }
});


router.delete('/with/:did/messages/:messageId', auth, async (req, res) => {
  const meDid = didOf(req.did || req.account?.did);
  const otherDid = didOf(req.params.did);
  const messageId = cleanClientMessageId(req.params.messageId);
  const mode = String(req.body?.mode || 'me').trim().toLowerCase();

  if (!meDid) return res.status(401).json({ error: 'Authenticated DID unavailable' });
  if (!otherDid) return res.status(400).json({ error: 'Recipient DID required' });
  if (meDid === otherDid) return res.status(400).json({ error: 'Cannot delete a message from a self-chat' });
  if (!messageId) return res.status(400).json({ error: 'Valid message ID required' });
  if (mode !== 'me' && mode !== 'everyone') {
    return res.status(400).json({ error: 'Delete mode must be me or everyone' });
  }

  try {
    const other = await recipientByDid(otherDid);
    if (!other) return res.status(404).json({ error: 'Person not found' });

    const friendDids = await friendDidsFor(meDid);
    if (!friendDids.has(otherDid)) {
      return res.status(403).json({ error: 'You can only delete messages in connected-friend chats' });
    }

    const conversationId = conversationIdFor(meDid, otherDid);
    const [ownSender, ownRecipient, ownTombstoneSender, ownTombstoneRecipient] = await Promise.all([
      chatMailboxRecord(meDid, conversationId, messageId, 'sender'),
      chatMailboxRecord(meDid, conversationId, messageId, 'recipient'),
      chatMailboxRecord(meDid, conversationId, messageId, 'tombstone-sender'),
      chatMailboxRecord(meDid, conversationId, messageId, 'tombstone-recipient')
    ]);
    const ownOriginal = ownSender || ownRecipient;
    const ownTombstone = ownTombstoneSender || ownTombstoneRecipient;
    const source = ownOriginal?.data || ownTombstone?.data;

    if (!source) return res.status(404).json({ error: 'Message not found in your private DWN mailbox' });

    const senderDid = didOf(source.senderDid);
    const recipientDid = didOf(source.recipientDid);
    const matchesConversation = String(source.conversationId || '') === conversationId &&
      ((senderDid === meDid && recipientDid === otherDid) ||
       (senderDid === otherDid && recipientDid === meDid));
    if (!matchesConversation) {
      return res.status(404).json({ error: 'Message does not belong to this conversation' });
    }

    if (mode === 'me') {
      if (ownOriginal && source.deletedForEveryone !== true &&
          !(await chatDeletionMarker(meDid, conversationId, messageId))) {
        await createChatDeletionMarker(req.userId, meDid, {
          kind: 'chat_message_hidden',
          messageId,
          conversationId,
          senderDid,
          recipientDid,
          hiddenByDid: meDid,
          hiddenAt: new Date().toISOString()
        });
      }

      let deletedCopies = 0;
      for (const record of [ownSender, ownRecipient, ownTombstoneSender, ownTombstoneRecipient].filter(Boolean)) {
        if (await deleteChatMailboxRecordIfPresent(req.userId, meDid, record.id)) deletedCopies += 1;
      }
      if (!deletedCopies && !ownOriginal && !ownTombstone) {
        return res.status(404).json({ error: 'Message not found in your private DWN mailbox' });
      }

      try {
        livePush.push(req.userId, 'notify', {
          notifType: 'chat_message_deleted',
          mode: 'me',
          ownerDid: meDid,
          otherDid,
          conversationId,
          messageId
        });
      } catch (_) {}

      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, mode: 'me', conversationId, messageId, hiddenMessageIds: [messageId] });
    }

    if (senderDid !== meDid) {
      return res.status(403).json({ error: 'Only the sender can delete this message for everyone' });
    }
    if (!ownSender && !ownTombstoneSender) {
      return res.status(404).json({ error: 'Your sender mailbox copy is unavailable' });
    }

    const [recipientCopy, recipientTombstone, recipientHidden] = await Promise.all([
      chatMailboxRecord(otherDid, conversationId, messageId, 'recipient'),
      chatMailboxRecord(otherDid, conversationId, messageId, 'tombstone-recipient'),
      chatDeletionMarker(otherDid, conversationId, messageId)
    ]);
    if (recipientCopy &&
        (didOf(recipientCopy.data.senderDid) !== meDid ||
         didOf(recipientCopy.data.recipientDid) !== otherDid ||
         String(recipientCopy.data.conversationId || '') !== conversationId)) {
      return res.status(409).json({ error: 'Recipient mailbox copy does not match this message' });
    }

    const senderData = ownSender?.data || ownTombstoneSender?.data || source;
    const deletedAt = ownTombstoneSender?.data?.deletedAt || senderData.deletedAt || new Date().toISOString();
    const tombstoneData = {
      kind: 'chat_message',
      messageId,
      conversationId,
      senderDid: meDid,
      recipientDid: otherDid,
      text: '',
      sentAt: senderData.sentAt || new Date().toISOString(),
      deliveryStatus: 'delivered',
      deliveredAt: senderData.deliveredAt || deletedAt,
      readAt: senderData.readAt || null,
      deletedForEveryone: true,
      deletedByDid: meDid,
      deletedAt
    };

    const senderTombstoneRecord = ownTombstoneSender ||
      await createChatMailboxRecord(req.userId, meDid, {
        ...tombstoneData,
        mailboxRole: 'tombstone-sender'
      });

    const recipientHadVisibleCopy = !!recipientCopy || !!recipientTombstone;
    let recipientTombstoneRecord = recipientTombstone;
    if (recipientHadVisibleCopy && !recipientHidden && !recipientTombstoneRecord) {
      recipientTombstoneRecord = await createChatMailboxRecord(other.id, otherDid, {
        ...tombstoneData,
        mailboxRole: 'tombstone-recipient'
      });
    }

    if (ownSender) await deleteChatMailboxRecordIfPresent(req.userId, meDid, ownSender.id);
    if (recipientCopy) await deleteChatMailboxRecordIfPresent(other.id, otherDid, recipientCopy.id);

    const deletedMessage = {
      id: String(senderTombstoneRecord?.id || mailboxRecordId(conversationId, messageId, 'tombstone-sender')),
      messageId,
      conversationId,
      senderDid: meDid,
      recipientDid: otherDid,
      text: '',
      sentAt: tombstoneData.sentAt,
      dateModified: deletedAt,
      deliveryStatus: 'delivered',
      deliveredAt: tombstoneData.deliveredAt,
      readAt: tombstoneData.readAt,
      deletedForEveryone: true,
      deletedByDid: meDid,
      deletedAt
    };

    try {
      livePush.push(req.userId, 'notify', {
        notifType: 'chat_message_deleted',
        mode: 'everyone',
        ownerDid: meDid,
        otherDid,
        conversationId,
        messageId,
        message: deletedMessage
      });
      if (recipientHadVisibleCopy && !recipientHidden) {
        livePush.push(other.id, 'notify', {
          notifType: 'chat_message_deleted',
          mode: 'everyone',
          ownerDid: otherDid,
          otherDid: meDid,
          conversationId,
          messageId,
          message: deletedMessage
        });
      }
    } catch (_) {}

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, mode: 'everyone', conversationId, messageId, message: deletedMessage });
  } catch (err) {
    console.error('[chat/delete]', err);
    return res.status(err.status || 500).json({ error: err.message || 'Message deletion failed' });
  }
});


module.exports = router;
