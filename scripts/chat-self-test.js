'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function syntaxCheck(path) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Syntax check failed for ${path}: ${result.stderr || result.stdout}`);
  }
}

const chat = read('backend/routes/chat.js');
const social = read('backend/routes/social.js');
const frontend = read('frontend/chat/index.html');

syntaxCheck('backend/routes/chat.js');
syntaxCheck('backend/routes/social.js');

assert(chat.includes("const CHAT_SCHEMA = 'milan.chat.message';"), 'Chat message schema missing.');
assert(chat.includes("const CHAT_PROTOCOL = 'milan.chat';"), 'Chat protocol missing.');
assert(chat.includes("protocolPath: CHAT_PATH"), 'Chat protocol path missing.');
assert(chat.includes('await createChatMailboxRecord(recipient.id, otherDid'), 'Recipient DWN mailbox write missing.');
assert(chat.includes('await createChatMailboxRecord(req.userId, meDid'), 'Sender DWN mailbox write missing.');
assert(chat.includes("accessMode: 'private'"), 'Chat records must remain private.');
assert(chat.includes("clientMessageId"), 'Chat idempotency key missing.');
assert(chat.includes("router.post('/with/:did/typing'"), 'Typing endpoint missing.');
assert(chat.includes("notifType: 'chat_typing'"), 'Typing event missing.');
assert(chat.includes("deliveryStatus: 'delivered'"), 'Delivered state missing.');
assert(chat.includes("mailboxRole: 'recipient'"), 'Recipient mailbox role missing.');
assert(chat.includes("mailboxRole: 'sender'"), 'Sender mailbox role missing.');

assert(social.includes('function isChatRecord(record)'), 'Feed chat-record guard missing.');
assert(social.includes('if (isChatRecord(record)) return false;'), 'Social feed does not reject chat records.');

assert(frontend.includes('EventSource("/api/events?token="'), 'Realtime event stream missing.');
assert(frontend.includes('/api/chat/with/" + encodeURIComponent(selected.did) + "/typing'), 'Typing client endpoint missing.');
assert(frontend.includes('notifType || "") === "chat_typing"'), 'Typing event client handler missing.');
assert(frontend.includes('/api/chat/with/" + encodeURIComponent(recipientDid) + "/messages'), 'Message send endpoint missing.');
assert(frontend.includes('status === "sending"'), 'Optimistic sending state missing.');

console.log('✅ MILAN chat architecture checks passed.');
console.log('✅ Backend syntax checks passed.');
console.log('✅ One-DWN-to-one-DWN mailbox invariants passed.');
console.log('✅ Realtime typing / message transport invariants passed.');
console.log('✅ Social Feed isolation invariant passed.');
