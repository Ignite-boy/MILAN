'use strict';

function parseTokenVersion(value) {
  if (value === null || value === undefined || value === '') return null;
  const version = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function tokenVersionMatches(claimedVersion, authoritativeVersion) {
  const claimed = parseTokenVersion(claimedVersion);
  const current = parseTokenVersion(authoritativeVersion);
  return claimed !== null && current !== null && claimed === current;
}

module.exports = { parseTokenVersion, tokenVersionMatches };
