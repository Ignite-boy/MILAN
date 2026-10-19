'use strict';

const milanDb = require('./milanDb');
const { toPublicPortableDid } = require('../utils/did');

function deriveUserSpaceId(userId = '', email = '') {
  const seed = String(userId) + '|' + String(email);
  const hash = require('crypto').createHash('sha256').update(seed).digest('hex');
  return 'milan-' + (userId || hash).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) + '-' + hash.slice(0, 8);
}

async function getAuthoritativeUserByDid(did) {
  const value = String(did || '').trim();
  if (!value) return null;

  const result = await milanDb.query(
    'SELECT * FROM public.users WHERE did = $1 LIMIT 1',
    [value]
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
  getAuthoritativeUserByDid
};
