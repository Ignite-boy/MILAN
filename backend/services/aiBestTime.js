'use strict';

function same(value, expected) {
  return value !== undefined && value !== null &&
    String(value) !== '' && String(value) === String(expected);
}

function ownerFields(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
  return [
    item.userId, item.user_id, item.actorId, item.actor_id,
    item.did, item.actorDid, item.ownerDid
  ].filter(value => value !== undefined && value !== null && String(value) !== '');
}

function belongsTo(item, userId, did) {
  const owners = ownerFields(item);
  return owners.some(owner => same(owner, userId) || (did && same(owner, did)));
}

function hasOwnerMetadata(item) {
  return ownerFields(item).length > 0;
}

function scopedRows(value, userId, did, keyedToUser) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => {
    if (!item || typeof item !== 'object') return false;
    if (belongsTo(item, userId, did)) return true;
    return keyedToUser && !hasOwnerMetadata(item);
  });
}

function collectOwnActivity(activity, userId, did) {
  if (Array.isArray(activity)) {
    return scopedRows(activity, userId, did, false);
  }
  if (!activity || typeof activity !== 'object') return [];

  const own = activity[String(userId)];
  if (Array.isArray(own)) {
    return scopedRows(own, userId, did, true);
  }

  return Object.values(activity).flatMap(value =>
    scopedRows(value, userId, did, false)
  );
}

function collectOwnReactions(reactions, userId, did) {
  if (Array.isArray(reactions)) {
    return scopedRows(reactions, userId, did, false);
  }
  if (!reactions || typeof reactions !== 'object') return [];

  const result = [];
  for (const group of Object.values(reactions)) {
    if (Array.isArray(group)) {
      result.push(...scopedRows(group, userId, did, false));
      continue;
    }
    if (!group || typeof group !== 'object') continue;

    // The app's social-reaction store is keyed by post ID, then actor DID.
    let own = did ? group[String(did)] : undefined;
    if (own === undefined) own = group[String(userId)];
    if (own === undefined || own === null) continue;

    const ownRows = Array.isArray(own) ? own : [own];
    result.push(...scopedRows(ownRows, userId, did, true));
  }
  return result;
}

function countHours(events) {
  const counts = new Array(24).fill(0);
  let validEvents = 0;

  for (const item of events || []) {
    const raw = item && (item.timestamp ?? item.createdAt ?? item.at ?? item.updatedAt);
    if (raw === undefined || raw === null || raw === '') continue;

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) continue;

    counts[date.getHours()] += 1;
    validEvents += 1;
  }

  return { hourCounts: counts, validEvents };
}

function collectOwnInteractionEvents({ activity, reactions, userId, did }) {
  return [
    ...collectOwnActivity(activity, userId, did),
    ...collectOwnReactions(reactions, userId, did)
  ];
}

module.exports = {
  collectOwnActivity,
  collectOwnReactions,
  collectOwnInteractionEvents,
  countHours
};
