"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const rows = new Map();
process.env.MILAN_UPLOAD_SESSION_TTL_MS = String(24 * 60 * 60 * 1000);

function rowKey(row) {
  return [row.did, row.space_id, row.component_type, row.item_key].join("|");
}

const fakeDb = {
  rows,

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

    if (q.startsWith("select did, space_id, payload from public.dwn_storage")) {
      const row = [...rows.values()].find(r =>
        r.component_type === "event" && r.item_key === params[0]
      );
      return { rows: row ? [{
        did: row.did,
        space_id: row.space_id,
        payload: row.payload
      }] : [], rowCount: row ? 1 : 0 };
    }

    if (q.startsWith("insert into public.dwn_storage") && q.includes("payload")) {
      const [did, space_id, item_key, parent_key, payload] = params;
      const data = typeof payload === "string" ? JSON.parse(payload) : payload;
      const row = {
        did, space_id, item_key, parent_key,
        component_type: "event",
        payload: data,
        data_bytes: null,
        data_size: 0
      };
      rows.set(rowKey(row), row);
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith("insert into public.dwn_storage") && q.includes("data_bytes")) {
      const [did, space_id, item_key, parent_key, bytes, size] = params;
      const row = {
        did, space_id, item_key, parent_key,
        component_type: "event",
        payload: null,
        data_bytes: Buffer.from(bytes),
        data_size: size
      };
      rows.set(rowKey(row), row);
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith("select item_key from public.dwn_storage")) {
      const [did, space_id, parent_key, pattern] = params;
      const prefix = String(pattern).replace(/%$/, "");
      const found = [...rows.values()].filter(r =>
        r.component_type === "event" &&
        r.did === did &&
        r.space_id === space_id &&
        r.parent_key === parent_key &&
        r.item_key.startsWith(prefix)
      );
      return { rows: found.map(r => ({ item_key: r.item_key })), rowCount: found.length };
    }

    if (q.startsWith("select data_bytes from public.dwn_storage")) {
      const [did, space_id, item_key] = params;
      const row = [...rows.values()].find(r =>
        r.component_type === "event" &&
        r.did === did &&
        r.space_id === space_id &&
        r.item_key === item_key
      );
      return { rows: row ? [{ data_bytes: row.data_bytes }] : [], rowCount: row ? 1 : 0 };
    }

    if (q.startsWith("delete from public.dwn_storage")) {
      const [did, space_id, sessionKey, parentKey] = params;
      let count = 0;
      for (const [key, row] of rows) {
        if (
          row.did === did &&
          row.space_id === space_id &&
          (row.item_key === sessionKey || row.parent_key === parentKey)
        ) {
          rows.delete(key);
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }

    throw new Error("Unexpected mocked SQL in upload self-test: " + q);
  }
};

const dbPath = require.resolve(path.join(root, "backend/services/milanDb.js"));
const dbModule = new Module(dbPath);
dbModule.filename = dbPath;
dbModule.loaded = true;
dbModule.exports = fakeDb;
require.cache[dbPath] = dbModule;

const storePath = require.resolve(path.join(root, "backend/services/resumableUploadStore.js"));
const store = require(storePath);

(async () => {
  try {
    const now = new Date().toISOString();
    const session = {
      id: "adapter-test-1",
      userId: "test-user",
      ownerDid: "did:key:test-upload-owner",
      spaceId: "milan-test-space",
      sizeBytes: 9,
      chunkBytes: 4,
      totalChunks: 3,
      received: {},
      receivedBytes: 0,
      createdAt: now,
      updatedAt: now,
      status: "receiving"
    };

    await store.writeSession(session);
    assert.deepEqual(await store.readSession(session.id), session);
    console.log("PASS: PostgreSQL adapter session metadata write/read (mocked DB).");

    await store.writeChunk(session.id, 0, Buffer.from("abcd"));
    await store.writeChunk(session.id, 1, Buffer.from("efgh"));
    await store.writeChunk(session.id, 2, Buffer.from("i"));

    assert.deepEqual(await store.listChunkIndexes(session.id), [0, 1, 2]);
    console.log("PASS: chunk listing and ordering.");

    const assembled = Buffer.concat([
      await store.readChunk(session.id, 0),
      await store.readChunk(session.id, 1),
      await store.readChunk(session.id, 2)
    ]);
    assert.equal(assembled.toString(), "abcdefghi");
    console.log("PASS: chunk bytes remain unchanged.");

    await store.deleteSession(session.id);
    assert.equal(await store.readSession(session.id), null);
    assert.deepEqual(await store.listChunkIndexes(session.id), []);
    console.log("PASS: session and chunk cleanup.");

    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const expired = {
      ...session,
      id: "adapter-expired-test",
      createdAt: old,
      updatedAt: old
    };

    await store.writeSession(expired);
    assert.equal(await store.readSession(expired.id), null);
    assert.equal(
      [...rows.values()].some(r => r.item_key === `upload-session:${expired.id}`),
      false
    );
    console.log("PASS: expired session is rejected and cleaned up.");

    console.log("\nALL POSTGRESQL ADAPTER SELF-TESTS PASSED (MOCKED DATABASE).");
  } catch (error) {
    console.error("POSTGRESQL ADAPTER TEST FAILED:", error.stack || error);
    process.exitCode = 1;
  } finally {
    rows.clear();
    delete require.cache[storePath];
    delete require.cache[dbPath];
  }
})();
