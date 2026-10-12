'use strict';

const crypto = require('crypto');
const { DidKey } = require('@web5/dids');

const PREFIX = 'milan-portable-did:v1:';
const AAD = Buffer.from('milan-portable-did:v1');

function encryptionKey() {
  const root = String(process.env.DID_KEY_ENCRYPTION_SECRET || '');

  if (Buffer.byteLength(root, 'utf8') < 32) {
    throw new Error(
      'DID_KEY_ENCRYPTION_SECRET must be configured with at least 32 bytes.'
    );
  }

  return Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(root, 'utf8'),
    Buffer.from('milan-portable-did-storage-v1'),
    Buffer.from('aes-256-gcm'),
    32
  ));
}

function encryptPortableDid(portableDid) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(AAD);

  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(portableDid), 'utf8'),
    cipher.final()
  ]);

  return PREFIX + JSON.stringify({
    version: 1,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url')
  });
}

function decryptPortableDid(stored) {
  if (!stored) return null;

  if (typeof stored === 'object' && stored.uri && stored.document) {
    return stored;
  }

  if (typeof stored !== 'string') return null;

  if (stored.startsWith(PREFIX)) {
    const envelope = JSON.parse(stored.slice(PREFIX.length));
    if (envelope.version !== 1 || !envelope.iv ||
        !envelope.tag || !envelope.ciphertext) {
      throw new Error('Invalid encrypted portable DID envelope');
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(envelope.iv, 'base64url')
    );

    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final()
    ]).toString('utf8');

    return JSON.parse(plaintext);
  }

  // Support reading existing public-only portable DID values.
  try {
    const parsed = JSON.parse(stored);
    return parsed?.uri && parsed?.document ? parsed : null;
  } catch (_) {
    return null;
  }
}

function toPublicPortableDid(stored) {
  try {
    const portable = decryptPortableDid(stored);
    if (!portable?.uri || !portable?.document) return '';
    const { privateKeys, ...publicPortable } = portable;
    return publicPortable;
  } catch (error) {
    console.error('[DID] Stored portable DID could not be read:', error.message);
    return '';
  }
}

async function generateDIDAndRawSeed() {
  const bearerDid = await DidKey.create();
  const portableDid = await bearerDid.export();

  return {
    did: bearerDid.uri,
    rawSeedHex: '',
    portableDid: encryptPortableDid(portableDid)
  };
}

async function mintRealUserIdentity({ userId = '', email = '' } = {}) {
  const generated = await generateDIDAndRawSeed();
  const seed = `${userId}|${email}`;
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  const spaceId =
    `milan-${(userId || hash).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)}-${hash.slice(0, 8)}`;

  return {
    did: generated.did,
    rawSeedHex: generated.rawSeedHex,
    portableDid: generated.portableDid,
    spaceId,
    real: true
  };
}

module.exports = {
  generateDIDAndRawSeed,
  mintRealUserIdentity,
  decryptPortableDid,
  toPublicPortableDid
};
