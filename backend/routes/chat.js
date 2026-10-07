'use strict';

const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const dwnStore = require('../services/dwnService');
const { createClient } = require('@supabase/supabase-js');
const livePush = require('../services/livePush');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CHAT_SCHEMA = 'milan.chat.message';
const CHAT_PROTOCOL = 'milan.chat';
const CHAT_PATH = 'messages';
const MAX_MESSAGE_CHARS = 5000;
const MAX_HISTORY = 200;

const didOf = value => String(value || '').trim();

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
    dateModified: record?.dateModified || record?.dateCreated || null
  };
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

  const { data: rows, error } = await supabase
    .from('dwn_records')
    .select('record_id,owner_did,recipient,protocol,protocol_path,date_created,date_modified,metadata,deleted')
    .eq('deleted', false)
    .eq('protocol', CHAT_PROTOCOL)
    .eq('protocol_path', CHAT_PATH)
    .in('owner_did', [meDid, otherDid])
    .order('date_created', { ascending: true })
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

  return rows.map(row => {
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
      sharedWithDids: Array.isArray(metadata.sharedWithDids) ? metadata.sharedWithDids : []
    };
  })
  .filter(message =>
    (!Number.isFinite(afterMs) || Date.parse(message.sentAt || '') > afterMs) &&
    message.conversationId === conversationId &&
    (message.senderDid === meDid || message.sharedWithDids.includes(meDid)) &&
    (
      (message.senderDid === meDid && message.recipientDid === otherDid) ||
      (message.senderDid === otherDid && message.recipientDid === meDid)
    )
  )
  .map(({sharedWithDids, ...message}) => message)
  .slice(-MAX_HISTORY);
}

async function listConversations(meDid) {
  const currentDid = didOf(meDid);
  if (!currentDid) return [];

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

  const byConversation = new Map();
  for (const row of rows) {
    const recordId = String(row.record_id || '');
    const data = dataMap.get(recordId);
    if (!data || typeof data !== 'object' || data.kind !== 'chat_message') continue;

    const senderDid = didOf(data.senderDid || row.owner_did);
    const recipientDid = didOf(data.recipientDid || row.recipient);
    if (!senderDid || !recipientDid || (senderDid !== currentDid && recipientDid !== currentDid)) continue;

    const otherDid = senderDid === currentDid ? recipientDid : senderDid;
    if (!otherDid || otherDid === currentDid) continue;

    const conversationId = String(data.conversationId || conversationIdFor(currentDid, otherDid));
    if (!byConversation.has(conversationId)) {
      byConversation.set(conversationId, {
        conversationId,
        otherDid,
        lastMessage: String(data.text || '').slice(0, 160),
        lastMessageAt: data.sentAt || row.date_created || row.date_modified || '',
        lastMessageId: String(data.messageId || recordId),
        lastSenderDid: senderDid,
        messageCount: 0
      });
    }

    const item = byConversation.get(conversationId);
    item.messageCount += 1;

    const candidateTime = Date.parse(data.sentAt || row.date_created || '');
    const currentTime = Date.parse(item.lastMessageAt || '');
    if (Number.isFinite(candidateTime) && (!Number.isFinite(currentTime) || candidateTime > currentTime)) {
      item.lastMessage = String(data.text || '').slice(0, 160);
      item.lastMessageAt = data.sentAt || row.date_created || row.date_modified || '';
      item.lastMessageId = String(data.messageId || recordId);
      item.lastSenderDid = senderDid;
    }
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

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    chat: 'ready',
    transport: 'DWN shared record',
    persistence: 'Supabase authoritative DWN',
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

    const record = await dwnStore.createRecord(req.userId, meDid, {
      schema: CHAT_SCHEMA,
      title: 'MILAN Chat Message',
      dataFormat: 'application/json',
      protocol: CHAT_PROTOCOL,
      protocolPath: CHAT_PATH,
      accessMode: 'shared_did',
      sharedWithDids: [otherDid],
      awaitCloudSync: true,
      data: {
        kind: 'chat_message',
        messageId,
        conversationId,
        senderDid: meDid,
        recipientDid: otherDid,
        text,
        sentAt: now
      }
    });

    const message = toMessage(record);

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
