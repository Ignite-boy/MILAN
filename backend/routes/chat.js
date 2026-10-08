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

async function createChatMailboxRecord(userId, ownerDid, data) {
  return dwnStore.createRecord(userId, ownerDid, chatMessageRecordOptions(data));
}

async function recipientMailboxHasMessage(recipientDid, messageId) {
  const did = didOf(recipientDid);
  const key = didOf(messageId);
  if (!did || !key) return false;

  const { data: rows, error } = await supabase
    .from('dwn_records')
    .select('record_id')
    .eq('deleted', false)
    .eq('protocol', CHAT_PROTOCOL)
    .eq('protocol_path', CHAT_PATH)
    .eq('owner_did', did)
    .order('date_created', { ascending: false })
    .limit(MAX_HISTORY * 4);

  if (error) throw error;
  const ids = (rows || []).map(row => String(row.record_id || '')).filter(Boolean);
  if (!ids.length) return false;

  const { data: payloads, error: dataError } = await supabase
    .from('dwn_record_data')
    .select('record_id,data')
    .in('record_id', ids);

  if (dataError) throw dataError;

  return (payloads || []).some(row => {
    const data = decodeStoredData(row.data);
    return data && typeof data === 'object' &&
      data.kind === 'chat_message' &&
      String(data.messageId || '') === key;
  });
}

async function recipientMailboxHasReceipt(ownerDid, messageId, readerDid) {
  const owner = didOf(ownerDid);
  const key = didOf(messageId);
  const reader = didOf(readerDid);
  if (!owner || !key || !reader) return false;

  const { data: rows, error } = await supabase
    .from('dwn_records')
    .select('record_id')
    .eq('deleted', false)
    .eq('protocol', CHAT_PROTOCOL)
    .eq('protocol_path', CHAT_RECEIPT_PATH)
    .eq('owner_did', owner)
    .order('date_created', { ascending: false })
    .limit(MAX_HISTORY * 4);

  if (error) throw error;

  const ids = (rows || [])
    .map(row => String(row.record_id || ''))
    .filter(Boolean);

  if (!ids.length) return false;

  const { data: payloads, error: dataError } = await supabase
    .from('dwn_record_data')
    .select('record_id,data')
    .in('record_id', ids);

  if (dataError) throw dataError;

  return (payloads || []).some(row => {
    const data = decodeStoredData(row.data);
    return data &&
      typeof data === 'object' &&
      data.kind === 'chat_receipt' &&
      data.state === 'read' &&
      String(data.messageId || '') === key &&
      String(data.readerDid || '') === reader;
  });
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

async function createChatReceiptRecord(userId, ownerDid, data) {
  return dwnStore.createRecord(userId, ownerDid, chatReceiptRecordOptions(data));
}

async function decodeStoredData(value) {
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
    .in('owner_did', [meDid, otherDid]);

  if (Number.isFinite(afterMs)) {
    recordsQuery = recordsQuery.gte('date_created', new Date(afterMs).toISOString());
  }

  const { data: rows, error } = await recordsQuery
    .order('date_created', { ascending: false })
    .limit(MAX_HISTORY);

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
    .in('owner_did', [meDid, otherDid])
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
    (!Number.isFinite(afterMs) || Date.parse(message.sentAt || '') > afterMs) &&
    message.conversationId === conversationId &&
    (
      message.ownerDid === meDid ||
      (message.senderDid === otherDid && message.sharedWithDids.includes(meDid))
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
    .order('date_created', { ascending: false })
    .limit(MAX_HISTORY * 8);

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

    let metadata = {};
    try { metadata = row.metadata ? JSON.parse(String(row.metadata)) : {}; } catch (_) {}

    const ownerDid = didOf(row.owner_did);
    const sharedWithDids = Array.isArray(metadata.sharedWithDids) ? metadata.sharedWithDids : [];
    if (ownerDid !== currentDid && !sharedWithDids.includes(currentDid)) continue;

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

    const previous = uniqueMessages.get(messageId);
    if (!previous || candidate.ownerDid === currentDid) {
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

  const conversationRows = [...byConversation.values()]
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
    .slice(0, 100);

  if (!conversationRows.length) return [];

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

    const readAt = new Date().toISOString();
    let created = 0;

    for (const message of incoming) {
      const receiptData = {
        kind: 'chat_receipt',
        state: 'read',
        messageId: String(message.messageId),
        conversationId: conversationIdFor(meDid, otherDid),
        senderDid: otherDid,
        readerDid: meDid,
        readAt
      };

      if (!(await recipientMailboxHasReceipt(meDid, message.messageId, meDid))) {
        await createChatReceiptRecord(req.userId, meDid, {
          ...receiptData,
          mailboxRole: 'reader'
        });
        created += 1;
      }

      if (!(await recipientMailboxHasReceipt(otherDid, message.messageId, meDid))) {
        await createChatReceiptRecord(other.id, otherDid, {
          ...receiptData,
          mailboxRole: 'sender'
        });
      }

      livePush.push(other.id, 'notify', {
        notifType: 'chat_read',
        conversationId: conversationIdFor(meDid, otherDid),
        readerDid: meDid,
        messageId: String(message.messageId),
        readAt
      });
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
  const clientMessageId = cleanText(req.body?.clientMessageId).slice(0, 120);

  if (!meDid) return res.status(401).json({ error: 'Authenticated DID unavailable' });
  if (!otherDid) return res.status(400).json({ error: 'Recipient DID required' });
  if (meDid === otherDid) return res.status(400).json({ error: 'Cannot message yourself' });
  if (!text) return res.status(400).json({ error: 'Message cannot be empty' });

  try {
    const recipient = await recipientByDid(otherDid);
    if (!recipient) return res.status(404).json({ error: 'Person not found' });

    const friendDids = await friendDidsFor(meDid);
    if (!friendDids.has(otherDid)) {
      return res.status(403).json({ error: 'You can only message connected friends' });
    }

    const now = new Date().toISOString();
    const messageId = clientMessageId || crypto.randomUUID();
    const conversationId = conversationIdFor(meDid, otherDid);

    if (clientMessageId) {
      const existing = (await conversationMessages(meDid, otherDid))
        .find(message => message.messageId === clientMessageId);
      if (existing) {
        return res.status(200).json({
          ok: true,
          duplicate: true,
          conversationId,
          message: existing,
          recipient: {
            id: recipient.id,
            name: recipient.name || recipient.email?.split('@')[0] || 'MILAN User',
            did: recipient.did
          }
        });
      }
    }

    const messageData = {
      kind: 'chat_message',
      messageId,
      conversationId,
      senderDid: meDid,
      recipientDid: otherDid,
      text,
      sentAt: now,
      deliveryStatus: 'delivered',
      deliveredAt: now
    };

    // One-to-one DWN mailbox model:
    // 1) the recipient-owned private mailbox receives the message;
    // 2) the sender-owned private mailbox keeps the sender's durable copy.
    // Both copies share one clientMessageId/messageId so retries are idempotent
    // and each client renders exactly one message.
    const recipientAlreadyHasMessage = await recipientMailboxHasMessage(otherDid, messageId);
    if (!recipientAlreadyHasMessage) {
      await createChatMailboxRecord(recipient.id, otherDid, {
        ...messageData,
        mailboxRole: 'recipient'
      });
    }

    const senderRecord = await createChatMailboxRecord(req.userId, meDid, {
      ...messageData,
      mailboxRole: 'sender'
    });

    const message = toMessage(senderRecord);

    try {
      livePush.push(recipient.id, 'notify', {
        notifType: 'chat_message',
        conversationId,
        senderDid: meDid,
        messageId
      });
    } catch (_) {}

    return res.status(201).json({
      ok: true,
      conversationId,
      message,
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
