'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabaseDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const USER_FIELDS = '*';

function deriveUserSpaceId(userId = '', email = '') {
  const seed = String(userId) + '|' + String(email);
  const hash = require('crypto').createHash('sha256').update(seed).digest('hex');
  return 'milan-' + (userId || hash).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) + '-' + hash.slice(0, 8);
}

async function getAuthoritativeUserByDid(did) {
  const value = String(did || '').trim();
  if (!value) return null;

  const { data, error } = await supabaseDb
    .from('users')
    .select(USER_FIELDS)
    .eq('did', value)
    .maybeSingle();

  if (error) throw new Error(`Authoritative DID lookup failed: ${error.message}`);
  if (!data) return null;

  if (!data.did) {
    throw new Error('Authoritative DID mapping is incomplete.');
  }

  const spaceId = String(
    data.space_id ||
    deriveUserSpaceId(data.id, data.email)
  ).trim();

  return {
    ...data,
    spaceId,
    portableDid: data.portable_did || '',
    dwnQuotaBytes: Number(data.dwn_quota_bytes || 1073741824)
  };
}

async function getAuthoritativeUserById(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;

  const { data, error } = await supabaseDb
    .from('users')
    .select(USER_FIELDS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Authoritative user lookup failed: ${error.message}`);
  if (!data) return null;

  if (!data.did) {
    throw new Error('Authoritative DID mapping is incomplete.');
  }

  const spaceId = String(
    data.space_id ||
    deriveUserSpaceId(data.id, data.email)
  ).trim();

  return {
    ...data,
    spaceId,
    portableDid: data.portable_did || '',
    dwnQuotaBytes: Number(data.dwn_quota_bytes || 1073741824)
  };
}

module.exports = {
  getAuthoritativeUserById,
  getAuthoritativeUserByDid
};
