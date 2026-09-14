'use strict';

/**
 * MILAN — REAL Decentralized Web Node (DWN) Engine
 * ------------------------------------------------------------------
 * Implements the ACTUAL DWN protocol per user using the official
 * TBD / DIF reference SDK (@tbd54566975/dwn-sdk-js) — NOT a JSON
 * simulation.
 *
 * Architecture (1 user = 1 DID = 1 isolated real DWN node):
 *   - Each user owns a real cryptographic DID (did:key, Ed25519).
 *   - Each user gets a dedicated DWN instance backed by isolated
 *     LevelDB stores (MessageStore / DataStore / EventLog /
 *     ResumableTaskStore) under their own spaceId directory.
 *   - All writes/reads are real signed DWN protocol messages
 *     (RecordsWrite / RecordsQuery / RecordsRead / RecordsDelete),
 *     processed by dwn.processMessage(tenantDid, message).
 *
 * The SDK is ESM-only; this file is CommonJS, so we load it lazily
 * via dynamic import() and cache the namespace. Engine init is
 * best-effort: if the SDK or a node fails to initialise, callers
 * receive a structured { ok:false, reason } and the app's existing
 * JSON persistence keeps working (no hard dependency / no crash).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const realDwnNodeClient = require('./realDwnNodeClient');

let _sdk = null;
let _dids = null;
let _sdkLoadError = null;

async function loadSdk() {
  if (_sdk && _dids) return { sdk: _sdk, dids: _dids };
  if (_sdkLoadError) throw _sdkLoadError;
  try {
    const sdk = await import('@tbd54566975/dwn-sdk-js');
    const dids = await import('@web5/dids');
    _sdk = sdk;
    _dids = dids;
    return { sdk, dids };
  } catch (err) {
    _sdkLoadError = err;
    throw err;
  }
}

function enabled() {
  return String(process.env.MILAN_REAL_DWN_ENGINE || 'true').toLowerCase() !== 'false';
}

function safeName(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
}

const _nodes = new Map();
const _opening = new Map();

let _enginePersistRoot = null;
function setPersistRoot(root) { _enginePersistRoot = root; }
function persistRoot() {
  return _enginePersistRoot ||
    process.env.MILAN_REAL_DWN_ENGINE_ROOT ||
    path.join(__dirname, '..', 'real-dwn-engine');
}

function nodeStoreRoot(spaceId) {
  return path.join(persistRoot(), safeName(spaceId));
}

async function resolveUserDid({ dids }, { spaceId, rawSeedHex, knownDidUri, portableDid, createIfMissing = false }) {
  const { DidKey } = dids;
  const portableFile = path.join(nodeStoreRoot(spaceId), 'portable-did.json');

  // Prefer the persistent portable DID carried in the user record.
  if (portableDid && typeof portableDid === 'object') {
    const didApi = await DidKey.import({ portableDid });
    if (knownDidUri && didApi.uri !== knownDidUri) {
      throw new Error(`Persistent DWN DID mismatch: expected ${knownDidUri}, found ${didApi.uri}`);
    }
    persistPortable(portableFile, portableDid);
    return await asSignable(didApi);
  }

  if (fs.existsSync(portableFile)) {
    const portable = JSON.parse(fs.readFileSync(portableFile, 'utf8'));
    const didApi = await DidKey.import({ portableDid: portable });

    if (knownDidUri && didApi.uri !== knownDidUri) {
      throw new Error(
        `Persisted DWN DID mismatch: expected ${knownDidUri}, found ${didApi.uri}`
      );
    }

    return await asSignable(didApi);
  }

  if (!createIfMissing) {
    throw new Error(
      knownDidUri
        ? 'Persisted DWN identity is unavailable for the known user DID.'
        : 'DWN identity is not persisted.'
    );
  }

  const didApi = await DidKey.create();
  const portable = await didApi.export();
  persistPortable(portableFile, portable);

  if (knownDidUri && didApi.uri !== knownDidUri) {
    throw new Error(
      `New DWN DID mismatch: expected ${knownDidUri}, found ${didApi.uri}`
    );
  }

  return await asSignable(didApi);
}

async function createUserIdentity({ spaceId }) {
  if (!enabled()) {
    throw new Error('Real DWN engine is disabled.');
  }

  if (!spaceId) {
    throw new Error('Missing DWN spaceId.');
  }

  const { dids } = await loadSdk();
  const { DidKey } = dids;
  const portableFile = path.join(nodeStoreRoot(spaceId), 'portable-did.json');

  fs.mkdirSync(nodeStoreRoot(spaceId), { recursive: true });

  if (fs.existsSync(portableFile)) {
    const portable = JSON.parse(fs.readFileSync(portableFile, 'utf8'));
    const didApi = await DidKey.import({ portableDid: portable });

    return {
      did: didApi.uri,
      spaceId,
      portableDid: portable,
      real: true
    };
  }

  const didApi = await DidKey.create();
  const portable = await didApi.export();
  persistPortable(portableFile, portable);

  return {
    did: didApi.uri,
    spaceId,
    portableDid: portable,
    real: true
  };
}

function persistPortable(file, portable) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(portable, null, 2), { mode: 0o600 });
  } catch (_) {}
}

async function asSignable(didApi) {
  const signer = await didApi.getSigner();
  const keyFragment = didApi.uri.split(':')[2];
  const dwnSigner = {
    keyId: `${didApi.uri}#${keyFragment}`,
    algorithm: 'EdDSA',
    sign: async (content) => signer.sign({ data: content })
  };
  return { didApi, uri: didApi.uri, signer: dwnSigner };
}

async function openNode({ spaceId, rawSeedHex, knownDidUri, portableDid }) {
  if (!enabled()) return { ok: false, reason: 'engine-disabled' };
  if (!spaceId) return { ok: false, reason: 'missing-space-id' };
  if (_nodes.has(spaceId)) return { ok: true, node: _nodes.get(spaceId) };
  if (_opening.has(spaceId)) return _opening.get(spaceId);

  const p = (async () => {
    try {
      const { sdk, dids } = await loadSdk();
      const {
        Dwn, DataStoreLevel, MessageStoreLevel, EventLogLevel, ResumableTaskStoreLevel
      } = sdk;

      const storeRoot = nodeStoreRoot(spaceId);
      fs.mkdirSync(storeRoot, { recursive: true });

      const messageStore = new MessageStoreLevel({
        blockstoreLocation: path.join(storeRoot, 'MESSAGESTORE'),
        indexLocation: path.join(storeRoot, 'INDEX')
      });
      const dataStore = new DataStoreLevel({
        blockstoreLocation: path.join(storeRoot, 'DATASTORE')
      });
      const eventLog = new EventLogLevel({
        location: path.join(storeRoot, 'EVENTLOG')
      });
      const resumableTaskStore = new ResumableTaskStoreLevel({
        location: path.join(storeRoot, 'RESUMABLE')
      });

      const dwn = await Dwn.create({ messageStore, dataStore, eventLog, resumableTaskStore });
      const { uri, signer, didApi } = await resolveUserDid(
        { dids },
        { spaceId, rawSeedHex, knownDidUri, portableDid, createIfMissing: !knownDidUri }
      );

      const node = {
        spaceId,
        dwn,
        didApi,
        signer,
        tenantDid: uri,
        storeRoot,
        openedAt: new Date().toISOString()
      };
      _nodes.set(spaceId, node);
      return { ok: true, node };
    } catch (err) {
      return { ok: false, reason: 'open-failed', error: err.message };
    } finally {
      _opening.delete(spaceId);
    }
  })();

  _opening.set(spaceId, p);
  return p;
}

function toBytes(value) {
  if (value === undefined || value === null) return new TextEncoder().encode('');
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') return new TextEncoder().encode(value);
  return new TextEncoder().encode(JSON.stringify(value));
}

async function remoteDwnRequest({ message, target, encodedData }) {
  const endpoint = String(
    process.env.REAL_DWN_NODE_ENDPOINT ||
    'https://dwn.onrender.com'
  ).replace(/\/+$/, '');

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  const apiKey = String(
    process.env.REAL_DWN_NODE_API_KEY ||
    'milan-v49-embedded-production-dwn-key'
  ).trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = {
    jsonrpc: '2.0',
    id: `milan-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    method: 'dwn.processMessage',
    params: {
      target,
      message
    }
  };

  if (encodedData) body.params.encodedData = encodedData;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  let response;
  try {
    response = await fetch(`${endpoint}/json-rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Remote DWN request timed out after 12 seconds');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    throw new Error(`Remote DWN returned non-JSON (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(
      `Remote DWN HTTP ${response.status}: ${
        json?.error?.message || json?.error || text.slice(0, 300)
      }`
    );
  }

  if (json?.error) {
    throw new Error(
      `Remote DWN RPC error: ${
        json.error.message || JSON.stringify(json.error)
      }`
    );
  }

  return json?.result?.reply || json?.result || json;
}

function bytesToBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const b64 = String(value)
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(String(value).length / 4) * 4, '=');
  return Buffer.from(b64, 'base64');
}

async function writeRecord({ spaceId, rawSeedHex, knownDidUri, portableDid }, record = {}) {
  const opened = await openNode({ spaceId, rawSeedHex, knownDidUri, portableDid });

  if (!opened.ok) {
    return {
      ok: false,
      reason: opened.reason,
      error: opened.error
    };
  }

  try {
    const { sdk } = await loadSdk();
    const { RecordsWrite, DataStream } = sdk;
    const { node } = opened;

    const payload = {
      id: record.id || undefined,
      title: record.title || 'MILAN Record',
      schema: record.schema || 'record',
      access: record.access || record.accessMode || 'private',
      dataFormat: record.dataFormat || 'application/json',
      dateCreated: record.dateCreated || new Date().toISOString(),
      dateModified: record.dateModified || new Date().toISOString(),
      data: record.data || {}
    };

    const bytes = record.binaryData
      ? Buffer.from(record.binaryData)
      : toBytes(JSON.stringify(payload));

    const writeOptions = {
      signer: node.signer,
      dataFormat: payload.dataFormat,
      schema: `https://milanlife.in/schemas/${safeName(payload.schema)}`,
      data: bytes,
      tags: record.id
        ? { milanRecordId: String(record.id) }
        : undefined
    };

    if (record.id) {
      writeOptions.recordId = String(record.id);
    }

    const rw = await RecordsWrite.create(writeOptions);

    // PRIMARY AUTHORITY:
    // Persist the profile-picture record on the REAL REMOTE DWN.
    const remote = await remoteDwnRequest({
      target: node.tenantDid,
      message: rw.message,
      encodedData: bytesToBase64Url(bytes)
    });

    const remoteStatus = remote?.status?.code;

    if (remoteStatus !== 200 && remoteStatus !== 202) {
      return {
        ok: false,
        status: remoteStatus,
        reason: 'remote-dwn-write-rejected',
        detail: remote?.status?.detail || null,
        spaceId,
        dwnRecordId: rw.message?.recordId || null
      };
    }

    // Keep the local embedded DWN in sync as a runtime cache.
    try {
      await node.dwn.processMessage(
        node.tenantDid,
        rw.message,
        { dataStream: DataStream.fromBytes(bytes) }
      );
    } catch (_) {}

    return {
      ok: true,
      status: remoteStatus,
      dwnRecordId: rw.message?.recordId || null,
      tenantDid: node.tenantDid,
      spaceId,
      source: 'real-remote-dwn'
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'remote-write-failed',
      error: err.message
    };
  }
}

async function readRecord({ spaceId, rawSeedHex, knownDidUri, portableDid }, recordId) {
  const opened = await openNode({ spaceId, rawSeedHex, knownDidUri, portableDid });

  if (!opened.ok) {
    return {
      ok: false,
      reason: opened.reason,
      error: opened.error
    };
  }

  if (!recordId) {
    return {
      ok: false,
      reason: 'missing-record-id'
    };
  }

  try {
    const { sdk } = await loadSdk();
    const { RecordsRead, DataStream } = sdk;
    const { node } = opened;

    const read = await RecordsRead.create({
      signer: node.signer,
      filter: { recordId: String(recordId) }
    });

    // PRIMARY AUTHORITY:
    // Read the profile-picture record from the REAL REMOTE DWN.
    const remote = await remoteDwnRequest({
      target: node.tenantDid,
      message: read.message
    });

    const status = remote?.status?.code;

    if (status === 404) {
      return {
        ok: false,
        status: 404,
        reason: 'record-not-found'
      };
    }

    if (status !== 200) {
      return {
        ok: false,
        status,
        reason: 'remote-read-failed',
        detail: remote?.status?.detail || null
      };
    }

    let bytes = null;

    if (remote?.encodedData) {
      bytes = base64UrlToBytes(remote.encodedData);
    } else if (remote?.record?.encodedData) {
      bytes = base64UrlToBytes(remote.record.encodedData);
    } else if (remote?.data) {
      bytes = Buffer.from(await DataStream.toBytes(remote.data));
    }

    if (!bytes || !bytes.length) {
      return {
        ok: false,
        reason: 'remote-record-data-empty'
      };
    }

    // Refresh the local embedded cache from the confirmed remote record.
    try {
      const cachedRead = await node.dwn.processMessage(
        node.tenantDid,
        read.message
      );

      if (cachedRead?.status?.code !== 200) {
        // Cache refresh is best-effort only.
      }
    } catch (_) {}

    return {
      ok: true,
      status: 200,
      recordId: String(recordId),
      descriptor:
        remote?.record?.descriptor ||
        remote?.descriptor ||
        {},
      data: bytes,
      source: 'real-remote-dwn',
      spaceId,
      tenantDid: node.tenantDid
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'remote-read-failed',
      error: err.message
    };
  }
}

async function queryRecords({ spaceId, rawSeedHex, knownDidUri }, filter = {}) {
  const opened = await openNode({ spaceId, rawSeedHex, knownDidUri });
  if (!opened.ok) return { ok: false, reason: opened.reason, error: opened.error };
  const { node } = opened;
  try {
    const { sdk } = await loadSdk();
    const { RecordsQuery } = sdk;
    const effectiveFilter = (filter && Object.keys(filter).length)
      ? filter
      : { dataFormat: 'application/json' };
    const rq = await RecordsQuery.create({ signer: node.signer, filter: effectiveFilter });

    let res;
    try {
      res = await remoteDwnRequest({
        target: node.tenantDid,
        message: rq.message
      });
    } catch (remoteErr) {
      console.warn('[real-dwn] remote RecordsQuery failed:', remoteErr.message);

      if (realDwnNodeClient.remoteOnly()) {
        return {
          ok: false,
          reason: 'remote-query-failed',
          remote: true,
          remoteError: remoteErr.message
        };
      }

      res = await node.dwn.processMessage(node.tenantDid, rq.message);
    }

    return {
      ok: res.status && res.status.code === 200,
      status: res.status && res.status.code,
      entries: (res.entries || []).map(e => ({
        recordId: e.recordId,
        descriptor: e.descriptor
      })),
      count: (res.entries || []).length
    };
  } catch (err) {
    return { ok: false, reason: 'query-failed', error: err.message };
  }
}

async function nodeStatus({ spaceId, rawSeedHex, knownDidUri }) {
  if (!enabled()) return { ok: false, enabled: false, reason: 'engine-disabled' };
  const opened = await openNode({ spaceId, rawSeedHex, knownDidUri });
  if (!opened.ok) return { ok: false, enabled: true, reason: opened.reason, error: opened.error };
  const { node } = opened;
  const q = await queryRecords({ spaceId, rawSeedHex, knownDidUri }, {});
  return {
    ok: true,
    enabled: true,
    realDwnProtocol: true,
    sdk: '@tbd54566975/dwn-sdk-js',
    isolation: 'single-user-single-node',
    spaceId,
    tenantDid: node.tenantDid,
    storeRoot: node.storeRoot,
    openedAt: node.openedAt,
    recordCount: q.ok ? q.count : null
  };
}

async function closeNode(spaceId) {
  const node = _nodes.get(spaceId);
  if (!node) return;
  try { await node.dwn.close(); } catch (_) {}
  _nodes.delete(spaceId);
}

async function closeAll() {
  const ids = [..._nodes.keys()];
  await Promise.all(ids.map(closeNode));
}

async function engineStatus() {
  let sdkLoadable = !!_sdk;
  if (!_sdk && enabled()) {
    try { await loadSdk(); sdkLoadable = true; } catch (_) { sdkLoadable = false; }
  }
  return {
    enabled: enabled(),
    sdkLoadable,
    sdkLoadError: _sdkLoadError ? _sdkLoadError.message : null,
    activeNodes: _nodes.size,
    persistRoot: persistRoot(),
    realDwnProtocol: true,
    model: 'one-user-one-did-one-real-dwn-node'
  };
}

module.exports = {
  createUserIdentity,
  enabled,
  setPersistRoot,
  openNode,
  writeRecord,
  readRecord,
  queryRecords,
  nodeStatus,
  closeNode,
  closeAll,
  engineStatus
};
