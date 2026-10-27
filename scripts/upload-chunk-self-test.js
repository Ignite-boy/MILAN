"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const express = require("express");

const root = path.resolve(__dirname, "..");
let authenticatedUserId = "isolated-upload-test-user";
let failNextMediaCommit = false;
const committedRecordIds = [];
const originalTmpdir = os.tmpdir;
const isolatedTemp = fs.mkdtempSync(
  path.join(originalTmpdir(), "milan-upload-self-test-")
);

process.env.NODE_ENV = "test";
process.env.MILAN_UPLOAD_STORAGE_BACKEND = "local";

const chunkBytes = 1024 * 1024;
const content = Buffer.alloc(chunkBytes * 2 + 37);

for (let i = 0; i < content.length; i++) {
  content[i] = i % 251;
}

function mockModule(relativePath, exports) {
  const id = require.resolve(path.join(root, relativePath));
  const mod = new Module(id);
  mod.filename = id;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[id] = mod;
}

mockModule("backend/middleware/auth.js", (req, res, next) => {
  req.userId = authenticatedUserId;
  req.account = {
    id: req.userId,
    email: "upload-test@example.invalid",
    name: "Upload Test",
    did: req.userId === "isolated-upload-test-user"
      ? "did:example:upload-test"
      : "did:example:other-test",
    spaceId: "isolated-test-space"
  };
  next();
});

mockModule("backend/utils/store.js", {
  readJson: () => ({}),
  findUserById: () => null,
  findUserByDid: () => null,
  addActivity: () => {}
});

mockModule("backend/services/dwnService.js", {
  async createMediaRecordFromFile(userId, did, meta, filePath) {
    assert.equal(userId, "isolated-upload-test-user");
    assert.equal(did, "did:example:upload-test");
    assert.deepEqual(fs.readFileSync(filePath), content);

    const recordId = String(meta.recordId || "");
    assert.match(recordId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    committedRecordIds.push(recordId);

    if (failNextMediaCommit) {
      failNextMediaCommit = false;
      const error = new Error("simulated cloud commit failure");
      error.status = 502;
      throw error;
    }

    return {
      id: recordId,
      title: meta.title,
      accessMode: meta.accessMode,
      dwnRecordId: "isolated-test-dwn-record"
    };
  }
});

const sharedMode = process.argv.includes("--shared");

if (sharedMode) {
  process.env.MILAN_UPLOAD_STORAGE_BACKEND = "voroa-postgresql";

  const sessions = new Map();
  const chunks = new Map();
  globalThis.__milanUploadTestHooks = { sessions, chunks };
  const cloneSession = value => JSON.parse(JSON.stringify(value));

  mockModule("backend/services/resumableUploadStore.js", {
    bucketName: "milan-upload-staging-test",

    async readSession(id) {
      const session = sessions.get(id);
      return session ? cloneSession(session) : null;
    },

    async writeSession(session) {
      sessions.set(session.id, cloneSession(session));
    },

    async writeChunk(id, index, bytes) {
      if (!chunks.has(id)) chunks.set(id, new Map());
      chunks.get(id).set(index, Buffer.from(bytes));
    },

    async writeChunkAndListChunkIndexes(id, index, bytes, session) {
      const savedSession = sessions.get(id);
      if (!savedSession ||
          savedSession.ownerDid !== session?.ownerDid ||
          savedSession.spaceId !== session?.spaceId) {
        throw new Error("Upload session not found.");
      }
      if (!chunks.has(id)) chunks.set(id, new Map());
      chunks.get(id).set(index, Buffer.from(bytes));
      return [...chunks.get(id).keys()].sort((a, b) => a - b);
    },

    async listChunkIndexes(id) {
      return [...(chunks.get(id) || new Map()).keys()]
        .sort((a, b) => a - b);
    },

    async readChunk(id, index) {
      const chunk = chunks.get(id)?.get(index);
      return chunk ? Buffer.from(chunk) : null;
    },

    async readChunks(id, indexes) {
      const saved = chunks.get(id) || new Map();
      return new Map(
        indexes
          .filter(index => saved.has(index))
          .map(index => [index, Buffer.from(saved.get(index))])
      );
    },

    async deleteSession(id) {
      sessions.delete(id);
      chunks.delete(id);
    }
  });

  console.log("TEST MODE: Voroa PostgreSQL shared-storage route branch; storage is mocked.");
}

let route;
try {
  // Keep test upload sessions separate from any developer upload sessions.
  os.tmpdir = () => isolatedTemp;
  route = require(path.join(root, "backend/routes/records.js"));
} finally {
  os.tmpdir = originalTmpdir;
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/api/records", route);

let server;
let base;
let uploadId;

async function request(routePath, options = {}) {
  const response = await fetch(base + routePath, options);
  const text = await response.text();
  let body = {};

  try {
    body = JSON.parse(text);
  } catch (_) {}

  return { status: response.status, body };
}

function jsonOptions(body) {
  return {
    method: "POST",
    headers: {
      Authorization: "Bearer isolated-test-token",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

async function sendChunk(index, bytes) {
  const start = index * chunkBytes;
  const part = bytes || content.subarray(
    start,
    Math.min(content.length, start + chunkBytes)
  );

  return request(
    `/api/records/media/chunk/${encodeURIComponent(uploadId)}`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer isolated-test-token",
        "Content-Type": "application/octet-stream",
        "X-Chunk-Index": String(index),
        "X-Total-Chunks": "3",
        "X-Chunk-Bytes": String(part.length)
      },
      body: part
    }
  );
}

(async () => {
  try {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });

    base = `http://127.0.0.1:${server.address().port}`;

    const init = await request(
      "/api/records/media/chunk/init",
      jsonOptions({
        fileName: "integration-test.mp4",
        mimeType: "video/mp4",
        sizeBytes: content.length,
        chunkBytes,
        title: "Upload integration test",
        caption: "isolated test",
        accessMode: "private",
        sharedWithDids: [],
        tags: []
      })
    );

    assert.equal(init.status, 201, JSON.stringify(init.body));
    uploadId = init.body.uploadId;
    assert.ok(uploadId);
    assert.equal(init.body.totalChunks, 3);
    console.log("PASS: chunked upload session initialization.");

    const sessionPath =
      `/api/records/media/chunk/${encodeURIComponent(uploadId)}`;

    authenticatedUserId = "isolated-other-test-user";

    const deniedStatus = await request(sessionPath, {
      headers: { Authorization: "Bearer isolated-test-token" }
    });
    assert.equal(deniedStatus.status, 403);

    const deniedDelete = await request(sessionPath, {
      method: "DELETE",
      headers: { Authorization: "Bearer isolated-test-token" }
    });
    assert.equal(deniedDelete.status, 403);

    authenticatedUserId = "isolated-upload-test-user";
    console.log("PASS: another user cannot read or delete the upload session.");

    const incomplete = await request(
      sessionPath + "/complete",
      jsonOptions({})
    );
    assert.equal(incomplete.status, 409);
    console.log("PASS: incomplete upload is rejected.");

    const badChunk = await sendChunk(0, content.subarray(0, 10));
    assert.equal(badChunk.status, 400);
    console.log("PASS: malformed chunk size is rejected.");

    let result = await sendChunk(0);
    assert.equal(result.status, 200, JSON.stringify(result.body));

    result = await sendChunk(0);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    console.log("PASS: same-chunk retry is accepted.");

    if (sharedMode) {
      const hooks = globalThis.__milanUploadTestHooks;
      const savedSession = hooks.sessions.get(uploadId);
      assert.ok(savedSession, "Shared session should exist before orphan test.");

      hooks.sessions.delete(uploadId);
      const orphanDelete = await request(sessionPath, {
        method: "DELETE",
        headers: { Authorization: "Bearer isolated-test-token" }
      });

      assert.equal(orphanDelete.status, 404);
      assert.ok(
        hooks.chunks.get(uploadId)?.has(0),
        "Orphaned chunk must not be deleted without session ownership."
      );

      hooks.sessions.set(uploadId, savedSession);
      console.log("PASS: missing-session DELETE preserves orphaned chunks.");
    }

    const concurrent = await Promise.all([
      sendChunk(2),
      sendChunk(1)
    ]);

    for (const item of concurrent) {
      assert.equal(item.status, 200, JSON.stringify(item.body));
    }
    console.log("PASS: parallel chunk uploads.");

    const status = await request(sessionPath, {
      headers: {
        Authorization: "Bearer isolated-test-token"
      }
    });

    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal(status.body.receivedBytes, content.length);
    assert.deepEqual(
      [...status.body.received].sort((a, b) => a - b),
      [0, 1, 2]
    );
    if (!sharedMode) {
      const diskSessionPath = path.join(
        isolatedTemp,
        "milan-resumable-media-uploads",
        uploadId,
        "session.json"
      );
      const diskSession = JSON.parse(
        fs.readFileSync(diskSessionPath, "utf8")
      );

      assert.equal(diskSession.receivedBytes, content.length);
      assert.deepEqual(
        Object.keys(diskSession.received).map(Number).sort((a, b) => a - b),
        [0, 1, 2]
      );
      console.log("PASS: local session metadata remains valid after concurrent writes.");
    } else {
      console.log("PASS: shared-mode session state verified through the mocked storage adapter.");
    }
    console.log("PASS: server-side chunk and byte counts.");

    failNextMediaCommit = true;
    const failedCompletion = await request(
      sessionPath + "/complete",
      jsonOptions({})
    );
    assert.equal(failedCompletion.status, 502, JSON.stringify(failedCompletion.body));
    assert.equal(committedRecordIds.length, 1);
    const stableRecordId = committedRecordIds[0];

    const retained = await request(sessionPath, {
      headers: { Authorization: "Bearer isolated-test-token" }
    });
    assert.equal(retained.status, 200, JSON.stringify(retained.body));
    assert.equal(retained.body.receivedBytes, content.length);
    assert.deepEqual(
      [...retained.body.received].sort((a, b) => a - b),
      [0, 1, 2]
    );
    console.log("PASS: failed completion preserves session and all confirmed chunks.");

    const completed = await request(
      sessionPath + "/complete",
      jsonOptions({})
    );

    assert.equal(completed.status, 201, JSON.stringify(completed.body));
    assert.equal(completed.body.id, stableRecordId);
    assert.equal(committedRecordIds.length, 2);
    assert.equal(committedRecordIds[1], stableRecordId);
    console.log("PASS: retry returns the same stable record ID without creating a new ID.");
    console.log("PASS: assembled bytes match the original file.");

    const after = await request(sessionPath, {
      headers: {
        Authorization: "Bearer isolated-test-token"
      }
    });
    assert.equal(after.status, 404);
    console.log("PASS: completed session cleanup.");

    console.log("\nALL UPLOAD CHUNK SELF-TESTS PASSED.");
  } catch (error) {
    console.error("UPLOAD SELF-TEST FAILED:", error.stack || error);
    process.exitCode = 1;
  } finally {
    if (server?.listening) {
      if (uploadId) {
        try {
          await request(
            `/api/records/media/chunk/${encodeURIComponent(uploadId)}`,
            {
              method: "DELETE",
              headers: {
                Authorization: "Bearer isolated-test-token"
              }
            }
          );
        } catch (_) {}
      }

      await new Promise(resolve => server.close(resolve));
    }

    fs.rmSync(isolatedTemp, { recursive: true, force: true });
  }
})();
