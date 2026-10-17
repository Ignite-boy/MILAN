'use strict';

const DEFAULT_TTL_MS = 50 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;

// Bounded in-memory signed-URL cache. The caller must authorize each read before lookup.
class SignedMediaUrlCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = Date.now } = {}) {
    this.ttlMs = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL_MS;
    this.maxEntries = Number.isInteger(Number(maxEntries)) && Number(maxEntries) > 0 ? Number(maxEntries) : DEFAULT_MAX_ENTRIES;
    this.now = typeof now === 'function' ? now : Date.now;
    this.entries = new Map();
  }

  get(key) {
    const normalizedKey = String(key || '');
    if (!normalizedKey) return null;
    const entry = this.entries.get(normalizedKey);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) { this.entries.delete(normalizedKey); return null; }
    this.entries.delete(normalizedKey);
    this.entries.set(normalizedKey, entry);
    return { url: entry.url, expiresAt: entry.expiresAt };
  }

  set(key, url, ttlMs = this.ttlMs) {
    const normalizedKey = String(key || '');
    const normalizedUrl = String(url || '');
    const requestedTtl = Number(ttlMs);
    if (!normalizedKey || !normalizedUrl || !Number.isFinite(requestedTtl) || requestedTtl <= 0) return null;
    try { const parsed = new URL(normalizedUrl); if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null; } catch (_) { return null; }
    const safeTtl = Math.min(this.ttlMs, requestedTtl);
    const entry = { url: normalizedUrl, expiresAt: this.now() + safeTtl };
    this.entries.delete(normalizedKey);
    this.entries.set(normalizedKey, entry);
    while (this.entries.size > this.maxEntries) { const oldestKey = this.entries.keys().next().value; if (oldestKey === undefined) break; this.entries.delete(oldestKey); }
    return { url: entry.url, expiresAt: entry.expiresAt };
  }

  delete(key) { return this.entries.delete(String(key || '')); }
  clear() { this.entries.clear(); }
  get size() { return this.entries.size; }
}

const signedMediaUrlCache = new SignedMediaUrlCache();

module.exports = { SignedMediaUrlCache, signedMediaUrlCache, DEFAULT_TTL_MS, DEFAULT_MAX_ENTRIES };
