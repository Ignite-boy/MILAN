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

assert(chat.includes("const CHAT_SCHEMA = 'milan.chat.message';"), 'Chat message schema missing.');
assert(chat.includes("const CHAT_PROTOCOL = 'milan.chat';"), 'Chat protocol missing.');
assert(chat.includes("protocolPath: CHAT_PATH"), 'Chat protocol path missing.');
assert(chat.includes('await createChatMailboxRecord(recipient.id, otherDid'), 'Recipient DWN mailbox write missing.');
assert(chat.includes('await createChatMailboxRecord(req.userId, meDid'), 'Sender DWN mailbox write missing.');
assert(chat.includes("accessMode: 'private'"), 'Chat records must remain private.');
assert(chat.includes("clientMessageId"), 'Chat idempotency key missing.');
assert(chat.includes("function legacyMailboxRecordId("), 'Legacy mailbox ID fallback missing.');
assert(chat.includes("'milan-chat-mailbox-v2'"), 'Owner-scoped v2 mailbox IDs missing.');
assert(chat.includes("const matchesRequestedMessage = record =>"), 'Mailbox payload identity guard missing.');
assert(chat.includes("senderExisting?.legacy && !matchesRequestedMessage(senderExisting)"), 'Mismatched legacy sender rows must not be reused.');
assert(chat.includes("recipientExisting?.legacy && !matchesRequestedMessage(recipientExisting)"), 'Mismatched legacy recipient rows must not be reused.');
assert(chat.includes("Message ID is already bound to a different chat message"), 'Mismatched v2 message identity must fail closed.');
assert(chat.includes("didOf(ownerDid),"), 'Mailbox ID must include normalized owner DID.');
assert(chat.includes("legacy: candidate.legacy"), 'Legacy mailbox lookup must be identifiable for migration.');
assert(chat.includes("if (!recipientExisting || recipientExisting.legacy)"), 'Legacy recipient mailbox migration missing.');
assert(/!senderExisting\.legacy\s*&&\s*!recipientExisting\.legacy/.test(chat), 'Only v2 mailbox pairs count as completed duplicates.');
assert(chat.includes("router.post('/with/:did/typing'"), 'Typing endpoint missing.');
assert(chat.includes("notifType: 'chat_typing'"), 'Typing event missing.');
assert(chat.includes("router.post('/with/:did/read'"), 'Read receipt endpoint missing.');
assert(chat.includes("CHAT_RECEIPT_SCHEMA = 'milan.chat.receipt'"), 'Read receipt schema missing.');
assert(chat.includes("CHAT_RECEIPT_PATH = 'receipts'"), 'Read receipt path missing.');
assert(chat.includes("payload.kind === 'chat_receipt'"), 'Existing receipt must validate its stored kind.');
assert(chat.includes("payload.state === 'read'"), 'Existing receipt must validate its stored read state.');
assert(chat.includes("String(payload.messageId || '') === key"), 'Existing receipt must validate its message ID.');
assert(chat.includes("String(payload.readerDid || '') === reader"), 'Existing receipt must validate its reader DID.');
assert(chat.includes("await dwnStore.updateRecord(userId, ownerDid, recordId, {\n    data\n  })"), 'Invalid deterministic receipts must use the supported update path before recreation.');
assert(chat.includes("notifType: 'chat_read'"), 'Read receipt event missing.');
assert(chat.includes("deliveryStatus: 'delivered'"), 'Delivered state missing.');
assert(chat.includes('message: realtimeMessage'), 'Realtime message payload missing.');
assert(chat.includes("mailboxRole: 'recipient'"), 'Recipient mailbox role missing.');
assert(chat.includes("mailboxRole: 'sender'"), 'Sender mailbox role missing.');
assert(chat.includes('function decodeStoredData(value)'), 'Stored mailbox decoder must be synchronous.');
assert(!chat.includes('async function decodeStoredData'), 'Stored mailbox decoder cannot return an unchecked Promise.');
assert(chat.includes('withChatWriteLock'), 'Concurrent message/receipt write guard missing.');
assert(chat.includes(".eq('owner_did', meDid)"), 'Conversation reads must be limited to the caller mailbox.');
assert(chat.includes(".eq('owner_did', currentDid)"), 'Conversation list must be limited to the caller mailbox.');
assert(chat.includes('livePush.push(req.userId'), 'Sender other-device push missing.');

assert(social.includes('function isChatRecord(record)'), 'Feed chat-record guard missing.');
assert(social.includes('if (isChatRecord(record)) return false;'), 'Social feed does not reject chat records.');

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
try { assertCloudSyncSucceeded({ cloudDwn: { sync: { pushed: false, error: 'Supabase write failed' } } }); }
catch (err) { failedWrite = err; }
assert(failedWrite && failedWrite.status === 502 && failedWrite.message === 'Supabase write failed', 'Failed cloud writes must return an error.');
let unknownWrite = null;
try { assertCloudSyncSucceeded({}); } catch (err) { unknownWrite = err; }
assert(unknownWrite && unknownWrite.status === 502, 'Unconfirmed cloud writes must not be treated as success.');

assert(frontend.includes('EventSource("/api/events?token="'), 'Realtime event stream missing.');
assert(frontend.includes('/api/chat/with/" + encodeURIComponent(selected.did) + "/typing'), 'Typing client endpoint missing.');
assert(frontend.includes('notifType || "") === "chat_typing"'), 'Typing event client handler missing.');
assert(frontend.includes('/api/chat/with/" + encodeURIComponent(recipientDid) + "/messages'), 'Message send endpoint missing.');
assert(frontend.includes('status === "sending"'), 'Optimistic sending state missing.');
assert(frontend.includes('maxlength="5000"'), 'Composer must enforce the backend message length limit.');
assert(frontend.includes('id="messageCharCount"'), 'Visible message length counter missing.');
assert(frontend.includes('function updateMessageCharCount()'), 'Message length counter update function missing.');
assert(frontend.includes('updateMessageCharCount();'), 'Message length counter must update/reset.');
assert(frontend.includes('mergeMessages([incoming])'), 'Instant inbound message render missing.');
assert(frontend.includes('CHAT_ACTIVE_KEY = "milan_chat_active_did"'), 'Active conversation persistence missing.');
assert(frontend.includes('CHAT_CACHE_PREFIX = "milan_chat_cache:"'), 'Warm chat history cache missing.');
assert(frontend.includes('localStorage.setItem(key'), 'Chat history cache write missing.');
assert(frontend.includes('function readChatCache(did)'), 'Chat history cache restore missing.');
assert(frontend.includes('let conversationSelectionVersion = 0;'), 'Conversation selection generation guard missing.');
assert(frontend.includes('const loadingConversationRequests = new Set();'), 'Per-selection loading guard missing.');
assert(frontend.includes('const sendingRecipients = new Set();'), 'Per-recipient send locks missing.');
assert(frontend.includes('sendingRecipients.has(recipientDid)'), 'Same-recipient concurrent send guard missing.');
assert(frontend.includes('sendingRecipients.delete(recipientDid)'), 'Per-recipient send lock release missing.');
assert(frontend.includes('sendingRecipients.has(String(selected?.did || ""))'), 'Composer must use the selected recipient send lock.');
assert(frontend.includes('if (selected?.did === recipientDid) showChatError(err);'), 'Send errors must not leak into another conversation UI.');
assert(frontend.includes('function messageBelongsToConversation(message, did)'), 'Conversation participant guard missing.');
assert(frontend.includes('cached.messages.filter(message => messageBelongsToConversation(message, did))'), 'Cached messages must match the selected conversation.');
assert(frontend.includes('selectionVersion !== conversationSelectionVersion'), 'Stale conversation responses must be ignored.');
assert(frontend.includes('selectionVersion === conversationSelectionVersion'), 'Outbox retry mutations must be selection-scoped.');
assert(frontend.includes('loadingConversationRequests.has(requestKey)'), 'Duplicate loads for one selection must be prevented.');
assert(chat.includes('CHAT_QUERY_RECORD_LIMIT = MAX_HISTORY * 2'), 'Mailbox pair query window missing.');
assert(chat.includes("const uniqueKey = candidate.conversationId + '|' + messageId;"), 'Conversation list deduplication must be conversation-scoped.');
assert(chat.includes('receiptRecordId(\n        row.conversationId, item.messageId, currentDid, currentDid'), 'Unread count must use reader-owned receipt IDs.');
assert(chat.includes('unreadCount: unreadCountByConversation.get(row.conversationId) || 0'), 'Server unread count missing from conversation response.');
const visibleHistoryStart = chat.indexOf('for (const item of byConversation.values())');
const visibleHistoryEnd = chat.indexOf('const conversationRows =', visibleHistoryStart);
assert(visibleHistoryStart >= 0 && visibleHistoryEnd > visibleHistoryStart, 'Unread history-window builder missing.');
const visibleHistoryBlock = chat.slice(visibleHistoryStart, visibleHistoryEnd);
assert(visibleHistoryBlock.includes('.slice(-MAX_HISTORY)'), 'Unread IDs must be bounded to the displayed message history.');
assert(visibleHistoryBlock.indexOf('.slice(-MAX_HISTORY)') < visibleHistoryBlock.indexOf('.filter(message => message.senderDid === item.otherDid)'), 'Unread counting must filter incoming messages only after choosing the latest visible history window.');
assert(chat.includes('const RECEIPT_LOOKUP_BATCH_SIZE = 200;'), 'Receipt lookups must be bounded into small batches.');
assert(chat.includes('const MAX_PARALLEL_RECEIPT_LOOKUPS = 4;'), 'Receipt lookup concurrency must be bounded.');
assert(chat.includes(".in('record_id', receiptBatch)"), 'Receipt lookup must query bounded ID batches.');
assert(chat.includes("from('dwn_record_data')"), 'Unread computation must validate stored receipt payloads.');
assert(chat.includes("payload?.kind === 'chat_receipt'"), 'Unread computation must validate receipt kind.');
assert(chat.includes("payload?.state === 'read'"), 'Unread computation must validate read state.');
assert(chat.includes("String(payload.readerDid || '') === currentDid"), 'Unread computation must validate the authenticated reader DID.');
assert(chat.includes("String(payload.messageId || '') === expected.messageId"), 'Unread computation must validate the expected message identity.');
assert(!/\.in\('record_id',\s*expectedReceiptIds\)/.test(chat), 'Unbounded receipt ID lookup must not return.');
assert(frontend.includes('Number(item.unreadCount || 0) > 0'), 'Unread state must use server receipt count.');
const listLoaderStart = frontend.indexOf('async function loadConversations()');
const listLoaderEnd = frontend.indexOf('async function loadPeople(', listLoaderStart);
assert(listLoaderStart >= 0 && listLoaderEnd > listLoaderStart, 'Conversation list loader source block missing.');
const listLoader = frontend.slice(listLoaderStart, listLoaderEnd);
assert(listLoader.includes('const requestId = ++conversationListRequestId;'), 'Conversation list requests must have generation IDs.');
assert((listLoader.match(/if \(requestId !== conversationListRequestId\) return;/g) || []).length === 2, 'Both stale conversation-list successes and errors must be ignored.');
assert(frontend.includes('unreadCount > 99 ? "99+" : String(unreadCount)'), 'Unread badge must render the count.');
assert(frontend.includes('scopedChatStorageKey'), 'Per-account browser storage isolation missing.');
assert(frontend.includes('Chat request timed out. It will retry safely.'), 'Chat request timeout handling missing.');
assert(frontend.includes('message.readAt || ""'), 'Read-state update rendering guard missing.');
assert(frontend.includes('incoming.senderDid || "") === String(myDid || "")'), 'Sender other-device realtime handler missing.');
assert(frontend.includes('retryOutboxMessage(retry.dataset.retryId)'), 'Failed-message retry action is not wired.');
assert(homeShell.includes('currentFeed=bc.feed.filter(r=>!isChatFeedRecord(r))'), 'Boot cache must filter chat records.');
assert(homeShell.includes('const safe=(Array.isArray(fresh)?fresh:[]).filter(r=>!isChatFeedRecord(r))'), 'Boot feed updates must filter chat records.');
assert(uiActions.includes('if (isChatFeedRecord(record)) continue;'), 'Home feed merges must filter chat records.');
assert(uiActions.includes('records = (Array.isArray(records) ? records : []).filter(record => !isChatFeedRecord(record));'), 'Final feed rendering must filter chat records.');
assert(appShell.includes('milan-ui-actions.js?v=chat-feed-hardening-20261011-2'), 'Changed UI script must have a fresh cache-busting version.');

console.log('✅ MILAN chat architecture checks passed.');
console.log('✅ Backend syntax checks passed.');
console.log('✅ One-DWN-to-one-DWN mailbox invariants passed.');
console.log('✅ Realtime typing / message transport invariants passed.');
console.log('✅ Social Feed isolation invariant passed.');
console.log('✅ Saved-post chat isolation invariant passed.');
console.log('✅ Synchronous cloud-sync failure handling invariant passed.');
console.log('✅ Cached and merged feed chat-isolation invariants passed.');
