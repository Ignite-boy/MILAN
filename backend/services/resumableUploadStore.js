"use strict";

const db = require("./milanDb");
const TTL_MS = Number(process.env.MILAN_UPLOAD_SESSION_TTL_MS || 24 * 60 * 60 * 1000);

function safeId(value) {
  const id = String(value || "");
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) && !id.includes("..") ? id : "";
}
function sessionKey(id) {
  const safe = safeId(id);
  return safe ? `upload-session:${safe}` : "";
}
function chunkKey(id, index) {
  const safe = safeId(id);
  if (!safe || !Number.isInteger(index) || index < 0) return "";
  return `upload-chunk:${safe}:${String(index).padStart(8, "0")}`;
}
async function findSession(id) {
  const key = sessionKey(id);
  if (!key) return null;
  const result = await db.query(
    `SELECT did, space_id, payload
       FROM public.dwn_storage
      WHERE component_type = 'event' AND item_key = $1
      LIMIT 1`,
    [key]
  );
  if (!result.rowCount) return null;
  return {
    did: result.rows[0].did,
    spaceId: result.rows[0].space_id,
    session: result.rows[0].payload
  };
}
async function readSession(id) {
  const row = await findSession(id);
  if (!row || !row.session) return null;
  const session = row.session;
  const timestamp = Date.parse(session.updatedAt || session.createdAt || "");
  if (timestamp && Date.now() - timestamp > TTL_MS) {
    await deleteSession(id);
    return null;
  }
  return session;
}
async function writeSession(session) {
  const key = sessionKey(session?.id);
  const did = String(session?.ownerDid || "");
  const spaceId = String(session?.spaceId || "");
  if (!key || !did.startsWith("did:") || !spaceId) {
    throw new Error("Upload session requires a valid owner DID and space ID.");
  }
  await db.query(
    `INSERT INTO public.dwn_storage
       (component_type, did, space_id, item_key, parent_key, data_format,
        metadata, payload, data_size, date_modified, updated_at)
     VALUES ('event', $1, $2, $3, $4, 'application/json',
             '{"kind":"resumable-upload-session"}'::jsonb, $5::jsonb, 0, NOW(), NOW())
     ON CONFLICT (did, space_id, component_type, item_key)
     DO UPDATE SET payload = EXCLUDED.payload, date_modified = NOW(), updated_at = NOW()`,
    [did, spaceId, key, session.id, JSON.stringify(session)]
  );
}
async function writeChunk(id, index, bytes) {
  const key = chunkKey(id, index);
  if (!key || !Buffer.isBuffer(bytes)) throw new Error("Invalid upload chunk.");
  const owner = await findSession(id);
  if (!owner) throw new Error("Upload session not found.");
  await db.query(
    `INSERT INTO public.dwn_storage
       (component_type, did, space_id, item_key, parent_key, data_format,
        metadata, data_bytes, data_size, date_modified, updated_at)
     VALUES ('event', $1, $2, $3, $4, 'application/octet-stream',
             '{"kind":"resumable-upload-chunk"}'::jsonb, $5, $6, NOW(), NOW())
     ON CONFLICT (did, space_id, component_type, item_key)
     DO UPDATE SET data_bytes = EXCLUDED.data_bytes, data_size = EXCLUDED.data_size,
                   date_modified = NOW(), updated_at = NOW()`,
    [owner.did, owner.spaceId, key, String(id), bytes, bytes.length]
  );
}
async function listChunkIndexes(id) {
  if (!safeId(id)) return [];
  const owner = await findSession(id);
  if (!owner) return [];
  const result = await db.query(
    `SELECT item_key FROM public.dwn_storage
      WHERE component_type = 'event' AND did = $1 AND space_id = $2
        AND parent_key = $3 AND item_key LIKE $4`,
    [owner.did, owner.spaceId, String(id), `upload-chunk:${id}:%`]
  );
  return result.rows.map(row => {
    const match = row.item_key.match(/^upload-chunk:[A-Za-z0-9_-]+:(\d{8})$/);
    return match ? Number(match[1]) : -1;
  }).filter(Number.isInteger).filter(index => index >= 0).sort((a, b) => a - b);
}
async function readChunk(id, index) {
  const key = chunkKey(id, index);
  if (!key) return null;
  const owner = await findSession(id);
  if (!owner) return null;
  const result = await db.query(
    `SELECT data_bytes FROM public.dwn_storage
      WHERE component_type = 'event' AND did = $1 AND space_id = $2 AND item_key = $3
      LIMIT 1`,
    [owner.did, owner.spaceId, key]
  );
  if (!result.rowCount || result.rows[0].data_bytes == null) return null;
  return Buffer.from(result.rows[0].data_bytes);
}
async function deleteSession(id) {
  if (!safeId(id)) return;
  const owner = await findSession(id);
  if (!owner) return;
  await db.query(
    `DELETE FROM public.dwn_storage
      WHERE component_type = 'event' AND did = $1 AND space_id = $2
        AND (item_key = $3 OR parent_key = $4)`,
    [owner.did, owner.spaceId, sessionKey(id), String(id)]
  );
}
module.exports = {
  bucketName: "voroa-postgres",
  readSession, writeSession, writeChunk, listChunkIndexes, readChunk, deleteSession
};
