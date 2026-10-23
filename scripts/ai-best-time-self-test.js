'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  collectOwnActivity,
  collectOwnReactions,
  collectOwnInteractionEvents,
  countHours
} = require('../backend/services/aiBestTime');

const ownDid = 'did:example:alice';
const otherDid = 'did:example:bob';
const ownTimestamp = '2026-10-23T10:00:00.000Z';
const otherTimestamp = '2026-10-23T18:00:00.000Z';

const keyedActivity = {
  alice: [{ at: ownTimestamp, action: 'own activity' }],
  bob: [{ at: otherTimestamp, action: 'other activity' }]
};
assert.equal(collectOwnActivity(keyedActivity, 'alice', ownDid).length, 1);
assert.equal(collectOwnActivity(keyedActivity, 'alice', ownDid)[0].action, 'own activity');

const globalActivity = [
  { userId: 'alice', at: ownTimestamp },
  { actorId: 'bob', at: otherTimestamp },
  { at: otherTimestamp }
];
assert.equal(collectOwnActivity(globalActivity, 'alice', ownDid).length, 1);

const reactions = {
  post1: {
    [ownDid]: { at: ownTimestamp, type: 'like' },
    [otherDid]: { at: otherTimestamp, type: 'like' }
  },
  post2: {
    [otherDid]: { at: otherTimestamp, type: 'like' }
  }
};
const ownReactions = collectOwnReactions(reactions, 'alice', ownDid);
assert.equal(ownReactions.length, 1);
assert.equal(ownReactions[0].type, 'like');

const events = collectOwnInteractionEvents({
  activity: keyedActivity,
  reactions,
  userId: 'alice',
  did: ownDid
});
const measured = countHours(events);
assert.equal(measured.validEvents, 2);
assert.equal(measured.hourCounts[new Date(ownTimestamp).getHours()], 2);
assert.equal(measured.hourCounts[new Date(otherTimestamp).getHours()], 0);

const invalidDates = countHours([{ at: 'not-a-date' }, {}, { at: ownTimestamp }]);
assert.equal(invalidDates.validEvents, 1);

const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'backend/routes/ai.js'), 'utf8');
assert.match(route, /router\.get\('\/best-time\/:userId', auth,/);
assert.match(route, /userId !== String\(req\.userId/);
assert.match(route, /collectOwnInteractionEvents/);
assert.match(route, /Could not calculate posting-time analytics/);
console.log('PASS: best-time analytics require authentication and enforce account ownership.');
console.log('PASS: activity and reactions exclude other users from personalized aggregates.');
console.log('PASS: keyed app data and malformed timestamps are handled safely.');
console.log('ALL AI DATA-BOUNDARY SELF-TESTS PASSED.');
