'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const { assertCloudSyncSucceeded } = require('../backend/services/dwnSyncGuard');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function syntaxCheckSource(source, label) {
  const result = spawnSync(process.execPath, ['--check', '-'], { input: source, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error('Syntax check failed for ' + label + ': ' + (result.stderr || result.stdout));
  }
}

function syntaxCheckInlineScripts(html, label) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let count = 0;
  while ((match = re.exec(html))) {
    const attrs = match[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;
    const typeMatch = attrs.match(/\btype\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const scriptType = String(typeMatch?.[1] || typeMatch?.[2] || typeMatch?.[3] || '').toLowerCase();
    if (scriptType && !['text/javascript', 'application/javascript', 'module'].includes(scriptType)) continue;
    const source = match[2] || '';
    if (!source.trim()) continue;
    syntaxCheckSource(source, label + ' inline script ' + (count + 1));
    count += 1;
  }
  if (!count) throw new Error('No executable inline scripts found in ' + label);
  console.log('PASS: parsed ' + count + ' inline JavaScript blocks in ' + label);
}

function syntaxCheck(path) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Syntax check failed for ${path}: ${result.stderr || result.stdout}`);
  }
}

const chat = read('backend/routes/chat.js');
const social = read('backend/routes/social.js');
const appShell = read('frontend/app.html');
const frontend = read('frontend/chat/index.html');
const homeShell = read('frontend/assets/js/inline-05.js');
const uiActions = read('frontend/assets/js/milan-ui-actions.js');
const dwnService = read('backend/services/dwnService.js');

syntaxCheck('backend/routes/chat.js');
syntaxCheck('backend/routes/social.js');
syntaxCheck('backend/routes/records.js');
syntaxCheck('backend/services/dwnService.js');
syntaxCheck('backend/services/dwnSyncGuard.js');
syntaxCheck('frontend/assets/js/inline-05.js');
syntaxCheck('frontend/assets/js/milan-ui-actions.js');
syntaxCheckInlineScripts(frontend, 'frontend/chat/index.html');

assert(chat.includes("const CHAT_SCHEMA = 'milan.chat.message';"), 'Chat message schema missing.');
assert(chat.includes("const CHAT_PROTOCOL = 'milan.chat';"), 'Chat protocol missing.');
assert(chat.includes("protocolPath: CHAT_PATH"), 'Chat protocol path missing.');
assert(chat.includes('await createChatMailboxRecord(recipient.id, otherDid'), 'Recipient DWN mailbox write missing.');
assert(chat.includes('await createChatMailboxRecord(req.userId, meDid'), 'Sender DWN mailbox write missing.');
assert(chat.includes("accessMode: 'private'"), 'Chat records must remain private.');
assert(chat.includes("clientMessageId"), 'Chat idempotency key missing.');
assert(chat.includes("router.post('/with/:did/typing'"), 'Typing endpoint missing.');
assert(chat.includes("notifType: 'chat_typing'"), 'Typing event missing.');
assert(chat.includes("router.post('/with/:did/read'"), 'Read receipt endpoint missing.');
assert(chat.includes("CHAT_RECEIPT_SCHEMA = 'milan.chat.receipt'"), 'Read receipt schema missing.');
assert(chat.includes("CHAT_RECEIPT_PATH = 'receipts'"), 'Read receipt path missing.');
assert(chat.includes("notifType: 'chat_read'"), 'Read receipt event missing.');
assert(chat.includes("deliveryStatus: 'delivered'"), 'Delivered state missing.');
assert(chat.includes('message: realtimeMessage'), 'Realtime message payload missing.');
assert(chat.includes("mailboxRole: 'recipient'"), 'Recipient mailbox role missing.');
assert(chat.includes("mailboxRole: 'sender'"), 'Sender mailbox role missing.');
assert(chat.includes('function decodeStoredData(value)'), 'Stored mailbox decoder must be synchronous.');
assert(!chat.includes('async function decodeStoredData'), 'Stored mailbox decoder cannot return an unchecked Promise.');
assert(chat.includes('withChatWriteLock'), 'Concurrent message/receipt write guard missing.');
  const conversationMessagesStart = chat.indexOf('async function conversationMessages(');
  const listConversationsStart = chat.indexOf('async function listConversations(');
  const peopleRouteStart = chat.indexOf("router.get('/people', auth");
  assert(conversationMessagesStart >= 0 &&
         listConversationsStart > conversationMessagesStart &&
         peopleRouteStart > listConversationsStart,
    'Voroa conversation reader functions are missing.');

  const callerMailboxSql = source =>
    source.includes("component_type = 'record'") &&
    source.includes('AND did = $1') &&
    source.includes('AND space_id = (SELECT space_id FROM public.users WHERE did = $1 LIMIT 1)');

  assert(callerMailboxSql(chat.slice(conversationMessagesStart, listConversationsStart)),
    'Conversation reads must be limited to the caller-owned Voroa mailbox and tenant space.');
  assert(callerMailboxSql(chat.slice(listConversationsStart, peopleRouteStart)),
    'Conversation list must be limited to the caller-owned Voroa mailbox and tenant space.');

assert(chat.includes('livePush.push(req.userId'), 'Sender other-device push missing.');

assert(social.includes('function isChatRecord(record)'), 'Feed chat-record guard missing.');
assert(social.includes('if (isChatRecord(record)) return false;'), 'Social feed does not reject chat records.');
assert(uiActions.includes('"/api/social/feed?scope=all"'), 'Home-feed refresh must use the chat-filtered social feed endpoint.');

const commentsGetStart = social.indexOf("router.get('/records/:id/comments'");
const commentsPostStart = social.indexOf("router.post('/records/:id/comments'");
const reactionsPostStart = social.indexOf("router.post('/records/:id/reactions'");
const savedRouteStart = social.indexOf("router.get('/saved'");
assert(commentsGetStart >= 0 && commentsPostStart > commentsGetStart, 'Comment routes missing.');
assert(reactionsPostStart > commentsPostStart && savedRouteStart > reactionsPostStart, 'Reaction route missing.');
assert(social.slice(commentsGetStart, commentsPostStart).includes('isChatRecord(record)'), 'Chat messages must not expose social comments.');
assert(social.slice(commentsPostStart, reactionsPostStart).includes('isChatRecord(record)'), 'Chat messages must not accept social comments.');
assert(social.slice(reactionsPostStart, savedRouteStart).includes('isChatRecord(record)'), 'Chat messages must not accept social reactions.');
const saveRouteStart = social.indexOf("router.post('/records/:id/save'");
assert(savedRouteStart >= 0 && saveRouteStart > savedRouteStart, 'Saved-post routes missing.');
const savedRoute = social.slice(savedRouteStart, saveRouteStart);
assert(savedRoute.includes('!isChatRecord(r)'), 'Saved posts must exclude chat records.');
const nextRouteStart = social.indexOf('\nrouter.', saveRouteStart + 1);
const saveRoute = social.slice(saveRouteStart, nextRouteStart < 0 ? social.length : nextRouteStart);
assert(saveRoute.includes('if (isChatRecord(record))'), 'Chat messages must not be saveable as social posts.');
assert(dwnService.includes('assertCloudSyncSucceeded(existingForRequestedId)'), 'Existing-record retries must confirm cloud sync.');
assert(dwnService.includes('assertCloudSyncSucceeded(record)'), 'New records must confirm cloud sync.');

const syncedRecord = { cloudDwn: { sync: { pushed: true } } };
assert(assertCloudSyncSucceeded(syncedRecord) === syncedRecord, 'Confirmed cloud sync should succeed.');
let failedWrite = null;
try { assertCloudSyncSucceeded({ cloudDwn: { sync: { pushed: false, error: 'Remote write failed' } } }); }
catch (err) { failedWrite = err; }
assert(failedWrite && failedWrite.status === 502 && failedWrite.message === 'Remote write failed', 'Failed cloud writes must return an error.');
let unknownWrite = null;
try { assertCloudSyncSucceeded({}); } catch (err) { unknownWrite = err; }
assert(unknownWrite && unknownWrite.status === 502, 'Unconfirmed cloud writes must not be treated as success.');

assert(frontend.includes('EventSource("/api/events?token="'), 'Realtime event stream missing.');
assert(frontend.includes('/api/chat/with/" + encodeURIComponent(selected.did) + "/typing'), 'Typing client endpoint missing.');
assert(frontend.includes('notifType || "") === "chat_typing"'), 'Typing event client handler missing.');
assert(frontend.includes('/api/chat/with/" + encodeURIComponent(recipientDid) + "/messages'), 'Message send endpoint missing.');
assert(frontend.includes('status === "sending"'), 'Optimistic sending state missing.');
assert(frontend.includes('mergeMessages([incoming])'), 'Instant inbound message render missing.');
assert(frontend.includes('CHAT_ACTIVE_KEY = "milan_chat_active_did"'), 'Active conversation persistence missing.');
assert(frontend.includes('CHAT_CACHE_PREFIX = "milan_chat_cache:"'), 'Warm chat history cache missing.');
assert(frontend.includes('localStorage.setItem(key'), 'Chat history cache write missing.');
assert(frontend.includes('function readChatCache(did)'), 'Chat history cache restore missing.');
assert(chat.includes('CHAT_QUERY_RECORD_LIMIT = MAX_HISTORY * 2'), 'Mailbox pair query window missing.');
assert(frontend.includes('scopedChatStorageKey'), 'Per-account browser storage isolation missing.');
assert(frontend.includes('Chat request timed out. It will retry safely.'), 'Chat request timeout handling missing.');
assert(frontend.includes('message.readAt || ""'), 'Read-state update rendering guard missing.');
assert(frontend.includes('incoming.senderDid || "") === String(myDid || "")'), 'Sender other-device realtime handler missing.');
assert(frontend.includes('retryOutboxMessage(retry.dataset.retryId)'), 'Failed-message retry action is not wired.');
assert(homeShell.includes('currentFeed=bc.feed.filter(r=>!isChatFeedRecord(r))'), 'Boot cache must filter chat records.');
assert(homeShell.includes('const safe=(Array.isArray(fresh)?fresh:[]).filter(r=>!isChatFeedRecord(r))'), 'Boot feed updates must filter chat records.');
assert(uiActions.includes('if (isChatFeedRecord(record)) continue;'), 'Home feed merges must filter chat records.');
assert(uiActions.includes('records = (Array.isArray(records) ? records : []).filter(record => !isChatFeedRecord(record));'), 'Final feed rendering must filter chat records.');
assert(/milan-ui-actions\.js\?v=[^\"'\s]+/.test(appShell), 'App shell must reference a cache-busted UI action script.');

assert(chat.includes("const CHAT_DELETE_SCHEMA = 'milan.chat.deletion';"), 'Private chat deletion marker schema missing.');
assert(chat.includes("router.delete('/with/:did/messages/:messageId', auth"), 'Authenticated chat message deletion endpoint missing.');
assert(chat.includes("if (senderDid !== meDid)"), 'Delete-for-everyone must be sender-only.');
assert(chat.includes("mailboxRole: 'tombstone-sender'"), 'Global delete must write a sender-side placeholder.');
assert(chat.includes("mailboxRole: 'tombstone-recipient'"), 'Global delete must write a recipient-side placeholder.');
assert(chat.includes('conversationHiddenMessageIds'), 'Delete-for-me markers must be synchronized across devices.');
assert(frontend.includes('data-message-options'), 'Accessible message action trigger missing.');
assert(frontend.includes('CHAT_MESSAGE_LONG_PRESS_MS'), 'Touch long-press handler missing.');
assert(frontend.includes('pointerdown'), 'Touch pointer event support missing.');
assert(frontend.includes('chat_message_deleted'), 'Realtime deletion event handler missing.');
assert(frontend.includes('data-chat-delete-confirm'), 'Styled delete confirmation dialog missing.');
console.log('✅ Message delete permissions and dual-mailbox tombstones verified.');
console.log('✅ Long-press, context-menu, cache-sync and confirmation UI checks passed.');
console.log('✅ MILAN chat architecture checks passed.');
console.log('✅ Backend syntax checks passed.');
console.log('✅ One-DWN-to-one-DWN mailbox invariants passed.');
console.log('✅ Realtime typing / message transport invariants passed.');
console.log('✅ Social Feed isolation invariant passed.');
console.log('✅ Saved-post chat isolation invariant passed.');
console.log('✅ Synchronous cloud-sync failure handling invariant passed.');
console.log('✅ Cached and merged feed chat-isolation invariants passed.');
