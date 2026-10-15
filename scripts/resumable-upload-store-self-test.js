"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const objects = new Map();
const bucketName = "milan-upload-staging";
const objectKey = key => `${bucketName}/${key}`;

process.env.SUPABASE_UPLOAD_BUCKET = bucketName;
process.env.MILAN_UPLOAD_SESSION_TTL_MS = String(24 * 60 * 60 * 1000);

const bucketApi = {
  async upload(key, payload, options) {
    assert.equal(options.upsert, true);
    objects.set(objectKey(key), Buffer.from(payload));
    return { data: { path: key }, error: null };
  },

  async download(key) {
    const stored = objects.get(objectKey(key));
    if (!stored) {
      return {
        data: null,
        error: { statusCode: "404", message: "Object not found" }
      };
    }
    return { data: new Blob([stored]), error: null };
  },

  async list(prefix, options = {}) {
    const folder = objectKey(String(prefix).replace(/\/+$/, "")) + "/";
    const names = [...objects.keys()]
      .filter(key => key.startsWith(folder))
      .map(key => key.slice(folder.length))
      .filter(name => name && !name.includes("/"))
      .sort();

    const offset = Number(options.offset || 0);
    const limit = Number(options.limit || 1000);

    return {
      data: names.slice(offset, offset + limit).map(name => ({ name })),
      error: null
    };
  },

  async remove(keys) {
    for (const key of keys) objects.delete(objectKey(key));
    return { data: keys.map(name => ({ name })), error: null };
  }
};

const fakeDwnStorage = {
  supabase: {
    storage: {
      from(name) {
        assert.equal(name, bucketName);
        return bucketApi;
      }
    }
  }
};

const storageModulePath = require.resolve(
  path.join(root, "backend/utils/dwnStorage.js")
);
const mocked = new Module(storageModulePath);
mocked.filename = storageModulePath;
mocked.loaded = true;
mocked.exports = fakeDwnStorage;
require.cache[storageModulePath] = mocked;

const store = require(path.join(
  root,
  "backend/services/resumableUploadStore.js"
));

(async () => {
  try {
    assert.equal(store.bucketName, bucketName);

    const now = new Date().toISOString();
    const session = {
      id: "adapter-test-1",
      userId: "test-user",
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
    const loaded = await store.readSession(session.id);
    assert.deepEqual(loaded, session);
    console.log("PASS: session metadata write/read.");

    await store.writeChunk(session.id, 0, Buffer.from("abcd"));
    await store.writeChunk(session.id, 1, Buffer.from("efgh"));
    await store.writeChunk(session.id, 2, Buffer.from("i"));

    assert.deepEqual(
      await store.listChunkIndexes(session.id),
      [0, 1, 2]
    );
    console.log("PASS: shared chunk listing and ordering.");

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

    const expired = {
      ...session,
      id: "adapter-expired-test",
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    };

    await store.writeSession(expired);
    assert.equal(await store.readSession(expired.id), null);
    assert.equal(
      objects.has(objectKey(`${expired.id}/session.json`)),
      false
    );
    console.log("PASS: expired session is rejected and cleaned up.");

    console.log("\nALL STORAGE ADAPTER SELF-TESTS PASSED.");
  } catch (error) {
    console.error("STORAGE ADAPTER TEST FAILED:", error.stack || error);
    process.exitCode = 1;
  } finally {
    objects.clear();
    delete require.cache[storageModulePath];
  }
})();
