// ============================================================
// FEATURE 1: Predictive Media Streaming via Markov Chains
// File: milan-app/backend/services/markovStream.js
// ============================================================
'use strict';

/**
 * Markov Chain based prefetch predictor.
 * Tracks user scroll/view patterns and predicts next content CIDs
 * to pre-cache from IPFS/Arweave before user reaches them.
 */

const WINDOW = 5;          // how many items to track in sequence
const TOP_N  = 3;          // how many next items to prefetch
const DECAY  = 0.92;
const MAX_ACTIVE_USERS = 250;
const MAX_SOURCE_CIDS_PER_USER = 100;
const MAX_TARGETS_PER_SOURCE = 10;       // older transitions lose weight over time

class MarkovPredictor {
  constructor() {
    // transitions[userId][fromCid][toCid] = weight
    this.transitions = Object.create(null);
    // Keep a bounded recent sequence for each active user.
    this.userSequence = Object.create(null);
  }

  record(userId, contentCid) {
    if (userId === undefined || userId === null ||
        contentCid === undefined || contentCid === null) return;

    userId = String(userId).trim();
    contentCid = String(contentCid).trim();

    if (!userId || userId.length > 256 ||
        !contentCid || contentCid.length > 256 ||
        /[\u0000-\u001f]/.test(userId) ||
        /[\u0000-\u001f]/.test(contentCid)) return;

    if (!Object.prototype.hasOwnProperty.call(this.userSequence, userId)) {
      const activeUsers = Object.keys(this.userSequence);

      // Evict the oldest active entry when the user-state cap is reached.
      if (activeUsers.length >= MAX_ACTIVE_USERS) {
        const evictedUser = activeUsers[0];
        delete this.userSequence[evictedUser];
        delete this.transitions[evictedUser];
      }

      this.userSequence[userId] = [];
      this.transitions[userId] = Object.create(null);
    } else {
      // Move this user's sequence to the newest position for eviction order.
      const existingSequence = this.userSequence[userId];
      delete this.userSequence[userId];
      this.userSequence[userId] = existingSequence;
    }

    const seq = this.userSequence[userId];
    const userTransitions = this.transitions[userId];

    if (seq.length > 0) {
      const prev = seq[seq.length - 1];

      if (!Object.prototype.hasOwnProperty.call(userTransitions, prev)) {
        const sources = Object.keys(userTransitions);
        if (sources.length >= MAX_SOURCE_CIDS_PER_USER) {
          delete userTransitions[sources[0]];
        }
        userTransitions[prev] = Object.create(null);
      }

      const destinations = userTransitions[prev];

      if (!Object.prototype.hasOwnProperty.call(destinations, contentCid)) {
        const targets = Object.keys(destinations);
        if (targets.length >= MAX_TARGETS_PER_SOURCE) {
          delete destinations[targets[0]];
        }
        destinations[contentCid] = 0;
      }

      destinations[contentCid] += 1;
    }

    seq.push(contentCid);
    if (seq.length > WINDOW) seq.shift();
  }

  predict(userId) {
    const key = String(userId || '').trim();
    const seq = this.userSequence[key];
    if (!seq || seq.length === 0) return [];

    const last = seq[seq.length - 1];
    const userTransitions = this.transitions[key];
    const nexts = userTransitions && userTransitions[last];

    if (!nexts) return [];

    return Object.entries(nexts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([cid]) => cid);
  }

  decay() {
    for (const userId of Object.keys(this.transitions)) {
      const userTransitions = this.transitions[userId];

      for (const from of Object.keys(userTransitions)) {
        const destinations = userTransitions[from];

        for (const to of Object.keys(destinations)) {
          destinations[to] *= DECAY;
          if (destinations[to] < 0.01) {
            delete destinations[to];
          }
        }

        if (Object.keys(destinations).length === 0) {
          delete userTransitions[from];
        }
      }
    }
  }
}

// Singleton
const predictor = new MarkovPredictor();

// Decay every 10 minutes
setInterval(() => predictor.decay(), 10 * 60 * 1000);

/**
 * Express route handler — record a view event
 * POST /api/stream/view  { userId, contentCid, gatewayUrl }
 */

async function recordView(req, res) {
  try {
    // Identity must come from the authenticated token, never the request body.
    const userId = String(req.userId || '').trim();
    const rawCid = req.body && req.body.contentCid;
    const contentCid = typeof rawCid === 'string' ? rawCid.trim() : '';

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!contentCid || contentCid.length > 256 ||
        /[\u0000-\u001f]/.test(contentCid)) {
      return res.status(400).json({ error: 'Valid contentCid required' });
    }

    predictor.record(userId, contentCid);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[MILAN STREAM] record view failed:', e.message);
    return res.status(500).json({ error: 'Could not record stream view' });
  }
}

/**
 * Express route handler — get prefetch CIDs for a user
 * GET /api/stream/prefetch?userId=xxx
 */


async function getPrefetch(req, res) {
  try {
    const userId = String(req.userId || '').trim();
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const raw = req.query && req.query.candidateId;
    const suppliedFilter = raw !== undefined;
    const values = Array.isArray(raw)
      ? raw
      : (raw === undefined ? [] : [raw]);

    const allowed = new Set(values.slice(0, 40)
      .filter(value => typeof value === 'string')
      .map(value => value.trim())
      .filter(value => value.length > 0 && value.length <= 256 &&
        !/[\u0000-\u001f]/.test(value)));

    const markovIds = predictor.predict(userId);
    const recordIds = [...new Set(markovIds)]
      .filter(id => !suppliedFilter || allowed.has(id))
      .slice(0, TOP_N);

    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      prefetch: recordIds.map(recordId => ({ recordId }))
    });
  } catch (e) {
    console.error('[MILAN STREAM] prefetch failed:', e.message);
    return res.status(500).json({
      error: 'Could not predict next content'
    });
  }
}

module.exports = { predictor, recordView, getPrefetch };
