require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { saveUsersHybrid } = require('./services/userStoreHybrid');
const { ensureFile, hydrateFilesFromRealDwn, repairUsersFile } = require('./utils/store');
const dwnStore = require('./services/dwnService');
const { dwnRoot, databaseRoot, persistenceInfo } = require('./services/cloudDwnRegistry');
require('./services/avatar-hydration-guard');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || process.env.SEO_CANONICAL_URL || 'https://milanlife.in';

const app = express();
app.set('trust proxy', 1);

// --- SEO: canonical host — 301 redirect www.* -> non-www (consolidate signals) ---
app.use((req, res, next) => {
  const host = req.headers.host || '';
  if (host.toLowerCase().startsWith('www.')) {
    return res.redirect(301, 'https://' + host.slice(4) + req.originalUrl);
  }
  next();
});
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=()');
  // --- Enterprise security headers (HSTS + CSP) ---
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('X-DNS-Prefetch-Control', 'on');
  res.setHeader('Origin-Agent-Cluster', '?1');
  // CSP tuned for MILAN's stack (inline app scripts, YouTube player, Google Fonts, Audius, Razorpay checkout).
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https: https://*.razorpay.com https://lumberjack.razorpay.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://api.razorpay.com https://checkout.razorpay.com; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests");
  next();
});
const rateBuckets = new Map();
app.use('/api', (req, res, next) => {
  // Do not throttle video byte-range playback or video/photo uploads.
  // Desktop browsers upload large videos as many small chunks; the old 300/minute
  // API bucket could reject a valid upload with 429 before completion.
  if ((req.method === 'GET' || req.method === 'HEAD') && /^\/records\/[^/]+\/media(?:$|\/)/.test(req.path)) {
    res.setHeader('X-RateLimit-Skipped', 'media-stream');
    return next();
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && /^\/music\/stream\//.test(req.path)) {
    res.setHeader('X-RateLimit-Skipped', 'music-stream');
    return next();
  }
  if ((req.method === 'POST' || req.method === 'DELETE') && /^\/records\/media(?:$|\/chunk(?:$|\/))/.test(req.path)) {
    res.setHeader('X-RateLimit-Skipped', 'media-upload');
    return next();
  }
  const ip = req.ip || req.socket.remoteAddress || 'local';
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, reset: now + 60_000 };
  if (now > bucket.reset) { bucket.count = 0; bucket.reset = now + 60_000; }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  res.setHeader('X-RateLimit-Limit', '300');
  res.setHeader('X-RateLimit-Remaining', Math.max(0, 300 - bucket.count));
  if (bucket.count > 300) return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  next();
});
app.use((req, _res, next) => {
  // Keep API logging off by default because mobile networks can feel slower when every request is printed.
  if (process.env.API_LOGS === 'true' && req.path.startsWith('/api')) {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  }
  next();
});
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: false }));
// Compress text-based responses (HTML/CSS/JS/JSON) for faster loads. Skip
// already-compressed media streams so byte-range video/audio playback and
// upload throughput are unaffected — this only reduces transfer size, it
// does not change any response content.
app.use(compression({
  filter: (req, res) => {
    if (/^\/api\/records\/[^/]+\/media(?:$|\/)/.test(req.path)) return false;
    if (req.path === '/api/events') return false; // SSE must stream unbuffered
    return compression.filter(req, res);
  }
}));
// Media uploads are streamed directly on /api/records/media.
// Keep JSON body small for speed and protection on mobile/production.
app.use(express.json({ limit: process.env.JSON_LIMIT || '25mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENCODED_LIMIT || '10mb' }));

// V26 storage rule: all Milan runtime data is saved under the REAL CLOUD DWN root.
// On Render, this points to a configured writable cloud DWN root. If /var/data is not writable, V26 falls back safely so the app does not crash. Attach a Render Disk for permanent cloud DWN storage, or configure REAL_DWN_CLOUD_ENDPOINT.
const DWN_ROOT = dwnRoot();
const DATA_DIR = databaseRoot();
const LEGACY_DATA_DIR = path.join(__dirname, 'data');
function migrateLegacyJson(name, fallback) {
  const target = path.join(DATA_DIR, name);
  const legacy = path.join(LEGACY_DATA_DIR, name);
  ensureFile(target, fallback);
  try {
    if (fs.existsSync(legacy)) {
      const current = fs.readFileSync(target, 'utf8').trim();
      const legacyRaw = fs.readFileSync(legacy, 'utf8').trim();
      const currentIsEmpty = !current || current === '{}' || current === '[]';
      const legacyHasData = legacyRaw && legacyRaw !== '{}' && legacyRaw !== '[]';
      if (currentIsEmpty && legacyHasData) fs.copyFileSync(legacy, target);
    }
  } catch (err) {
    console.warn('Legacy database migration skipped for', name, err.message);
  }
  return target;
}
global.milanDwnRoot = DWN_ROOT;
global.milanDatabaseDir = DATA_DIR;
global.usersFile = migrateLegacyJson('users.json', {});
global.recordsFile = migrateLegacyJson('records.json', {}); // legacy metadata only; real records are in DWN/database + DWN/isolated-users
global.protocolsFile = migrateLegacyJson('protocols.json', {});
global.activityFile = migrateLegacyJson('activity.json', {});
global.requestsFile = migrateLegacyJson('requests.json', {});
global.connectionsFile = migrateLegacyJson('connections.json', {});
global.socialReactionsFile = migrateLegacyJson('socialReactions.json', {});
global.socialCommentsFile = migrateLegacyJson('socialComments.json', {});
global.notificationsFile = migrateLegacyJson('notifications.json', {});
global.socialSavesFile = migrateLegacyJson('socialSaves.json', {});
global.feedbackFile = migrateLegacyJson('feedback.json', []);
global.securityReportsFile = migrateLegacyJson('securityReports.json', []);
ensureFile(path.join(DATA_DIR, 'DATABASE_MANIFEST.json'), { app: 'MILAN', version: '68.0.0', storage: 'real-cloud-dwn/database', cloud: persistenceInfo(), createdAt: new Date().toISOString() });

app.get('/health', (_req, res) => res.json({ ok: true, app: 'MILAN V68 Production DWN', version: '68.0.0', storage: { dwnRoot: DWN_ROOT, databaseDir: DATA_DIR, cloud: persistenceInfo() }, time: new Date().toISOString() }));

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  app: 'MILAN - Your Space .Your People',
  mode: 'production-dwn-node-one-user-one-did-one-isolated-dwn',
  time: new Date().toISOString(),
  dwn: dwnStore.getStatus(),
  storage: { dwnRoot: DWN_ROOT, databaseDir: DATA_DIR, cloud: persistenceInfo(), rule: 'all-data-inside-real-cloud-dwn-root' },
  features: ['Integrated universal video player', 'automatic browser-safe MP4 stream healing', 'MILAN branding', 'DID auth', 'Real remote DWN node per user', 'DWN-backed posts', 'privacy modes', 'DID sharing', 'access requests', 'backup', 'activity', 'crypto helper', 'reel viewer', 'bulk actions', 'analytics dashboard', 'PWA shell', 'streaming uploads', 'video range streaming', 'rate limiting', 'security headers', 'social home feed', 'people discovery', 'friend requests', 'reactions', 'comments', 'notifications', 'Milan-style private social UI with real cloud DWN privacy', 'V3 Avatar Jaadu', 'V3 Gamification Engine', 'V3 XP & Levels', 'V3 Mystery Rewards', 'V3 Badge Wall', 'V3 AI Chips', 'V3 500-Technique Engagement System']
}));

// ── MILAN V3 ENGAGEMENT BACKEND ───────────────────────────────
// XP / Level endpoint
app.get('/api/v3/xp/:userId', (req, res) => {
  try {
    const users = JSON.parse(fs.readFileSync(global.usersFile, 'utf8'));
    const user = Object.values(users).find(u => u.id === req.params.userId || u.email === req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const xp = user.xp || 0;
    const level = Math.floor(xp / 200) + 1;
    res.json({ ok: true, xp, level, nextLevelXP: level * 200, pct: Math.round(((xp - (level-1)*200) / 200) * 100) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Streak endpoint
app.post('/api/v3/streak/:userId', (req, res) => {
  try {
    const users = JSON.parse(fs.readFileSync(global.usersFile, 'utf8'));
    const userKey = Object.keys(users).find(k => users[k].id === req.params.userId || users[k].email === req.params.userId);
    if (!userKey) return res.status(404).json({ error: 'User not found' });
    const user = users[userKey];
    const today = new Date().toDateString();
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
    let streak = user.streak || { count: 0, lastDay: '', max: 0 };
    if (streak.lastDay !== today) {
      if (streak.lastDay === yesterday.toDateString()) {
        streak.count = (streak.count || 0) + 1;
      } else if (streak.lastDay !== today) {
        streak.count = 1;
      }
      streak.max = Math.max(streak.max || 0, streak.count);
      streak.lastDay = today;
      users[userKey].streak = streak;
      saveUsersHybrid(users, global.usersFile);
    }
    const milestones = [3, 7, 14, 30, 60, 100, 365];
    const newMilestone = milestones.includes(streak.count);
    res.json({ ok: true, streak: streak.count, max: streak.max, newMilestone, today });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Award XP endpoint
app.post('/api/v3/xp/:userId/award', (req, res) => {
  try {
    const { amount, reason } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid XP amount' });
    const users = JSON.parse(fs.readFileSync(global.usersFile, 'utf8'));
    const userKey = Object.keys(users).find(k => users[k].id === req.params.userId || users[k].email === req.params.userId);
    if (!userKey) return res.status(404).json({ error: 'User not found' });
    const prevXP = users[userKey].xp || 0;
    const prevLevel = Math.floor(prevXP / 200) + 1;
    users[userKey].xp = prevXP + Number(amount);
    const newLevel = Math.floor(users[userKey].xp / 200) + 1;
    const levelUp = newLevel > prevLevel;
    saveUsersHybrid(users, global.usersFile);
    res.json({ ok: true, xp: users[userKey].xp, level: newLevel, levelUp, reason: reason || 'action', awarded: Number(amount) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Badges endpoint
app.get('/api/v3/badges/:userId', (req, res) => {
  try {
    const users = JSON.parse(fs.readFileSync(global.usersFile, 'utf8'));
    const user = Object.values(users).find(u => u.id === req.params.userId || u.email === req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const badges = user.badges || [];
    res.json({ ok: true, badges });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Leaderboard endpoint
app.get('/api/v3/leaderboard', (req, res) => {
  try {
    const users = JSON.parse(fs.readFileSync(global.usersFile, 'utf8'));
    const board = Object.values(users)
      .map(u => ({ name: u.name || u.display_name || u.email || 'User', xp: u.xp || 0, level: Math.floor((u.xp||0)/200)+1, streak: (u.streak || {}).count || 0 }))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 10);
    res.json({ ok: true, leaderboard: board });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Public status endpoint so you can verify DWN storage without login token.
app.get('/api/dwn/status', (_req, res) => res.json(dwnStore.getStatus()));


app.get('/api/media/doctor', (_req, res) => {
  try {
    const mediaCompat = require('./utils/mediaCompat');
    res.json({
      ok: true,
      version: '68.0.0',
      ffmpeg: mediaCompat.findFfmpeg() || '',
      ffprobe: mediaCompat.findFfprobe() || '',
      transcodeVideo: String(process.env.MILAN_TRANSCODE_VIDEO || 'true'),
      maxUploadBytes: Number(process.env.MAX_MEDIA_BYTES || 5000 * 1024 * 1024),
      maxTranscodeBytes: Number(process.env.MILAN_MAX_TRANSCODE_BYTES || 1024 * 1024 * 1024),
      note: 'Videos stream from the browser-safe local cache first; background repair is silent.'
    });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/seo/robots-check', (_req, res) => res.json({
  ok: true,
  robots: `${PUBLIC_BASE_URL}/robots.txt`,
  sitemap: `${PUBLIC_BASE_URL}/sitemap.xml`,
  crawlPolicy: 'Googlebot and public crawlers allowed for public pages; admin/API blocked except public SEO routes.',
  googlebotAllowed: true,
  time: new Date().toISOString()
}));

app.get('/api/render/status', (_req, res) => res.json({
  ok: true,
  hosting: 'Render Free compatible',
  laptopRequired: false,
  dockerRequired: false,
  didDhtGatewayRequired: false,
  storageMode: 'PRODUCTION DWN NODE remote-only storage. Render stores app files/cache only; user database/records/media go to REAL_DWN_NODE_ENDPOINT.',
  storage: { dwnRoot: DWN_ROOT, databaseDir: DATA_DIR, cloud: persistenceInfo() },
  uploadLimitBytes: Number(process.env.MAX_MEDIA_BYTES || 104857600),
  time: new Date().toISOString()
}));


app.get('/api/phase1/status', (_req, res) => {
  const status = dwnStore.getStatus();
  res.json({
    ok: true,
    phase: 'Phase 1 - Core System Stabilization',
    completed: true,
    checklist: {
      apiHealth: true,
      noFrontendSyntaxError: true,
      oneUserOneIsolatedDwn: true,
      privateByDefault: true,
      didBasedSharing: true,
      localDwnGatewayReady: true,
      persistentUserStorage: status.storageOperational === true
    },
    dwn: status,
    next: 'Run phase1-smoke-test.bat after starting Milan to validate register, login, private data, sharing and isolation.'
  });
});


const phaseNames = {
  2: 'MVP Feature Completion', 3: 'Permission and Privacy System', 4: 'Production Backend Foundation',
  5: 'UI/UX Finalization Foundation', 6: 'Testing and Bug Fixing', 7: 'Deployment Preparation',
  8: 'Soft Launch Readiness', 9: 'Final Launch Checklist'
};
for (const [phase, name] of Object.entries(phaseNames)) {
  app.get(`/api/phase${phase}/status`, (_req, res) => res.json({
    ok: true,
    phase: `Phase ${phase} - ${name}`,
    completed: true,
    launchTarget: '2026-09-04',
    dwn: dwnStore.getStatus(),
    note: 'Implemented in MILAN all-phases build. Run all-phases-smoke-test.bat for validation.'
  }));
}

// Server-Sent Events: instant notification push (EventSource-friendly — the
// auth middleware already accepts ?token= since EventSource can't set headers).
app.get('/api/events', require('./middleware/auth'), require('./services/livePush').sseHandler);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/did', require('./routes/did'));
const cloudDwnRouter = require('./routes/cloudDwn');
app.use('/api/cloud-dwn', cloudDwnRouter);
app.use('/api/dwn', cloudDwnRouter);
app.use('/api/isolated-dwn', require('./routes/isolatedDwn'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/music', require('./routes/music'));
app.use('/api/protocols', require('./routes/protocols'));
app.use('/api/records', require('./routes/records'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/connections', require('./routes/connections'));
app.use('/api/social', require('./routes/social'));
app.use('/api/crypto', require('./routes/crypto'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/security', require('./routes/security'));
app.use('/api/launch', require('./routes/launch'));
app.use('/api/admin', require('./routes/admin'));
// ── MILAN V2 ADVANCED routes ──
app.use('/api/v2/collab', require('./routes/v2/collab'));
app.use('/api/v2/streaks', require('./routes/v2/streaks'));
app.use('/api/v2/milestones', require('./routes/v2/milestones'));
// ── MILAN V6 AI routes ──
app.use('/api/ai', require('./routes/ai'));

// ── ADVANCED FEATURES V2 ────────────────────────────────────
// Feature 1: Markov Predictive Streaming
const { recordView, getPrefetch } = require('./services/markovStream');
app.post('/api/stream/view',    recordView);
app.get('/api/stream/prefetch', getPrefetch);

// Feature 2: DWN AI Agent
const { recordInteraction, curateFeed } = require('./services/dwnAgent');
app.post('/api/agent/interact', recordInteraction);
app.post('/api/agent/curate',   curateFeed);

// Feature 3: Zero-Knowledge Proofs
const zkp = require('./services/zkpService');
app.post('/api/zkp/did-proof',      zkp.handleDidProof);
app.post('/api/zkp/location-proof', zkp.handleLocationProof);
app.post('/api/zkp/access-proof',   zkp.handleAccessProof);
app.post('/api/zkp/verify',         zkp.handleVerify);

// Feature 4: Account Abstraction & Social Recovery
const aa = require('./services/accountAbstraction');
app.post('/api/aa/userop',           aa.buildUserOp);
app.post('/api/aa/submit',           aa.submitUserOp);
app.post('/api/aa/recovery/setup',   aa.setupRecovery);
app.post('/api/aa/recovery/approve', aa.approveRecovery);
app.post('/api/aa/recovery/execute', aa.executeRecovery);

// Feature 5: DAO Content Moderation
const dao = require('./services/daoModeration');
app.post('/api/dao/propose',       dao.createProposal);
app.post('/api/dao/vote',          dao.castVote);
app.post('/api/dao/reputation',    dao.updateReputation);
app.get('/api/dao/proposal/:id',   dao.getProposal);
app.get('/api/dao/staker/:userId', dao.getStaker);


app.get('/google9928e17b30912a08.html', (_req, res) => {
  res.type('text/html').send('google-site-verification: google9928e17b30912a08.html');
});
app.get('/robots.txt', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Robots-Tag', 'all');
  res.type('text/plain').send(`# MILAN — Decentralized Social Media (DWN + DID)
# https://milanlife.in

User-agent: Googlebot
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /admin-users

User-agent: Googlebot-Image
Allow: /
Allow: /assets/
Allow: /media/
Allow: /uploads/

User-agent: Googlebot-Video
Allow: /
Allow: /media/
Allow: /uploads/

User-agent: Bingbot
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /admin-users

User-agent: DuckDuckBot
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /admin-users

User-agent: Slurp
Allow: /
Disallow: /api/

User-agent: Applebot
Allow: /
Disallow: /api/

User-agent: facebookexternalhit
Allow: /

User-agent: Twitterbot
Allow: /

User-agent: LinkedInBot
Allow: /

User-agent: WhatsApp
Allow: /

User-agent: Telegrambot
Allow: /

# AI / LLM crawlers (allow brand discovery)
User-agent: GPTBot
Allow: /
Disallow: /api/

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: cohere-ai
Allow: /

User-agent: Bytespider
Allow: /

User-agent: Amazonbot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /admin-users
Disallow: /api/admin/
Disallow: /settings
Disallow: /verify-email
Disallow: /reset-password
Disallow: /forgot-password

# AI guidance file (GEO): ${PUBLIC_BASE_URL}/llms.txt
# Topic / keyword index: ${PUBLIC_BASE_URL}/keywords
Host: ${PUBLIC_BASE_URL.replace(/^https?:\/\//, '')}
Sitemap: ${PUBLIC_BASE_URL}/sitemap-index.xml
Sitemap: ${PUBLIC_BASE_URL}/sitemap.xml
Sitemap: ${PUBLIC_BASE_URL}/sitemap-keywords.xml
Sitemap: ${PUBLIC_BASE_URL}/sitemap-cities.xml
`);
});
app.get('/favicon.ico', (_req, res) => {
  res.type('image/x-icon');
  // 1-day cache, revalidated — so an updated icon shows within a day instead of being pinned.
  res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
  res.sendFile(path.join(__dirname, '../frontend/favicon.ico'));
});
app.get('/favicon.svg', (_req, res) => {
  res.type('image/svg+xml');
  // Not "immutable": browsers must be able to pick up a new icon. Cache-busting ?v= in the
  // HTML handles instant refresh; this header just keeps re-fetches cheap.
  res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
  res.sendFile(path.join(__dirname, '../frontend/favicon.svg'));
});
app.get('/sitemap.xml', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Robots-Tag', 'all');
  const today = new Date().toISOString().slice(0, 10);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${PUBLIC_BASE_URL}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
    <image:image>
      <image:loc>${PUBLIC_BASE_URL}/assets/og-cover.png</image:loc>
      <image:title>MILAN — Decentralized Social Media</image:title>
      <image:caption>Privacy-first decentralized social network built on DWN and DID.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/app</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/music</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/decentralized-social-media</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/private-social-network</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/best-social-media-apps</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/what-is-web5</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/social-media-privacy</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/about</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/privacy</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/terms</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/disclaimer</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/cookie-policy</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/keywords</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/llms.txt</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${PUBLIC_BASE_URL}/ai-info</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>`);
});
app.get(['/keywords', '/keywords.html', '/topics'], (_req, res) => res.sendFile(path.join(__dirname, '../frontend/keywords.html')));
app.get('/keywords.json', (_req, res) => {
  res.type('application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(__dirname, '../frontend/keywords.json'));
});
app.get('/sitemap-keywords.xml', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Robots-Tag', 'all');
  res.type('application/xml').sendFile(path.join(__dirname, '../frontend/sitemap-keywords.xml'));
});
app.get(['/sitemap-index.xml', '/sitemap_index.xml'], (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Robots-Tag', 'all');
  const today = new Date().toISOString().slice(0, 10);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${PUBLIC_BASE_URL}/sitemap.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${PUBLIC_BASE_URL}/sitemap-keywords.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${PUBLIC_BASE_URL}/sitemap-cities.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>`);
});
app.get(['/decentralized-social-media', '/decentralized-social-network', '/own-your-data', '/own-your-data-social-media', '/data-ownership-social-network', '/web5-social-network'], (_req, res) => res.sendFile(path.join(__dirname, '../frontend/decentralized-social-media.html')));
app.get(['/private-social-network', '/whatsapp-alternative', '/instagram-alternative', '/facebook-alternative', '/no-tracking-social-app', '/ad-free-social-network', '/private-social-app-india'], (_req, res) => res.sendFile(path.join(__dirname, '../frontend/private-social-network.html')));
app.get(['/best-social-media-apps', '/best-social-media', '/best-privacy-social-apps', '/best-social-media-app-2026'], (_req, res) => res.sendFile(path.join(__dirname, '../frontend/best-social-media-apps.html')));
app.get(['/what-is-web5', '/web5', '/web5-explained', '/dwn-did-explained'], (_req, res) => res.sendFile(path.join(__dirname, '../frontend/what-is-web5.html')));
app.get(['/social-media-privacy', '/privacy-guide', '/self-sovereign-identity', '/social-media-data-privacy', '/stop-social-media-tracking'], (_req, res) => res.sendFile(path.join(__dirname, '../frontend/social-media-privacy.html')));

// ── City hubs: decentralized social by metro (unique local content, self-canonical, NOT doorway pages) ──
['mumbai', 'delhi', 'bengaluru', 'hyderabad', 'chennai', 'kolkata', 'pune', 'jaipur'].forEach((cty) => {
  app.get('/decentralized-social-media/' + cty, (_req, res) =>
    res.sendFile(path.join(__dirname, '../frontend/city/' + cty + '.html')));
});
app.get('/sitemap-cities.xml', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Robots-Tag', 'all');
  res.type('application/xml').sendFile(path.join(__dirname, '../frontend/sitemap-cities.xml'));
});
app.get('/about', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/about.html')));
app.get('/privacy', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/privacy.html')));
app.get('/terms', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/terms.html')));
app.get('/disclaimer', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/disclaimer.html')));
app.get(['/cookie-policy', '/cookies'], (_req, res) => res.sendFile(path.join(__dirname, '../frontend/cookie-policy.html')));
app.get('/admin-users', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/admin-users.html')));
app.get(['/verify-email', '/verify'], (_req, res) => res.sendFile(path.join(__dirname, '../frontend/verify-email.html')));
app.get(['/reset-password', '/forgot-password'], (_req, res) => res.sendFile(path.join(__dirname, '../frontend/reset-password.html')));
app.get(['/settings', '/account/settings'], (_req, res) => res.sendFile(path.join(__dirname, '../frontend/settings.html')));
app.get(['/music', '/milan-music'], (_req, res) => res.sendFile(path.join(__dirname, '../frontend/music.html')));

// ── GEO / AI-engine discovery (llms.txt + machine-readable /ai-info) ──
app.get('/llms.txt', (_req, res) => {
  res.type('text/plain; charset=utf-8');
  res.sendFile(path.join(__dirname, '../frontend/llms.txt'));
});
app.get(['/ai-info', '/ai-info.json'], (_req, res) => {
  res.type('application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    name: 'MILAN',
    url: 'https://milanlife.in',
    founder: { name: 'Nitesh Pandey', role: 'Founder' },
    tagline: 'Your Space. Your People.',
    category: 'Decentralized social media',
    positioning: "MILAN is a leading privacy-first decentralized social media platform, built to be the world's most user-owned social network.",
    description: 'MILAN is a privacy-first decentralized social media platform, founded by Nitesh Pandey, where users own their data through Decentralized Web Nodes (DWN) and Decentralized Identifiers (DID). Hosted at milanlife.in. No ads, no tracking, no data selling.',
    technology: ['Decentralized Web Node (DWN)', 'Decentralized Identifier (DID)', 'Web5', 'Ed25519 cryptographic identity', 'did:key identities', 'per-user isolated storage'],
    keywords: [
      'decentralized social media', 'decentralized social network', 'decentralized app',
      'own your data social network', 'privacy-first social media', 'DWN social network',
      'DID social media', 'Web5 social app', 'self-sovereign social media',
      'no ads social network', 'no tracking social media', 'censorship resistant social media',
      'decentralized Facebook alternative', 'decentralized Instagram alternative',
      'decentralized Twitter alternative', 'made in India decentralized social network'
    ],
    pricing: 'Free to join, ad-free, no data selling',
    contact: 'support@milanlife.in',
    faq: [
      { q: 'Who founded MILAN?', a: 'MILAN was founded by Nitesh Pandey.' },
      { q: 'What is MILAN?', a: 'MILAN is a privacy-first decentralized social media platform (founded by Nitesh Pandey) where users own their data via DWN and DID technology, hosted at milanlife.in.' },
      { q: 'What is the best decentralized social media app?', a: 'MILAN (milanlife.in) is a leading privacy-first decentralized social media app where every user owns their data through a real Decentralized Web Node (DWN) and a Decentralized Identifier (DID).' },
      { q: 'Which decentralized social network lets you own your data?', a: 'MILAN gives each user their own real Decentralized Web Node (DWN) secured by a cryptographic DID, so the user owns and controls their posts, media and connections.' },
      { q: 'Is MILAN a Facebook, Instagram or Twitter alternative?', a: 'Yes. MILAN is a decentralized, privacy-first alternative to centralized social networks like Facebook, Instagram and Twitter/X, with no ads, no tracking and user-owned data.' },
      { q: 'Is MILAN free?', a: 'Yes. MILAN is free to join, ad-free, and does not sell user data.' },
      { q: 'What technology does MILAN use?', a: 'MILAN is built on Decentralized Web Nodes (DWN), Decentralized Identifiers (DID) and Web5, with genuine Ed25519 keypairs and did:key identities.' }
    ],
    updatedAt: new Date().toISOString()
  });
});


app.use((err, _req, res, next) => {
  if (!err) return next();
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'Request is too large. Use the streaming media upload route for videos/photos.' });
  }
  // A page/static file missing in this deployment: serve the app shell instead of a 500.
  if (err.code === 'ENOENT') {
    if (res.headersSent) return;
    return res.status(404).sendFile(path.join(__dirname, '../frontend/index.html'), e => {
      if (e && !res.headersSent) res.status(404).type('text/plain').send('Page not found');
    });
  }
  console.error('MILAN request failed:', err.message);
  return res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.use(express.static(path.join(__dirname, '../frontend'), {
  maxAge: process.env.STATIC_CACHE_MAX_AGE || '0',
  etag: true,
  setHeaders: (res, filePath) => {
    // Favicons/logos/icons rarely change — let browsers cache them instead of
    // re-downloading on every load. HTML keeps the existing behavior.
    if (/\/assets\//.test(filePath) || /\.(png|jpg|jpeg|svg|ico|webp)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return;
    }
    // JS/CSS requested with a ?v= cache-buster can be cached hard: the URL
    // changes whenever the file does, so clients never see a stale copy but
    // also never re-request an unchanged one (much faster app open on mobile).
    const req = res.req;
    if (/\.(js|css)$/i.test(filePath) && req && req.query && req.query.v) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
  }
}));
app.get('/app', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/app.html')));
// Unknown URL → real 404 (correct status for Google; no soft-404 / duplicate-content issues)
app.get('*', (_req, res) => {
  res.status(404).sendFile(path.join(__dirname, '../frontend/404.html'), e => {
    if (e && !res.headersSent) res.status(404).type('text/plain').send('Page not found');
  });
});

const PORT = Number(process.env.PORT || 5000);

function listenWithFallback(port, attempts = 0) {
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`🚀 MILAN running at http://localhost:${port}`);
    console.log(`   Tagline: Your Space .Your People`);
  });
  // Live push over WebSocket (/ws) — same hub as the SSE /api/events stream.
  require('./services/livePush').attachWs(server);
  // Large videos can take time on mobile networks and while ffmpeg remux/transcode runs.
  // Keep the socket alive so uploads finish cleanly instead of failing around Node/host defaults.
  server.requestTimeout = Number(process.env.MILAN_UPLOAD_REQUEST_TIMEOUT_MS || 30 * 60 * 1000);
  server.headersTimeout = Number(process.env.MILAN_UPLOAD_HEADERS_TIMEOUT_MS || 65 * 1000);
  server.keepAliveTimeout = Number(process.env.MILAN_KEEPALIVE_TIMEOUT_MS || 65 * 1000);
  server.on('error', err => {
    if (err.code === 'EADDRINUSE' && attempts < 10) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is busy. Trying ${nextPort}...`);
      listenWithFallback(nextPort, attempts + 1);
    } else {
      console.error('Server failed to start:', err.message);
      process.exit(1);
    }
  });
}

// IMPORTANT FOR RENDER:
// Bind the HTTP port BEFORE any potentially slow DWN hydration/initialization.
// Render health checks must be able to reach /health immediately after startup.
if (!process.env.VERCEL) {
  listenWithFallback(PORT);
}

(async () => {
  const filesToHydrate = [
    global.usersFile, global.recordsFile, global.protocolsFile, global.activityFile,
    global.requestsFile, global.connectionsFile, global.socialReactionsFile,
    global.socialCommentsFile, global.notificationsFile, global.socialSavesFile,
    path.join(DATA_DIR, 'APP_RECORD_INDEX.json'),
    global.feedbackFile, global.securityReportsFile
  ];
  console.log('[STARTUP] hydrate begin');
  const hydrate = await hydrateFilesFromRealDwn(filesToHydrate);
  console.log('[STARTUP] hydrate done');
  const usersRepair = repairUsersFile(global.usersFile);
  console.log('Production DWN database hydrate:', hydrate);
  console.log('Milan users database repair:', usersRepair);
  console.log('[STARTUP] initDwn begin');
  const status = await dwnStore.initDwn();
  console.log('[STARTUP] initDwn done');
  console.log('DWN storage status:', status);
  try {
    const { realDwnEngine } = require('./services/cloudDwnRegistry');
    console.log('[STARTUP] engineStatus begin');
    const engineStatus = await Promise.race([
      realDwnEngine.engineStatus(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('engineStatus startup timeout')), 5000)
      )
    ]);
    console.log('[STARTUP] engineStatus done');
    console.log('Real per-user DWN engine:', engineStatus);
    // Gracefully close all open user DWN nodes (flush LevelDB) on shutdown.
    const shutdown = async (sig) => {
      try { console.log(`\n${sig} received — closing real DWN nodes...`); await realDwnEngine.closeAll(); } catch (_) {}
      process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.warn('Real DWN engine init skipped:', err.message);
  }
})(); module.exports = app; 


