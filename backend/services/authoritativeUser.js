'use strict';

const milanDb = require('./milanDb');
const { toPublicPortableDid, decryptPortableDid } = require('../utils/did');

function deriveUserSpaceId(userId = '', email = '') {
  const seed = String(userId) + '|' + String(email);
  const hash = require('crypto').createHash('sha256').update(seed).digest('hex');
  return 'milan-' + (userId || hash).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) + '-' + hash.slice(0, 8);
}

async function getAuthoritativeUserByDid(did) {
  const value = String(did || '').trim();
  if (!value) return null;

  const result = await milanDb.query(
    `SELECT user_id, name, email, did, space_id, portable_did, dwn_quota_bytes
       FROM public.users
      WHERE did = $1
      LIMIT 1`,
    [value]
  );
  const data = result.rows[0];
  if (!data) return null;

  if (!data.did || !data.user_id || !data.space_id) {
    throw new Error('Authoritative DID mapping is incomplete.');
  }

  return {
    id: data.user_id,
    name: String(data.name || ''),
    email: String(data.email || ''),
    did: data.did,
    spaceId: String(data.space_id).trim(),
    portableDid: toPublicPortableDid(data.portable_did),
    dwnQuotaBytes: Number(data.dwn_quota_bytes || 1073741824)
  };
}

// SERVER-ONLY: returns private DID signing material to trusted backend services.
// Never serialize this result or expose it through an HTTP/API response.
async function getAuthoritativeSigningIdentityByDid(did) {
  const value = String(did || '').trim();
  if (!value) return null;

  const result = await milanDb.query(
    `SELECT did, space_id, portable_did
       FROM public.users
      WHERE did = $1
      LIMIT 1`,
    [value]
  );

  const data = result.rows[0];
  if (!data) return null;

  if (!data.did || !data.space_id || !data.portable_did) {
    throw new Error('Authoritative signing identity mapping is incomplete.');
  }

  let portableDid;
  try {
    portableDid = decryptPortableDid(data.portable_did);
  } catch (_) {
    throw new Error('Stored DID signing identity could not be decrypted; signing refused.');
  }

  if (!portableDid?.uri || portableDid.uri !== data.did || !portableDid.document) {
    throw new Error('Stored DID signing identity does not match its PostgreSQL owner.');
  }

  const keys = portableDid.privateKeys;
  const hasPrivateKeys = Array.isArray(keys)
    ? keys.length > 0
    : !!keys && typeof keys === 'object' && Object.keys(keys).length > 0;

  if (!hasPrivateKeys) {
    throw new Error('Stored DID has no private signing keys; signing refused.');
  }

  return {
    did: data.did,
    spaceId: String(data.space_id).trim(),
    portableDid
  };
}

async function getAuthoritativeUserById(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;

  const result = await milanDb.query(
    'SELECT * FROM public.users WHERE user_id::text = $1 LIMIT 1',
    [id]
  );
  const data = result.rows[0];
  if (!data) return null;

  if (!data.did || !data.user_id || !data.space_id) {
    throw new Error('Authoritative DID mapping is incomplete.');
  }

  return {
    ...data,
    id: data.user_id,
    spaceId: String(data.space_id).trim(),
    portableDid: toPublicPortableDid(data.portable_did),
    dwnQuotaBytes: Number(data.dwn_quota_bytes || 1073741824)
  };
}

module.exports = {
  getAuthoritativeUserById,
  getAuthoritativeUserByDid,
  getAuthoritativeSigningIdentityByDid
};
