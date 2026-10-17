'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SignedMediaUrlCache, DEFAULT_TTL_MS, DEFAULT_MAX_ENTRIES } = require('../backend/services/signedMediaUrlCache');

test('reuses an unexpired signed URL and expires it at the soft TTL', () => {
  let now = 1000; const cache = new SignedMediaUrlCache({ ttlMs: 100, maxEntries: 4, now: () => now });
  const stored = cache.set('reader-a:record-1', 'https://storage.example/object?token=one');
  assert.equal(stored.expiresAt, 1100); assert.equal(cache.get('reader-a:record-1').url, 'https://storage.example/object?token=one');
  now = 1100; assert.equal(cache.get('reader-a:record-1'), null); assert.equal(cache.size, 0);
});

test('keeps readers and object versions isolated by caller-provided cache key', () => {
  const cache = new SignedMediaUrlCache({ ttlMs: 1000, maxEntries: 4, now: () => 1000 });
  cache.set('reader-a:record-1:hash-a', 'https://storage.example/object?token=a');
  cache.set('reader-b:record-1:hash-a', 'https://storage.example/object?token=b');
  cache.set('reader-a:record-1:hash-b', 'https://storage.example/object?token=c');
  assert.equal(cache.get('reader-a:record-1:hash-a').url, 'https://storage.example/object?token=a');
  assert.equal(cache.get('reader-b:record-1:hash-a').url, 'https://storage.example/object?token=b');
  assert.equal(cache.get('reader-a:record-1:hash-b').url, 'https://storage.example/object?token=c');
});

test('evicts the least recently used entry when full', () => {
  const cache = new SignedMediaUrlCache({ ttlMs: 1000, maxEntries: 2, now: () => 1000 });
  cache.set('a', 'https://storage.example/a?token=a'); cache.set('b', 'https://storage.example/b?token=b'); assert.ok(cache.get('a'));
  cache.set('c', 'https://storage.example/c?token=c'); assert.equal(cache.get('b'), null); assert.ok(cache.get('a')); assert.ok(cache.get('c')); assert.equal(cache.size, 2);
});

test('caps caller TTL and rejects invalid URLs', () => {
  let now = 500; const cache = new SignedMediaUrlCache({ ttlMs: 50, maxEntries: 4, now: () => now });
  const entry = cache.set('safe', 'https://storage.example/video?token=safe', 10000); assert.equal(entry.expiresAt, 550);
  assert.equal(cache.set('empty', '', 10), null); assert.equal(cache.set('invalid', 'javascript:alert(1)', 10), null);
  assert.equal(cache.set('bad-ttl', 'https://storage.example/x?token=x', 0), null); assert.equal(cache.size, 1);
  now += 51; assert.equal(cache.get('safe'), null);
});

test('defaults remain bounded and shorter than one-hour signed URLs', () => {
  assert.ok(DEFAULT_TTL_MS > 0 && DEFAULT_TTL_MS < 60 * 60 * 1000); assert.ok(DEFAULT_MAX_ENTRIES > 0);
  const cache = new SignedMediaUrlCache({ maxEntries: 3 });
  for (let i = 0; i < 5; i++) cache.set('k' + i, 'https://storage.example/' + i + '?token=' + i); assert.equal(cache.size, 3);
});
