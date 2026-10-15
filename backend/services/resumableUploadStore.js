"use strict";

const { supabase } = require("../utils/dwnStorage");
const BUCKET = String(
  process.env.SUPABASE_UPLOAD_BUCKET || "milan-upload-staging"
).trim();
const TTL_MS = Number(
  process.env.MILAN_UPLOAD_SESSION_TTL_MS || 24 * 60 * 60 * 1000
);

function safeId(value) {
  const id = String(value || "");
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) && !id.includes("..")
    ? id
    : "";
}

function storage() {
  return supabase.storage.from(BUCKET);
}

function isMissing(error) {
  const status = String(error?.statusCode || error?.status || "");
  return status === "404" ||
    /not found|object does not exist/i.test(String(error?.message || ""));
}

function sessionPath(id) {
  const safe = safeId(id);
  return safe ? `${safe}/session.json` : "";
}

function chunkPath(id, index) {
  const safe = safeId(id);
  if (!safe || !Number.isInteger(index) || index < 0) return "";
  return `${safe}/chunks/chunk-${String(index).padStart(8, "0")}.part`;
}

async function readSession(id) {
  const key = sessionPath(id);
  if (!key) return null;

  const { data, error } = await storage().download(key);
  if (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!data) return null;

  let session;
  try {
    session = JSON.parse(
      Buffer.from(await data.arrayBuffer()).toString("utf8")
    );
  } catch (_) {
    throw new Error("Stored upload session metadata is invalid.");
  }

  const timestamp = Date.parse(session.updatedAt || session.createdAt || "");
  if (timestamp && Date.now() - timestamp > TTL_MS) {
    try { await deleteSession(id); } catch (_) {}
    return null;
  }

  return session;
}

async function writeSession(session) {
  const key = sessionPath(session?.id);
  if (!key) throw new Error("Invalid upload session ID.");

  const { error } = await storage().upload(
    key,
    Buffer.from(JSON.stringify(session)),
    {
      upsert: true,
      contentType: "application/octet-stream",
      cacheControl: "60"
    }
  );
  if (error) throw error;
}

async function writeChunk(id, index, bytes) {
  const key = chunkPath(id, index);
  if (!key) throw new Error("Invalid upload chunk path.");

  const { error } = await storage().upload(key, bytes, {
    upsert: true,
    contentType: "application/octet-stream",
    cacheControl: "60"
  });
  if (error) throw error;
}

async function listChunkIndexes(id) {
  const safe = safeId(id);
  if (!safe) return [];

  const indexes = new Set();
  let offset = 0;

  for (;;) {
    const { data, error } = await storage().list(`${safe}/chunks`, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const match = String(row?.name || "").match(/^chunk-(\d{8})\.part$/);
      if (match) indexes.add(Number(match[1]));
    }

    if (rows.length < 1000) break;
    offset += rows.length;
  }

  return [...indexes].sort((a, b) => a - b);
}

async function readChunk(id, index) {
  const key = chunkPath(id, index);
  if (!key) return null;

  const { data, error } = await storage().download(key);
  if (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

async function deleteSession(id) {
  const safe = safeId(id);
  if (!safe) return;

  const indexes = await listChunkIndexes(safe);
  const keys = [
    ...indexes.map(index => chunkPath(safe, index)),
    sessionPath(safe)
  ].filter(Boolean);

  for (let i = 0; i < keys.length; i += 100) {
    const { error } = await storage().remove(keys.slice(i, i + 100));
    if (error && !isMissing(error)) throw error;
  }
}

module.exports = {
  bucketName: BUCKET,
  readSession,
  writeSession,
  writeChunk,
  listChunkIndexes,
  readChunk,
  deleteSession
};
