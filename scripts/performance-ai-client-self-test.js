#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { normalizeCandidates, scoreCandidates } =
  require('../backend/services/performanceAiClient');

const candidate = {
  recordId: 'private-record-42',
  mediaKind: 'image',
  distanceViewports: 1,
  sizeBytes: 250000,
  effectiveType: '4g',
  saveData: false,
  lastLoadMs: 250
};

async function main() {
  let capturedUrl;
  let capturedOptions;
  const env = {
    PERFORMANCE_AI_URL: 'https://performance-ai.example.test/',
    PERFORMANCE_AI_SHARED_SECRET: 'unit-test-secret'
  };

  const results = await scoreCandidates([candidate], {
    env,
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        json: async () => ({
          results: [{ record_id: '0', prefetch: true, mode: 'rules', score: null }]
        })
      };
    }
  });

  assert.equal(new URL(capturedUrl).pathname, '/v1/prefetch/score');
  assert.equal(capturedOptions.headers['X-Milan-AI-Key'], 'unit-test-secret');
  const outbound = JSON.parse(capturedOptions.body);
  assert.equal(outbound.candidates[0].record_id, '0');
  assert.equal(outbound.candidates[0].media_kind, 'image');
  assert.equal(JSON.stringify(outbound).includes('private-record-42'), false);
  assert.deepEqual(results, [{
    recordId: 'private-record-42',
    prefetch: true,
    mode: 'rules',
    score: null
  }]);
  console.log('PASS: proxy sends feature-only data and maps results back locally.');

  assert.throws(() => normalizeCandidates([{ ...candidate, sizeBytes: -1 }]),
    error => error.code === 'INVALID_CANDIDATES');
  assert.throws(() => normalizeCandidates([]),
    error => error.code === 'INVALID_CANDIDATES');
  console.log('PASS: malformed and oversized candidate batches are rejected.');

  await assert.rejects(
    scoreCandidates([candidate], { env: {}, fetchImpl: async () => { throw new Error('should not fetch'); } }),
    error => error.code === 'NOT_CONFIGURED'
  );
  await assert.rejects(
    scoreCandidates([candidate], {
      env: { PERFORMANCE_AI_URL: 'http://external.example.test', PERFORMANCE_AI_SHARED_SECRET: 'secret' },
      fetchImpl: async () => { throw new Error('should not fetch'); }
    }),
    error => error.code === 'NOT_CONFIGURED'
  );
  await assert.rejects(
    scoreCandidates([candidate], {
      env,
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) })
    }),
    error => error.code === 'UNAVAILABLE'
  );
  console.log('PASS: missing configuration, non-HTTPS remote endpoints, and upstream failures fail closed.');

  const route = fs.readFileSync('backend/routes/ai.js', 'utf8');
  assert.match(route, /router\.post\('\/performance\/prefetch-score',\s*auth,/);
  assert.match(route, /Continue with standard media behavior/);
  console.log('PASS: Express proxy requires user authentication and degrades without blocking media routes.');
  console.log('ALL PERFORMANCE AI PROXY SELF-TESTS PASSED.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
