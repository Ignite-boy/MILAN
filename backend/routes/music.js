'use strict';

/**
 * MILAN Music — YouTube search proxy.
 * Plays official, licensed content via the YouTube IFrame player on the client
 * (Bollywood, Hollywood, anything on YT).
 *
 * Four search engines, tried in order so search ALWAYS works:
 *   1. YouTube Data API v3  — used when YOUTUBE_API_KEY is set (cleanest, daily quota).
 *   2. Keyless scrape       — parses youtube.com/results (ytInitialData). No key, no quota.
 *   3. Piped API mirror     — public instances, rotated. No key.
 *   4. Invidious API mirror — public instances, rotated. No key.
 * All four return real YouTube videoIds, so the existing IFrame player plays them as-is.
 * If every engine fails, the client falls back to Audius.
 *
 * Set YOUTUBE_API_KEY in .env (free: Google Cloud → YouTube Data API v3) for engine 1,
 * but search works fine even without it via engines 2–4.
 */

const express = require('express');
const router = express.Router();

const KEY = () => process.env.YOUTUBE_API_KEY || '';
const cache = new Map();             // query -> { at, data, source }
const TTL = 6 * 60 * 60 * 1000;      // 6h cache — same query won't re-hit YouTube

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function ok(res, data) { res.json(data); }

// fetch with a hard timeout so a dead public instance can never hang a request.
async function fetchT(url, opts, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms || 6000);
  try { return await fetch(url, Object.assign({ signal: ac.signal }, opts || {})); }
  finally { clearTimeout(t); }
}

router.get('/status', (_req, res) => {
  // Search always works now (keyless fallbacks), so report youtube:true regardless of key.
  ok(res, {
    ok: true,
    youtube: true,
    keyed: !!KEY(),
    engine: KEY() ? 'data-api+keyless' : 'keyless',
    sources: ['youtube', 'audius']
  });
});

/* ── Engine 1: official YouTube Data API v3 (needs key, costs quota) ─────────── */
async function searchViaApi(q) {
  const url = 'https://www.googleapis.com/youtube/v3/search'
    + '?part=snippet&type=video&videoCategoryId=10&maxResults=24&safeSearch=none'
    + '&q=' + encodeURIComponent(q) + '&key=' + encodeURIComponent(KEY());
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason)
      || j.error?.message || ('http ' + r.status);
    const e = new Error('data-api: ' + reason); e.reason = reason; throw e;
  }
  return (j.items || []).filter(it => it.id && it.id.videoId).map(it => ({
    id: it.id.videoId,
    title: it.snippet.title,
    channel: it.snippet.channelTitle,
    thumb: (it.snippet.thumbnails && (it.snippet.thumbnails.medium || it.snippet.thumbnails.default) || {}).url || ''
  }));
}

/* ── Engine 2: keyless scrape of youtube.com/results (no key, no quota) ──────── */
// Pulls the ytInitialData JSON the page bootstraps with and walks it for videoRenderer nodes.
function collectVideos(node, out, seen) {
  if (!node || typeof node !== 'object' || out.length >= 30) return;
  if (Array.isArray(node)) { for (const n of node) collectVideos(n, out, seen); return; }
  const v = node.videoRenderer;
  if (v && v.videoId && !seen.has(v.videoId)) {
    seen.add(v.videoId);
    const title = (v.title && v.title.runs && v.title.runs[0] && v.title.runs[0].text)
      || (v.title && v.title.simpleText) || '';
    const channel = (v.ownerText && v.ownerText.runs && v.ownerText.runs[0] && v.ownerText.runs[0].text)
      || (v.longBylineText && v.longBylineText.runs && v.longBylineText.runs[0] && v.longBylineText.runs[0].text)
      || '';
    if (title) {
      out.push({
        id: v.videoId,
        title,
        channel,
        thumb: 'https://i.ytimg.com/vi/' + v.videoId + '/mqdefault.jpg'
      });
    }
  }
  for (const k in node) {
    if (k === 'videoRenderer') continue;
    collectVideos(node[k], out, seen);
  }
}

function extractInitialData(html) {
  // Handles both `var ytInitialData = {...};` and `window["ytInitialData"] = {...};`
  const markers = ['ytInitialData = ', 'ytInitialData"] = '];
  for (const m of markers) {
    const i = html.indexOf(m);
    if (i === -1) continue;
    let s = i + m.length;
    while (s < html.length && html[s] !== '{') s++;
    // brace-match to find the end of the JSON object
    let depth = 0, inStr = false, esc = false;
    for (let j = s; j < html.length; j++) {
      const c = html[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) {
        try { return JSON.parse(html.slice(s, j + 1)); } catch (_) { return null; }
      } }
    }
  }
  return null;
}

async function searchViaScrape(q) {
  // sp=EgIQAQ%3D%3D restricts results to videos only; gl/hl keep it stable & English.
  const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q)
    + '&sp=EgIQAQ%253D%253D&hl=en&gl=US';
  const r = await fetchT(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      // Bypass the EU consent interstitial that otherwise hides results.
      'Cookie': 'CONSENT=YES+cb; SOCS=CAI;'
    }
  }, 7000);
  if (!r.ok) { const e = new Error('scrape: http ' + r.status); e.reason = 'scrape_http_' + r.status; throw e; }
  const html = await r.text();
  const data = extractInitialData(html);
  const out = [];
  if (data) collectVideos(data, out, new Set());
  return out.slice(0, 24);
}

/* ── Engine 3: Piped API (keyless YouTube mirror, public instances) ──────────── */
const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee',
  'https://pipedapi.leptons.xyz'
];
async function searchViaPiped(q) {
  let lastErr = '';
  for (const base of PIPED) {
    try {
      const r = await fetchT(base + '/search?q=' + encodeURIComponent(q) + '&filter=videos',
        { headers: { 'User-Agent': UA } }, 5000);
      if (!r.ok) { lastErr = 'piped_http_' + r.status; continue; }
      const j = await r.json().catch(() => ({}));
      const arr = j.items || [];
      const out = [];
      for (const it of arr) {
        const m = String(it.url || it.id || '').match(/v=([\w-]{11})/) || [];
        const id = m[1] || (typeof it.url === 'string' && it.url.length === 11 ? it.url : '');
        if (id && it.title) out.push({
          id, title: it.title, channel: it.uploaderName || it.uploader || '',
          thumb: it.thumbnail || ('https://i.ytimg.com/vi/' + id + '/mqdefault.jpg')
        });
        if (out.length >= 24) break;
      }
      if (out.length) return out;
      lastErr = 'piped_empty';
    } catch (e) { lastErr = 'piped_' + (e.name === 'AbortError' ? 'timeout' : (e.message || 'err')); }
  }
  const e = new Error('piped: ' + lastErr); e.reason = lastErr; throw e;
}

/* ── Engine 4: Invidious API (keyless YouTube mirror, public instances) ──────── */
const INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.jing.rocks'
];
async function searchViaInvidious(q) {
  let lastErr = '';
  for (const base of INVIDIOUS) {
    try {
      const r = await fetchT(base + '/api/v1/search?type=video&q=' + encodeURIComponent(q),
        { headers: { 'User-Agent': UA } }, 5000);
      if (!r.ok) { lastErr = 'inv_http_' + r.status; continue; }
      const arr = await r.json().catch(() => []);
      const out = [];
      for (const it of (Array.isArray(arr) ? arr : [])) {
        const id = it.videoId;
        if (id && it.title) out.push({
          id, title: it.title, channel: it.author || '',
          thumb: (it.videoThumbnails && it.videoThumbnails.length
            && (it.videoThumbnails.find(t => t.quality === 'medium') || it.videoThumbnails[0]).url)
            || ('https://i.ytimg.com/vi/' + id + '/mqdefault.jpg')
        });
        if (out.length >= 24) break;
      }
      if (out.length) return out;
      lastErr = 'inv_empty';
    } catch (e) { lastErr = 'inv_' + (e.name === 'AbortError' ? 'timeout' : (e.message || 'err')); }
  }
  const e = new Error('invidious: ' + lastErr); e.reason = lastErr; throw e;
}

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'query required' });

  const ck = q.toLowerCase();
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return ok(res, { ok: true, cached: true, source: hit.source, items: hit.data });

  let items = null, source = '', firstErr = '';

  // Engine 1: official Data API (only if a key is configured).
  if (KEY()) {
    try { items = await searchViaApi(q); source = 'youtube-api'; }
    catch (e) { firstErr = e.reason || e.message; }
  }

  // Engines 2→4: keyless fallbacks — each runs only if the previous gave nothing.
  // All return real YouTube videoIds, so the existing IFrame player plays them as-is.
  const keyless = [
    ['youtube-free', searchViaScrape],   // 2: scrape youtube.com/results
    ['piped',        searchViaPiped],    // 3: Piped mirror (instance rotation)
    ['invidious',    searchViaInvidious] // 4: Invidious mirror (instance rotation)
  ];
  for (const [name, fn] of keyless) {
    if (items && items.length) break;
    try {
      const got = await fn(q);
      if (got && got.length) { items = got; source = name; }
    } catch (e) { if (!firstErr) firstErr = e.reason || e.message; }
  }

  if (items && items.length) {
    cache.set(ck, { at: Date.now(), data: items, source });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return ok(res, { ok: true, source, items });
  }

  // Every engine came up empty — let the client fall back to Audius.
  return res.status(502).json({ error: 'YouTube search failed', reason: firstErr || 'no_results' });
});

/* ── Audio stream proxy — real background playback ─────────────────────────────
   Mobile browsers refuse to keep a YouTube IFrame playing once the app is
   backgrounded (autoplay policy blocks the resume). A page-owned <audio>
   element is the only thing Android reliably keeps playing, so the client
   plays /api/music/stream/:id instead of the iframe. We resolve the audio URL
   with yt-dlp and proxy the bytes (googlevideo URLs are locked to THIS
   server's IP, so the client cannot fetch them directly). Range passthrough
   keeps seeking working. The iframe stays as the client-side fallback. */
const { spawn } = require('child_process');
const path = require('path');
const { Readable } = require('stream');

const YTDLP = process.env.YTDLP_PATH || path.join(__dirname, '..', 'bin', 'yt-dlp');
const urlCache = new Map();          // videoId -> { at, url }
const inflight = new Map();          // videoId -> Promise (dedupe concurrent resolves)
const URL_TTL = 3 * 60 * 60 * 1000;  // googlevideo URLs live ~6h; refresh at 3h

// Keep yt-dlp fresh — YouTube changes routinely break old extractor versions.
// Self-update 5 min after boot, then weekly. (No crontab on this host.)
function selfUpdateYtdlp() {
  try { spawn(YTDLP, ['-U'], { stdio: 'ignore', timeout: 120000 }).on('error', () => {}); } catch (_) {}
}
setTimeout(selfUpdateYtdlp, 5 * 60 * 1000).unref?.();
setInterval(selfUpdateYtdlp, 7 * 24 * 60 * 60 * 1000).unref?.();

function resolveAudioUrl(id) {
  if (inflight.has(id)) return inflight.get(id);
  const p = new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, [
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      '--get-url', '--no-warnings', '--no-playlist', '--quiet',
      'https://www.youtube.com/watch?v=' + id
    ], { timeout: 30000 });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('error', reject);
    proc.on('close', code => {
      const url = out.trim().split('\n')[0];
      if (code === 0 && /^https:\/\//.test(url)) resolve(url);
      else reject(new Error('yt-dlp exit ' + code + ': ' + err.slice(0, 300)));
    });
  }).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

function upstreamFetch(url, req, signal) {
  const headers = { 'User-Agent': UA };
  if (req.headers.range) headers.Range = req.headers.range;
  return fetch(url, { headers, signal });
}

router.get('/stream/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\w-]{11}$/.test(id)) return res.status(400).json({ error: 'bad video id' });
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const hit = urlCache.get(id);
    let url = (hit && Date.now() - hit.at < URL_TTL) ? hit.url : null;
    if (!url) {
      url = await resolveAudioUrl(id);
      urlCache.set(id, { at: Date.now(), url });
      if (urlCache.size > 500) urlCache.delete(urlCache.keys().next().value);
    }
    let up = await upstreamFetch(url, req, ac.signal);
    if (up.status === 403 || up.status === 410) {
      // cached URL expired — re-resolve once
      url = await resolveAudioUrl(id);
      urlCache.set(id, { at: Date.now(), url });
      up = await upstreamFetch(url, req, ac.signal);
    }
    if (up.status !== 200 && up.status !== 206) {
      return res.status(502).json({ error: 'stream unavailable', status: up.status });
    }
    res.status(up.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = up.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('Cache-Control', 'no-store');
    Readable.fromWeb(up.body).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: 'stream unavailable' });
  }
});

// Free YouTube autocomplete (no API key, no quota) — same source the YouTube search box uses.
// Gives the real "type and see suggestions" experience without touching the Data API quota.
router.get('/suggest', async (req, res) => {
  const q = String(req.query.q || '').trim();

  if (!q) {
    return res.status(200).json({
      ok: true,
      suggestions: []
    });
  }

  try {
    const url =
      'https://suggestqueries.google.com/complete/search' +
      '?client=firefox&ds=yt&hl=en&q=' +
      encodeURIComponent(q);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    let r;

    try {
      r = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
          'Accept': 'application/json,text/plain,*/*'
        }
      });
    } finally {
      clearTimeout(timer);
    }

    if (!r.ok) {
      return res.status(200).json({
        ok: true,
        suggestions: []
      });
    }

    const txt = await r.text();

    let data;
    try {
      data = JSON.parse(txt);
    } catch (_) {
      return res.status(200).json({
        ok: true,
        suggestions: []
      });
    }

    const suggestions =
      Array.isArray(data) &&
      Array.isArray(data[1])
        ? data[1]
            .filter(v => typeof v === 'string')
            .slice(0, 10)
        : [];

    return res.status(200).json({
      ok: true,
      suggestions
    });
  } catch (_) {
    // Autocomplete must never crash the API handler.
    return res.status(200).json({
      ok: true,
      suggestions: []
    });
  }
});

module.exports = router;
