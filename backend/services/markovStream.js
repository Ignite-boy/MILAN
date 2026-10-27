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
const DECAY  = 0.92;       // older transitions lose weight over time

class MarkovPredictor {
  constructor() {
    // transitions[fromCid][toCid] = weight
    // Keep transition history isolated per authenticated user.
    this.transitions = Object.create(null);
    // per-user recent sequence: userId -> [cid, cid, ...]
    this.userSequence = Object.create(null);
  }

  /**
   * Record that userId viewed contentCid (call on every feed item view)
   */
  record(userId, contentCid) {
    if (!userId || !contentCid) return;
    const seq = this.userSequence[userId] || (this.userSequence[userId] = []);
    const userTransitions = this.transitions[userId] || (this.transitions[userId] = Object.create(null));

    if (seq.length > 0) {
      const prev = seq[seq.length - 1];
      const nexts = userTransitions[prev] || (userTransitions[prev] = Object.create(null));
      nexts[contentCid] = (nexts[contentCid] || 0) + 1;
    }

    seq.push(contentCid);
    if (seq.length > WINDOW) seq.shift();
  }

  /**
   * Predict next TOP_N content CIDs for a user based on current position
   */
  predict(userId) {
    const seq = this.userSequence[userId];
    if (!seq || seq.length === 0) return [];
    const last = seq[seq.length - 1];
    const nexts = this.transitions[userId]?.[last];
    if (!nexts) return [];
    return Object.entries(nexts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([cid]) => cid);
  }

  /**
   * Apply time-based decay to transition weights (call periodically)
   */
  decay() {
    for (const userId of Object.keys(this.transitions)) {
      const userTransitions = this.transitions[userId];
      for (const from of Object.keys(userTransitions)) {
        for (const to of Object.keys(userTransitions[from])) {
          userTransitions[from][to] *= DECAY;
          if (userTransitions[from][to] < 0.01) {
            delete userTransitions[from][to];
          }
        }
        if (Object.keys(userTransitions[from]).length === 0) {
          delete userTransitions[from];
        }
      }
      if (Object.keys(userTransitions).length === 0) {
        delete this.transitions[userId];
      }
    }
  }
}

// Singleton
const predictor = new MarkovPredictor();

// Decay every 10 minutes
const decayTimer = setInterval(() => predictor.decay(), 10 * 60 * 1000);
if (typeof decayTimer.unref === 'function') decayTimer.unref();

/**
 * Express route handler — record a view event
 * POST /api/stream/view  { userId, contentCid, gatewayUrl }
 */
async function recordView(req, res) {
  try {
    const userId = String(req.userId || '');
    const { contentCid } = req.body || {};
    if (!userId || typeof contentCid !== 'string' || !contentCid.trim() || contentCid.length > 512) {
      return res.status(400).json({ error: 'Valid contentCid required' });
    }
    predictor.record(userId, contentCid.trim());
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * Express route handler — get prefetch CIDs for a user
 * GET /api/stream/prefetch?userId=xxx
 */
async function getPrefetch(req, res) {
  try {
    const userId = String(req.userId || '');
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const cids = predictor.predict(userId);

    // Build gateway URLs using env config
    const gw = process.env.IPFS_GATEWAY_URL || 'https://ipfs.io/ipfs';
    const prefetchUrls = cids.map(cid => ({
      cid,
      url: `${gw}/${cid}`,
      // Also include Arweave fallback if configured
      arweaveUrl: process.env.ARWEAVE_GATEWAY_URL ? `${process.env.ARWEAVE_GATEWAY_URL}/${cid}` : null,
    }));

    res.json({ prefetch: prefetchUrls });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { MarkovPredictor, predictor, recordView, getPrefetch };
