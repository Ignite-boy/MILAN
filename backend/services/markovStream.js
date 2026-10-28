// ============================================================
// Predictive streaming: bounded Markov fallback + optional GRU service.
// ============================================================
'use strict';

const WINDOW = 5;
const TOP_N = 3;
const DECAY = 0.92;
const MAX_ACTIVE_USERS = 250;
const MAX_SOURCE_CIDS_PER_USER = 100;
const MAX_TARGETS_PER_SOURCE = 10;

class MarkovPredictor {
  constructor() {
    this.transitions = Object.create(null);
    this.userSequence = Object.create(null);
  }

  record(userId, contentCid) {
    if (userId === undefined || userId === null ||
        contentCid === undefined || contentCid === null) return;

    userId = String(userId).trim();
    contentCid = String(contentCid).trim();
    const invalid = value => !value || value.length > 256 ||
      /[\u0000-\u001f]/.test(value);
    if (invalid(userId) || invalid(contentCid)) return;

    if (!Object.prototype.hasOwnProperty.call(this.userSequence, userId)) {
      const activeUsers = Object.keys(this.userSequence);
      if (activeUsers.length >= MAX_ACTIVE_USERS) {
        const evictedUser = activeUsers[0];
        delete this.userSequence[evictedUser];
        delete this.transitions[evictedUser];
      }
      this.userSequence[userId] = [];
      this.transitions[userId] = Object.create(null);
    } else {
      const existingSequence = this.userSequence[userId];
      delete this.userSequence[userId];
      this.userSequence[userId] = existingSequence;
    }

    const sequence = this.userSequence[userId];
    const transitions = this.transitions[userId];
    if (sequence.length > 0) {
      const previous = sequence[sequence.length - 1];
      if (!Object.prototype.hasOwnProperty.call(transitions, previous)) {
        const sources = Object.keys(transitions);
        if (sources.length >= MAX_SOURCE_CIDS_PER_USER) delete transitions[sources[0]];
        transitions[previous] = Object.create(null);
      }
      const destinations = transitions[previous];
      if (!Object.prototype.hasOwnProperty.call(destinations, contentCid)) {
        const targets = Object.keys(destinations);
        if (targets.length >= MAX_TARGETS_PER_SOURCE) delete destinations[targets[0]];
        destinations[contentCid] = 0;
      }
      destinations[contentCid] += 1;
    }

    sequence.push(contentCid);
    if (sequence.length > WINDOW) sequence.shift();
  }

  predict(userId) {
    const key = String(userId || '').trim();
    const sequence = this.userSequence[key];
    if (!sequence || sequence.length === 0) return [];
    const last = sequence[sequence.length - 1];
    const destinations = this.transitions[key] && this.transitions[key][last];
    if (!destinations) return [];
    return Object.entries(destinations)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([cid]) => cid);
  }

  decay() {
    for (const userId of Object.keys(this.transitions)) {
      const sources = this.transitions[userId];
      for (const from of Object.keys(sources)) {
        const destinations = sources[from];
        for (const to of Object.keys(destinations)) {
          destinations[to] *= DECAY;
          if (destinations[to] < 0.01) delete destinations[to];
        }
        if (Object.keys(destinations).length === 0) delete sources[from];
      }
    }
  }
}

const predictor = new MarkovPredictor();
const decayTimer = setInterval(() => predictor.decay(), 10 * 60 * 1000);
if (typeof decayTimer.unref === 'function') decayTimer.unref();

const AI_SERVICE_URL = (
  process.env.MILAN_WEB4_AI_URL || 'http://127.0.0.1:8787'
).replace(/\/+$/, '');
const AI_SHARED_SECRET = process.env.MILAN_WEB4_AI_SECRET || '';
const AI_REQUEST_TIMEOUT_MS = 350;

async function requestWeb4Ai(path, payload) {
  if (!AI_SHARED_SECRET || typeof fetch !== 'function') return null;
  try {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Milan-AI-Key': AI_SHARED_SECRET
      },
      body: JSON.stringify(payload)
    };
    if (typeof AbortSignal !== 'undefined' &&
        typeof AbortSignal.timeout === 'function') {
      options.signal = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
    }
    const response = await fetch(AI_SERVICE_URL + path, options);
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    // AI is optional; service downtime must not break the feed.
    return null;
  }
}

function recordAiView(userId, recordId) {
  void requestWeb4Ai('/internal/v1/view', { user_id: userId, record_id: recordId });
}

async function recordView(req, res) {
  try {
    const userId = String(req.userId || '').trim();
    const rawCid = req.body && req.body.contentCid;
    const contentCid = typeof rawCid === 'string' ? rawCid.trim() : '';
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    if (!contentCid || contentCid.length > 256 ||
        /[\u0000-\u001f]/.test(contentCid)) {
      return res.status(400).json({ error: 'Valid contentCid required' });
    }
    predictor.record(userId, contentCid);
    recordAiView(userId, contentCid);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[MILAN STREAM] record view failed:', error.message);
    return res.status(500).json({ error: 'Could not record stream view' });
  }
}

async function getPrefetch(req, res) {
  try {
    const userId = String(req.userId || '').trim();
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    // Only predict among candidate record IDs supplied by the rendered feed.
    const rawCandidates = req.query && req.query.candidateId;
    res.setHeader('Cache-Control', 'private, no-store');
    if (rawCandidates === undefined) return res.json({ prefetch: [] });

    const values = Array.isArray(rawCandidates) ? rawCandidates : [rawCandidates];
    const allowed = new Set(values.slice(0, 40)
      .filter(value => typeof value === 'string')
      .map(value => value.trim())
      .filter(value => value.length > 0 && value.length <= 256 &&
        !/[\u0000-\u001f]/.test(value)));

    const markovIds = predictor.predict(userId);
    const aiResult = await requestWeb4Ai('/internal/v1/predict', {
      user_id: userId, top_k: TOP_N
    });
    const aiIds = aiResult && aiResult.model_ready &&
      Array.isArray(aiResult.predictions)
      ? aiResult.predictions
          .map(item => item && item.record_id)
          .filter(id => typeof id === 'string' && id.length > 0 &&
            id.length <= 256 && !/[\u0000-\u001f]/.test(id))
      : [];

    const recordIds = [...new Set([...aiIds, ...markovIds])]
      .filter(id => allowed.has(id))
      .slice(0, TOP_N);
    return res.json({ prefetch: recordIds.map(recordId => ({ recordId })) });
  } catch (error) {
    console.error('[MILAN STREAM] prefetch failed:', error.message);
    return res.status(500).json({ error: 'Could not predict next content' });
  }
}

module.exports = { predictor, recordView, getPrefetch };
