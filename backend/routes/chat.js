'use strict';

const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const dwnStore = require('../services/dwnService');
const { createClient } = require('@supabase/supabase-js');
const livePush = require('../services/livePush');
const { readJson } = require('../utils/store');
const { pullDatabaseSnapshot } = require('../services/cloudDwnRegistry');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CHAT_SCHEMA = 'milan.chat.message';
const CHAT_PROTOCOL = 'milan.chat';
const CHAT_PATH = 'messages';
const CHAT_RECEIPT_SCHEMA = 'milan.chat.receipt';
const CHAT_RECEIPT_PATH = 'receipts';
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
  const { data, error } = await supabase
    .from('users')
    .select('id,email,name,did,space_id')
    .eq('did', did)
    .maybeSingle();
  if (error) throw error;
  return data || null;
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
    readAt: data.readAt || null
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

function mailboxRecordId(ownerDid, conversationId, messageId, role) {
  return crypto.createHash('sha256')
    .update([
      'milan-chat-mailbox-v2',
      didOf(ownerDid),
      conversationId,
      messageId,
      role
    ].join('|'))
    .digest('hex')
    .slice(0, 64);
}

function legacyMailboxRecordId(conversationId, messageId, role) {
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
  if (!owner) return null;

  // Prefer owner-scoped v2 records. Legacy IDs are read-only fallbacks,
  // and only if the database row still belongs to this owner.
  const candidates = [
    { recordId: mailboxRecordId(owner, conversationId, messageId, role), legacy: false },
    { recordId: legacyMailboxRecordId(conversationId, messageId, role), legacy: true }
  ];

  for (const candidate of candidates) {
    const { data: row, error } = await supabase
      .from('dwn_records')
      .select('record_id,owner_did,date_created,date_modified,deleted')
      .eq('record_id', candidate.recordId)
      .eq('owner_did', owner)
      .eq('deleted', false)
      .maybeSingle();

    if (error) throw error;
    if (!row) continue;

    const { data: payload, error: payloadError } = await supabase
      .from('dwn_record_data')
      .select('data')
      .eq('record_id', row.record_id)
      .maybeSingle();

    if (payloadError) throw payloadError;

    const data = decodeStoredData(payload?.data);
    if (!data || typeof data !== 'object' || data.kind !== 'chat_message') continue;

    return {
      id: String(row.record_id || candidate.recordId),
      owner,
      dateCreated: row.date_created || null,
      dateModified: row.date_modified || row.date_created || null,
      data,
      legacy: candidate.legacy
    };
  }

  return null;
}

async function createChatMailboxRecord(userId, ownerDid, data) {
  const role = String(data?.mailboxRole || '').trim() || 'mailbox';
  return dwnStore.createRecord(userId, ownerDid, {
    ...chatMessageRecordOptions(data),
    recordId: mailboxRecordId(ownerDid, data.conversationId, data.messageId, role)
  });
}

async function recipientMailboxHasReceipt(ownerDid, conversationId, messageId, readerDid) {
  const owner = didOf(ownerDid);
  const key = didOf(messageId);
  const reader = didOf(readerDid);
  if (!owner || !key || !reader) return false;

  const { data: row, error } = await supabase
    .from('dwn_records')
    .select('record_id')
    .eq('deleted', false)
    .eq('owner_did', owner)
    .eq('protocol', CHAT_PROTOCOL)
    .eq('protocol_path', CHAT_RECEIPT_PATH)
    .eq('record_id', receiptRecordId(conversationId, key, reader, owner))
    .maybeSingle();

  if (error) throw error;
  if (!row) return false;

  const { data: payloadRow, error: payloadError } = await supabase
    .from('dwn_record_data')
    .select('data')
    .eq('record_id', row.record_id)
    .maybeSingle();

  if (payloadError) throw payloadError;

  const payload = decodeStoredData(payloadRow?.data);
  return !!payload &&
    payload.kind === 'chat_receipt' &&
    payload.state === 'read' &&
    String(payload.messageId || '') === key &&
    String(payload.conversationId || '') === String(conversationId || '') &&
    String(payload.readerDid || '') === reader;
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
  const recordId = receiptRecordId(
    data.conversationId, data.messageId, data.readerDid, ownerDid
  );

  // If this deterministic ID already exists in the local owner snapshot,
  // update its payload through the DWN service's normal cloud-sync path.
  // Otherwise createRecord will create it and publish the same deterministic ID.
  const repaired = await dwnStore.updateRecord(userId, ownerDid, recordId, {
    data
  });
  if (repaired) return repaired;

  return dwnStore.createRecord(userId, ownerDid, {
    ...chatReceiptRecordOptions(data),
    recordId
  });
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

  let recordsQuery = supabase
    .from('dwn_records')
    .select('record_id,owner_did,recipient,protocol,protocol_path,date_created,date_modified,metadata,deleted')
    .eq('deleted', false)
    .eq('protocol', CHAT_PROTOCOL)
    .eq('protocol_path', CHAT_PATH)
    .eq('owner_did', meDid);

  if (Number.isFinite(afterMs)) {
    recordsQuery = recordsQuery.gte('date_created', new Date(afterMs).toISOString());
  }

  const { data: rows, error } = await recordsQuery
    .order('date_created', { ascending: false })
     .limit(CHAT_QUERY_RECORD_LIMIT);

  if (error) throw error;
  if (!Array.isArray(rows) || !rows.length) return [];

  const ids = rows.map(row => String(row.record_id || '')).filter(Boolean);
  const { data: payloads, error: dataError } = await supabase
    .from('dwn_record_data')
    .select('record_id,data')
    .in('record_id', ids);

  if (dataError) throw dataError;

  const dataMap = new Map(
    (payloads || []).map(row => [String(row.record_id || ''), row.data])
  );

  const { data: receiptRows, error: receiptError } = await supabase
    .from('dwn_records')
    .select('record_id')
    .eq('deleted', false)
    .eq('protocol', CHAT_PROTOCOL)
    .eq('protocol_path', CHAT_RECEIPT_PATH)
    .eq('owner_did', meDid)
    .order('date_created', { ascending: false })
    .limit(MAX_HISTORY * 4);

  if (receiptError) throw receiptError;

  const receiptIds = (receiptRows || [])
    .map(row => String(row.record_id || ''))
    .filter(Boolean);

  let receiptPayloads = [];
  if (receiptIds.length) {
    const { data: payloads, error: receiptDataError } = await supabase
      .from('dwn_record_data')
      .select('record_id,data')
      .in('record_id', receiptIds);

    if (receiptDataError) throw receiptDataError;
    receiptPayloads = payloads || [];
  }

  const readAtByMessageId = new Map();
  for (const row of receiptPayloads) {
    const data = decodeStoredData(row.data);
    if (!data || typeof data !== 'object' || data.kind !== 'chat_receipt' || data.state !== 'read') continue;
    if (String(data.readerDid || '') !== meDid && String(data.readerDid || '') !== otherDid) continue;

    const messageKey = String(data.messageId || '');
    const readAt = data.readAt || null;
    if (!messageKey || !readAt) continue;

    const previous = readAtByMessageId.get(messageKey);
    if (!previous || (Date.parse(readAt) || 0) > (Date.parse(previous) || 0)) {
      readAtByMessageId.set(messageKey, readAt);
    }
  }

  const visible = rows.map(row => {
    let metadata = {};
    try { metadata = row.metadata ? JSON.parse(String(row.metadata)) : {}; } catch (_) {}

    const data = decodeStoredData(dataMap.get(String(row.record_id || '')));
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
      readAt: data.readAt || readAtByMessageId.get(String(data.messageId || row.record_id || '')) || null,
      ownerDid: String(row.owner_did || ''),
      sharedWithDids: Array.isArray(metadata.sharedWithDids) ? metadata.sharedWithDids : []
    };
  })
  .filter(message =>
    (!Number.isFinite(afterMs) || Date.parse(message.sentAt || '') >= afterMs) &&
    message.conversationId === conversationId &&
    (
      message.ownerDid === meDid
    ) &&
    (
      (message.senderDid === meDid && message.recipientDid === otherDid) ||
      (message.senderDid === otherDid && message.recipientDid === meDid)
    )
  );

  const byMessageId = new Map();
  for (const message of visible) {
    const key = message.messageId || message.id;
    const previous = byMessageId.get(key);
    if (!previous || message.ownerDid === meDid) byMessageId.set(key, message);
  }

  return [...byMessageId.values()]
    .map(({ownerDid, sharedWithDids, ...message}) => message)
    .sort((a, b) => {
      const aTime = Date.parse(a.sentAt || '') || 0;
      const bTime = Date.parse(b.sentAt || '') || 0;
      return aTime - bTime;
    })
    .slice(-MAX_HISTORY);
}

async function listConversations(meDid) {
  const currentDid = didOf(meDid);
  if (!currentDid) return [];

  const friendDids = await friendDidsFor(currentDid);

  const { data: rows, error } = await supabase
    .from('dwn_records')
    .select('record_id,owner_did,target_did,recipient,protocol,protocol_path,date_created,date_modified,metadata,deleted')
    .eq('deleted', false)
    .eq('protocol', CHAT_PROTOCOL)
    .eq('protocol_path', CHAT_PATH)
    .eq('owner_did', currentDid)
    .order('date_created', { ascending: false })
    .limit(CHAT_GLOBAL_RECORD_LIMIT);

  if (error) throw error;
  if (!Array.isArray(rows) || !rows.length) return [];

  const ids = rows.map(row => String(row.record_id || '')).filter(Boolean);
  const { data: payloads, error: dataError } = await supabase
    .from('dwn_record_data')
    .select('record_id,data')
    .in('record_id', ids);

  if (dataError) throw dataError;

  const dataMap = new Map(
    (payloads || []).map(row => [String(row.record_id || ''), decodeStoredData(row.data)])
  );

  const uniqueMessages = new Map();

  for (const row of rows) {
    const recordId = String(row.record_id || '');
    const data = dataMap.get(recordId);
    if (!data || typeof data !== 'object' || data.kind !== 'chat_message') continue;

    const ownerDid = didOf(row.owner_did);
    if (ownerDid !== currentDid) continue;

    const senderDid = didOf(data.senderDid || row.owner_did);
    const recipientDid = didOf(data.recipientDid || row.recipient);
    if (!senderDid || !recipientDid || (senderDid !== currentDid && recipientDid !== currentDid)) continue;

    const otherDid = senderDid === currentDid ? recipientDid : senderDid;
    if (!otherDid || otherDid === currentDid) continue;
    if (!friendDids.has(otherDid)) continue;

    const conversationId = String(data.conversationId || conversationIdFor(currentDid, otherDid));
    const messageId = String(data.messageId || recordId);
    const candidate = {
      recordId,
      messageId,
      ownerDid,
      conversationId,
      otherDid,
      senderDid,
      text: String(data.text || '').slice(0, 160),
      sentAt: data.sentAt || row.date_created || row.date_modified || '',
    };

    // A client message ID is unique within a conversation, not globally.
    const uniqueKey = candidate.conversationId + '|' + messageId;
    const previous = uniqueMessages.get(uniqueKey);
    if (!previous || candidate.ownerDid === currentDid) {
      uniqueMessages.set(uniqueKey, candidate);
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
      messageCount: 0,
      historyMessages: []
    };
    item.messageCount += 1;
    item.historyMessages.push({
      messageId: message.messageId,
      senderDid: message.senderDid,
      sentAt: message.sentAt
    });

    const candidateTime = Date.parse(message.sentAt || '') || 0;
    const currentTime = Date.parse(item.lastMessageAt || '') || 0;
    if (candidateTime >= currentTime) {
      item.lastMessage = message.text;
      item.lastMessageAt = message.sentAt;
      item.lastMessageId = message.messageId;
      item.lastSenderDid = message.senderDid;
    }
    byConversation.set(message.conversationId, item);
  }

  // Keep unread IDs aligned with the same latest-history window shown by
  // conversationMessages and accepted by the read-receipt endpoint.
  for (const item of byConversation.values()) {
    const visibleHistory = item.historyMessages
      .sort((a, b) =>
        (Date.parse(a.sentAt || '') || 0) -
        (Date.parse(b.sentAt || '') || 0)
      )
      .slice(-MAX_HISTORY);

    item.incomingMessageIds = visibleHistory
      .filter(message => message.senderDid === item.otherDid)
      .map(message => ({ messageId: message.messageId }));

    delete item.historyMessages;
  }

  const conversationRows = [...byConversation.values()]
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
    .slice(0, 100);

  if (!conversationRows.length) return [];

  // Count unread incoming messages in each conversation's latest visible
  // history window, using deterministic reader-owned receipt IDs. The
  // overall candidates are still bounded by CHAT_GLOBAL_RECORD_LIMIT.
  const incomingMessages = conversationRows.flatMap(row =>
    row.incomingMessageIds.map(item => ({
      conversationId: row.conversationId,
      messageId: item.messageId,
      receiptId: receiptRecordId(
        row.conversationId, item.messageId, currentDid, currentDid
      )
    }))
  );

  const existingReadReceiptIds = new Set();
  const expectedReceiptById = new Map(
    incomingMessages.map(item => [item.receiptId, item])
  );
  const expectedReceiptIds = [...expectedReceiptById.keys()];

  if (expectedReceiptIds.length) {
    const RECEIPT_LOOKUP_BATCH_SIZE = 200;
    const MAX_PARALLEL_RECEIPT_LOOKUPS = 4;
    const receiptIdBatches = [];

    for (
      let offset = 0;
      offset < expectedReceiptIds.length;
      offset += RECEIPT_LOOKUP_BATCH_SIZE
    ) {
      receiptIdBatches.push(
        expectedReceiptIds.slice(offset, offset + RECEIPT_LOOKUP_BATCH_SIZE)
      );
    }

    // Bound URL/query size and database concurrency for large inboxes.
    for (
      let batchOffset = 0;
      batchOffset < receiptIdBatches.length;
      batchOffset += MAX_PARALLEL_RECEIPT_LOOKUPS
    ) {
      const batchResults = await Promise.all(
        receiptIdBatches
          .slice(batchOffset, batchOffset + MAX_PARALLEL_RECEIPT_LOOKUPS)
          .map(async receiptBatch => {
            const { data: receiptRows, error: receiptError } = await supabase
              .from('dwn_records')
              .select('record_id')
              .eq('deleted', false)
              .eq('protocol', CHAT_PROTOCOL)
              .eq('protocol_path', CHAT_RECEIPT_PATH)
              .eq('owner_did', currentDid)
              .in('record_id', receiptBatch);

            if (receiptError) throw receiptError;

            const receiptRecordIds = (receiptRows || [])
              .map(row => String(row.record_id || ''))
              .filter(Boolean);

            if (!receiptRecordIds.length) return [];

            const { data: receiptPayloads, error: payloadError } = await supabase
              .from('dwn_record_data')
              .select('record_id,data')
              .in('record_id', receiptRecordIds);

            if (payloadError) throw payloadError;

            // A row alone is not proof of a successful read receipt.
            // Validate the linked payload against the expected message.
            return (receiptPayloads || []).filter(row => {
              const recordId = String(row.record_id || '');
              const expected = expectedReceiptById.get(recordId);
              const payload = decodeStoredData(row.data);

              return !!expected &&
                payload?.kind === 'chat_receipt' &&
                payload?.state === 'read' &&
                String(payload.messageId || '') === expected.messageId &&
                String(payload.conversationId || '') === expected.conversationId &&
                String(payload.readerDid || '') === currentDid;
            }).map(row => String(row.record_id || ''));
          })
      );

      for (const readReceiptRows of batchResults) {
        for (const row of readReceiptRows) {
          existingReadReceiptIds.add(String(row.record_id || ''));
        }
      }
    }
  }

  const unreadCountByConversation = new Map();
  for (const message of incomingMessages) {
    if (existingReadReceiptIds.has(message.receiptId)) continue;
    unreadCountByConversation.set(
      message.conversationId,
      (unreadCountByConversation.get(message.conversationId) || 0) + 1
    );
  }

  const dids = [...new Set(conversationRows.map(row => row.otherDid))];
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id,email,name,did')
    .in('did', dids);

  if (usersError) throw usersError;

  const profiles = new Map(
    (users || []).map(user => [
      String(user.did),
      {
        id: user.id,
        name: user.name || user.email?.split('@')[0] || 'MILAN User',
        did: String(user.did)
      }
    ])
  );

  return conversationRows
    .map(row => ({
      conversationId: row.conversationId,
      person: profiles.get(row.otherDid) || { name: 'MILAN User', did: row.otherDid },
      lastMessage: row.lastMessage,
      lastMessageAt: row.lastMessageAt,
      lastMessageId: row.lastMessageId,
      lastSenderDid: row.lastSenderDid,
      messageCount: row.messageCount,
      unreadCount: unreadCountByConversation.get(row.conversationId) || 0
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

    const { data: accounts, error } = await supabase
      .from('users')
      .select('id,email,name,did')
      .in('did', [...friendDids]);

    if (error) throw error;

    const rows = (accounts || [])
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
    persistence: 'Supabase-authoritative isolated DWN spaces',
    audience: 'Approved MILAN friends only',
    realtime: 'SSE accelerator; cross-instance Supabase sync fallback'
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
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      conversationId: conversationIdFor(meDid, otherDid),
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
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      conversationId: conversationIdFor(meDid, otherDid),
      messages
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
      // The only records read here are the deterministic private mailbox
      // records for these two DIDs. A retry never scans an arbitrary history,
      // so it stays correct even after a busy conversation exceeds its window.
      const senderCandidate = await chatMailboxRecord(meDid, conversationId, messageId, 'sender');
      const recipientCandidate = await chatMailboxRecord(otherDid, conversationId, messageId, 'recipient');

      const matchesRequestedMessage = record => {
        const data = record?.data;
        return !!data &&
          String(data.conversationId || '') === conversationId &&
          String(data.messageId || '') === messageId &&
          String(data.senderDid || '') === meDid &&
          String(data.recipientDid || '') === otherDid;
      };

      // The legacy v1 key could collide with the opposite direction of the
      // same conversation. Never reuse a legacy row with a different payload.
      let senderExisting = senderCandidate;
      let recipientExisting = recipientCandidate;

      if (senderExisting?.legacy && !matchesRequestedMessage(senderExisting)) {
        senderExisting = null;
      }
      if (recipientExisting?.legacy && !matchesRequestedMessage(recipientExisting)) {
        recipientExisting = null;
      }

      // A v2 ID is owner-scoped. If its payload does not match, fail closed
      // instead of silently using a record bound to another message identity.
      if (
        (senderExisting && !matchesRequestedMessage(senderExisting)) ||
        (recipientExisting && !matchesRequestedMessage(recipientExisting))
      ) {
        const conflict = new Error('Message ID is already bound to a different chat message');
        conflict.status = 409;
        throw conflict;
      }

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
      if (!recipientExisting || recipientExisting.legacy) {
        await createChatMailboxRecord(recipient.id, otherDid, {
          ...messageData,
          mailboxRole: 'recipient'
        });
      }

      // Migrate legacy retries to owner-scoped v2 IDs, preserving the
      // first payload and timestamp used to make the client ID idempotent.
      const senderRecord = !senderExisting || senderExisting.legacy
        ? await createChatMailboxRecord(req.userId, meDid, {
            ...messageData,
            mailboxRole: 'sender'
          })
        : senderExisting;

      const message = toMessage(senderRecord);
      const duplicate = !!senderExisting &&
        !!recipientExisting &&
        !senderExisting.legacy &&
        !recipientExisting.legacy;

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

module.exports = router;
