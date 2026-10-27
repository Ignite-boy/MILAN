// Server-side bridge to the separately deployed MILAN performance AI service.
'use strict';

const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'other']);
const NETWORK_TYPES = new Set(['slow-2g', '2g', '3g', '4g', 'wifi', 'unknown']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeCandidates(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
    throw fail('INVALID_CANDIDATES', 'Provide between 1 and 100 candidates.');
  }

  return input.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw fail('INVALID_CANDIDATES', 'Each candidate must be an object.');
    }

    const recordId = typeof item.recordId === 'string' ? item.recordId.trim() : '';
    if (!recordId || recordId.length > 256) {
      throw fail('INVALID_CANDIDATES', 'Each candidate needs a valid recordId.');
    }

    const mediaKind = item.mediaKind ?? 'other';
    const effectiveType = item.effectiveType ?? 'unknown';
    const distance = Number(item.distanceViewports ?? 0);
    const size = Number(item.sizeBytes ?? 0);
    const loadMs = Number(item.lastLoadMs ?? 0);
    const saveData = item.saveData ?? false;

    if (!MEDIA_KINDS.has(mediaKind) || !NETWORK_TYPES.has(effectiveType) ||
        !Number.isFinite(distance) || distance < 0 || distance > 10 ||
        !Number.isSafeInteger(size) || size < 0 || size > 1073741824 ||
        !Number.isFinite(loadMs) || loadMs < 0 || loadMs > 120000 ||
        typeof saveData !== 'boolean') {
      throw fail('INVALID_CANDIDATES', 'Candidate performance metadata is invalid.');
    }

    // The actual record ID is deliberately not sent to the AI service.
    return {
      recordId,
      features: {
        media_kind: mediaKind,
        distance_viewports: distance,
        size_bytes: size,
        effective_type: effectiveType,
        save_data: saveData,
        last_load_ms: loadMs
      }
    };
  });
}

async function scoreCandidates(input, options = {}) {
  const candidates = normalizeCandidates(input);
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const base = String(env.PERFORMANCE_AI_URL || '').trim().replace(/\/+$/, '');
  const secret = String(env.PERFORMANCE_AI_SHARED_SECRET || '').trim();

  if (!base || !secret) {
    throw fail('NOT_CONFIGURED', 'Performance AI service is not configured.');
  }

  let endpoint;
  try {
    endpoint = new URL('/v1/prefetch/score', base);
    if (endpoint.username || endpoint.password) throw new Error('Credentials in URL are not allowed.');
    const localHttp = endpoint.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' && !localHttp) {
      throw new Error('HTTPS is required for non-local AI endpoints.');
    }
  } catch (_) {
    throw fail('NOT_CONFIGURED', 'Performance AI endpoint configuration is invalid.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  if (typeof timer.unref === 'function') timer.unref();

  try {
    const response = await fetchImpl(endpoint.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Milan-AI-Key': secret
      },
      body: JSON.stringify({
        candidates: candidates.map((candidate, index) => ({
          record_id: String(index),
          ...candidate.features
        }))
      }),
      signal: controller.signal
    });

    if (!response.ok) throw fail('UNAVAILABLE', 'Performance AI returned an unsuccessful response.');

    let payload;
    try {
      payload = await response.json();
    } catch (_) {
      throw fail('UNAVAILABLE', 'Performance AI returned invalid JSON.');
    }

    if (!payload || !Array.isArray(payload.results) ||
        payload.results.length !== candidates.length) {
      throw fail('UNAVAILABLE', 'Performance AI returned an invalid result set.');
    }

    return payload.results.map((result, index) => {
      if (!result || result.record_id !== String(index) ||
          typeof result.prefetch !== 'boolean' ||
          !['rules', 'neural'].includes(result.mode) ||
          !(result.score === null || (typeof result.score === 'number' && Number.isFinite(result.score)))) {
        throw fail('UNAVAILABLE', 'Performance AI returned an invalid prediction.');
      }
      return {
        recordId: candidates[index].recordId,
        prefetch: result.prefetch,
        mode: result.mode,
        score: result.score
      };
    });
  } catch (error) {
    if (error && error.code) throw error;
    throw fail('UNAVAILABLE', 'Performance AI is unavailable or timed out.');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { normalizeCandidates, scoreCandidates };
