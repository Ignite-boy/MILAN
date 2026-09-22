'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabaseDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const USER_FIELDS = 'id,email,name,did,space_id,portable_did,dwn_quota_bytes';

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

  if (!data.did || !data.space_id) {
    throw new Error('Authoritative DID/space mapping is incomplete.');
  }

  return {
    ...data,
    spaceId: data.space_id,
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

  if (!data.did || !data.space_id) {
    throw new Error('Authoritative DID/space mapping is incomplete.');
  }

  return {
    ...data,
    spaceId: data.space_id,
    portableDid: data.portable_did || '',
    dwnQuotaBytes: Number(data.dwn_quota_bytes || 1073741824)
  };
}

module.exports = {
  getAuthoritativeUserById,
  getAuthoritativeUserByDid
};
