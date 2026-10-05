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

async function conversationMessages(meDid, otherDid) {
  const id = conversationIdFor(meDid, otherDid);
  const records = await dwnStore.listVisibleRecords(meDid, { limit: 0 });

  return records
    .filter(record =>
      record.schema === CHAT_SCHEMA &&
      record.protocol === CHAT_PROTOCOL &&
      record.protocolPath === CHAT_PATH &&
      String(record.data?.kind || '') === 'chat_message' &&
      String(record.data?.conversationId || '') === id
    )
    .map(toMessage)
    .filter(message =>
      (message.senderDid === meDid || message.recipientDid === meDid) &&
      (message.senderDid === otherDid || message.recipientDid === otherDid)
    )
    .sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt))
    .slice(-MAX_HISTORY);
}

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    chat: 'ready',
    transport: 'DWN shared record',
    persistence: 'Supabase authoritative DWN',
    realtime: 'SSE when co-located; 2s client fallback'
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
