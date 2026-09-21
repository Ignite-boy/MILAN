'use strict';

const crypto = require('crypto');

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateDIDAndRawSeed() {
  const seed = crypto.randomBytes(32);
  return { did: `did:key:z${base64Url(seed)}`, rawSeedHex: seed.toString('hex') };
}

function mintRealUserIdentity({ userId = '', email = '' } = {}) {
  const { did, rawSeedHex } = generateDIDAndRawSeed();
  const seed = `${userId}|${email}`;
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  const spaceId = `milan-${(userId || hash).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)}-${hash.slice(0, 8)}`;

  return {
    did,
    rawSeedHex,
    portableDid: '',
    spaceId,
    real: true
  };
}

module.exports = { generateDIDAndRawSeed, mintRealUserIdentity };
