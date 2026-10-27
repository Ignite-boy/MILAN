/**
 * MILAN AI Routes — V6 AI Features
 * 1. Smart Caption      POST /api/ai/caption
 * 2. Style Filter       GET  /api/ai/style-filters  (CSS presets; ffmpeg on publish handled separately)
 * 3. Best Time to Post  GET  /api/ai/best-time/:userId
 * 4. Auto-Translate     POST /api/ai/translate
 * 5. Target Audience    POST /api/ai/target-audience
 */

const express = require('express');
const auth = require('../middleware/auth');
const { collectOwnInteractionEvents, countHours } = require('../services/aiBestTime');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');

/* ── helpers ── */
const DB_ROOT = process.env.MILAN_CLOUD_DWN_ROOT
  || process.env.MILAN_STORAGE_ROOT
  || path.join(__dirname, '../../data');

function readJson(name) {
  try {
    const f = path.join(DB_ROOT, name);
    if (!fs.existsSync(f)) return {};
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) { return {}; }
}

/* ── LLM helper (uses OPENAI_API_KEY or GEMINI_API_KEY from env) ── */
async function callLLM(systemPrompt, userPrompt) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (openaiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        max_tokens: 512,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt }
        ]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content.trim();
  }

  if (geminiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.candidates[0].content.parts[0].text.trim();
  }

  // Fallback — rule-based (no API key needed)
  return null;
}

/* ═══════════════════════════════════════════
   1. SMART CAPTION
   POST /api/ai/caption
   Body: { prompt, tone, hashtags }
═══════════════════════════════════════════ */
router.post('/caption', async (req, res) => {
  try {
    const { prompt = '', tone = 'casual', hashtags = true } = req.body;

    const systemPrompt = `You are a social media expert for MILAN, a decentralized social platform.
Generate exactly 3 catchy captions. Each on its own line, numbered 1. 2. 3.
Tone: ${tone}. ${hashtags ? 'Add 3-5 trending hashtags at the end of each caption.' : 'No hashtags.'}
Keep each caption under 150 chars (excluding hashtags). Be creative, engaging, and viral-worthy.
Return ONLY the 3 captions, nothing else.`;

    const userPrompt = prompt
      ? `Create captions for this post idea: "${prompt}"`
      : 'Create 3 generic engaging social media captions.';

    let rawText = await callLLM(systemPrompt, userPrompt);

    let captions;
    if (rawText) {
      captions = rawText
        .split('\n')
        .map(l => l.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 3);
    } else {
      // Fallback captions
      const fallbacks = {
        casual:       ['Vibes only ✨ #MomentsCaptured #MILAN #FYP #Trending #LifeIsGood',
                       'Can\'t stop smiling 😄 Living my best life! #HappyDays #MILAN #Blessed #Viral #GoodTimes',
                       'This one hits different 🔥 #Mood #MILAN #Aesthetic #Trending #InstaVibes'],
        professional: ['Proud to share this milestone with you all. #Professional #Growth #MILAN #Career #Achievement',
                       'Every step forward is progress worth celebrating. #Hustle #Success #MILAN #Motivated #Goals',
                       'Excellence is a habit, not a destination. #Leadership #MILAN #Inspire #WorkEthic #BuildingFuture'],
        funny:        ['Me trying to adult 😂 Plot twist: failed again. #Relatable #MILAN #AdultingIsHard #LOL #Mood',
                       'My patience has left the chat 🏃 #TooBroke #MILAN #Mood #Funny #SameThough',
                       'POV: You said "one more episode" at 11pm #SendHelp #MILAN #Netflix #Relatable #Whoops']
      };
      captions = fallbacks[tone] || fallbacks.casual;
    }

    res.json({ success: true, captions });
  } catch (err) {
    console.error('[MILAN AI] caption error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ═══════════════════════════════════════════
   2. STYLE FILTERS
   GET /api/ai/style-filters
   Returns CSS filter presets (client applies via canvas/CSS)
═══════════════════════════════════════════ */
router.get('/style-filters', (_req, res) => {
  const filters = [
    { id: 'original',    label: '✦ Original',   css: 'none',                                                      ffmpeg: '' },
    { id: 'vintage',     label: '🟤 Vintage',    css: 'sepia(0.7) contrast(1.1) brightness(0.9)',                  ffmpeg: 'curves=vintage' },
    { id: 'cinematic',   label: '🎬 Cinematic',  css: 'contrast(1.2) saturate(0.8) brightness(0.95)',             ffmpeg: 'curves=strong_contrast,hue=s=0.8' },
    { id: 'pop',         label: '🌈 Pop',        css: 'saturate(1.8) contrast(1.1) brightness(1.05)',             ffmpeg: 'curves=increase_contrast,hue=s=1.5' },
    { id: 'noir',        label: '⚫ Noir',        css: 'grayscale(1) contrast(1.3)',                               ffmpeg: 'format=gray,curves=strong_contrast' },
    { id: 'warm',        label: '🟠 Warm',       css: 'sepia(0.3) saturate(1.3) hue-rotate(-10deg)',              ffmpeg: 'colorbalance=rs=0.15:gs=0.05:bs=-0.1' },
    { id: 'cool',        label: '🔵 Cool',       css: 'saturate(1.1) hue-rotate(20deg) brightness(1.02)',         ffmpeg: 'colorbalance=rs=-0.1:gs=0:bs=0.15' },
    { id: 'krishna',     label: '🦚 Krishna',    css: 'hue-rotate(180deg) saturate(1.4) contrast(1.1)',           ffmpeg: 'hue=h=180:s=1.4,curves=increase_contrast' },
    { id: 'golden',      label: '🏆 Golden',     css: 'sepia(0.5) saturate(1.5) brightness(1.1) contrast(1.05)', ffmpeg: 'colorbalance=rs=0.2:gs=0.1:bs=-0.15' },
    { id: 'neon',        label: '💜 Neon',       css: 'saturate(2) contrast(1.3) brightness(1.1)',                ffmpeg: 'curves=increase_contrast,hue=s=2.0' },
  ];
  res.json({ success: true, filters });
});

/* ═══════════════════════════════════════════
   3. BEST TIME TO POST
   GET /api/ai/best-time/:userId
═══════════════════════════════════════════ */
router.get('/best-time/:userId', auth, (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();

    // The URL cannot be used to inspect another account's engagement data.
    if (!userId || userId !== String(req.userId || '')) {
      return res.status(403).json({ success: false, error: 'You can only view your own posting-time analytics.' });
    }

    const events = collectOwnInteractionEvents({
      activity: readJson('activity.json'),
      reactions: readJson('socialReactions.json'),
      userId: req.userId,
      did: req.account?.did || req.did || ''
    });
    const { hourCounts, validEvents } = countHours(events);

    let recommendation;
    if (validEvents > 0) {
      const sorted = hourCounts
        .map((count, hour) => ({ hour, count }))
        .sort((a, b) => b.count - a.count);
      const top = sorted.slice(0, 2).map(item => item.hour);
      const fmt = hour => `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
      recommendation = {
        source: 'your_data',
        primary: { hour: top[0], label: fmt(top[0]) },
        secondary: { hour: top[1], label: fmt(top[1]) },
        message: `Your audience is most active around ${fmt(top[0])} and ${fmt(top[1])}.`,
        hourCounts
      };
    } else {
      recommendation = {
        source: 'global_default',
        primary: { hour: 19, label: '7:00 PM' },
        secondary: { hour: 10, label: '10:00 AM' },
        message: 'Best times globally: Evening 7–9 PM & Morning 10–11 AM. Post more to get personalized data!',
        hourCounts: Array.from({ length: 24 }, (_, hour) =>
          (hour >= 18 && hour <= 21) ? 80 :
          (hour >= 9 && hour <= 11) ? 60 :
          (hour >= 12 && hour <= 14) ? 40 : 10
        )
      };
    }

    res.json({ success: true, recommendation });
  } catch (err) {
    console.error('[MILAN AI] best-time error:', err.message);
    res.status(500).json({ success: false, error: 'Could not calculate posting-time analytics.' });
  }
});

/* ═══════════════════════════════════════════
   4. AUTO-TRANSLATE
   POST /api/ai/translate
   Body: { text, targetLang }
═══════════════════════════════════════════ */
router.post('/translate', async (req, res) => {
  try {
    const { text = '', targetLang = 'en' } = req.body;
    if (!text.trim()) return res.json({ success: true, translated: '' });

    const LANG_NAMES = {
      en: 'English', hi: 'Hindi', es: 'Spanish', fr: 'French',
      de: 'German', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
      pt: 'Portuguese', ru: 'Russian', zh: 'Chinese (Simplified)'
    };
    const langName = LANG_NAMES[targetLang] || targetLang;

    const systemPrompt = `You are a translator. Translate the user's text to ${langName}.
CRITICAL rules:
- Preserve ALL emojis exactly as-is
- Preserve ALL hashtags (#word) exactly as-is
- Preserve ALL @mentions exactly as-is
- Only translate the actual words
- Return ONLY the translated text, no explanation`;

    let translated = await callLLM(systemPrompt, text);

    if (!translated) {
      // Minimal fallback: just return original with a note
      translated = text + ` [Translation to ${langName} requires an API key in .env]`;
    }

    res.json({ success: true, translated, targetLang, langName });
  } catch (err) {
    console.error('[MILAN AI] translate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ═══════════════════════════════════════════
   5. TARGET AUDIENCE
   POST /api/ai/target-audience
   Body: { caption, mediaType }
═══════════════════════════════════════════ */
router.post('/target-audience', async (req, res) => {
  try {
    const { caption = '', mediaType = 'post' } = req.body;

    const systemPrompt = `You are a content targeting AI for MILAN social platform.
Analyze the post and return a JSON object with these fields:
- category: string (e.g. "Tech", "Lifestyle", "Gaming", "Art", "Music", "Sports", "Food", "Travel", "Fashion", "Education", "Humor", "Motivation")
- ageGroups: array of strings from ["13-17","18-24","25-34","35-44","45+"]
- interests: array of 3-5 relevant interest tags
- regions: array of suggested regions from ["Global","India","South Asia","US","Europe","Southeast Asia"]
- contentTone: one of ["Casual","Professional","Humorous","Inspirational","Informative"]
- estimatedReach: one of ["Niche","Moderate","Broad","Viral Potential"]
Return ONLY valid JSON, no markdown, no explanation.`;

    const userPrompt = caption
      ? `Post content: "${caption}"\nMedia type: ${mediaType}`
      : `Media type: ${mediaType}. No caption provided.`;

    let result;
    const rawText = await callLLM(systemPrompt, userPrompt);

    if (rawText) {
      try {
        const clean = rawText.replace(/```json|```/g, '').trim();
        result = JSON.parse(clean);
      } catch (_) {
        // Parse failed — use rule-based fallback
        result = null;
      }
    }

    if (!result) {
      // Rule-based fallback
      const lower = caption.toLowerCase();
      const category =
        /\b(code|tech|dev|js|python|ai|ml|software|app)\b/.test(lower) ? 'Tech' :
        /\b(food|recipe|eat|cook|delicious|yummy)\b/.test(lower) ? 'Food' :
        /\b(travel|trip|vacation|tour|explore|wanderlust)\b/.test(lower) ? 'Travel' :
        /\b(game|gaming|play|gamer|esports)\b/.test(lower) ? 'Gaming' :
        /\b(music|song|beat|rap|artist|album)\b/.test(lower) ? 'Music' :
        /\b(art|design|creative|illustration|paint)\b/.test(lower) ? 'Art' :
        /\b(fitness|gym|workout|health|yoga)\b/.test(lower) ? 'Lifestyle' :
        /\b(funny|lol|meme|humor|joke|comedy)\b/.test(lower) ? 'Humor' : 'Lifestyle';

      result = {
        category,
        ageGroups: ['18-24', '25-34'],
        interests: [category, 'MILAN', 'Social Media', 'Trending'],
        regions: ['India', 'South Asia', 'Global'],
        contentTone: 'Casual',
        estimatedReach: 'Moderate'
      };
    }

    res.json({ success: true, audience: result });
  } catch (err) {
    console.error('[MILAN AI] target-audience error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ═══════════════════════════════════════════
   6. WRITING ASSIST (user-facing AI help)
   POST /api/ai/assist
   Body: { text, action }   action: improve | shorten | expand | fix | hashtags | ideas
   Powered by Claude/OpenAI/Gemini if a key is set; rule-based fallback otherwise.
═══════════════════════════════════════════ */
async function callClaude(systemPrompt, userPrompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return (data.content || []).map(b => b.text || '').join('').trim();
}

async function callAnyLLM(systemPrompt, userPrompt) {
  // Prefer Claude, then OpenAI/Gemini via the existing helper.
  try {
    const c = await callClaude(systemPrompt, userPrompt);
    if (c) return c;
  } catch (e) { console.warn('[MILAN AI] claude failed, falling back:', e.message); }
  return callLLM(systemPrompt, userPrompt);
}

router.post('/assist', async (req, res) => {
  try {
    const text = String(req.body.text || '').trim();
    const action = String(req.body.action || 'improve').toLowerCase();
    if (!text && action !== 'ideas') {
      return res.json({ success: true, result: '', note: 'Write something first.' });
    }

    const prompts = {
      improve: 'Rewrite the user\'s social post so it is clearer, warmer and more engaging, while keeping their meaning, language and any emojis. Return ONLY the rewritten post.',
      shorten: 'Make the user\'s social post shorter and punchier without losing the key message. Keep emojis. Return ONLY the shortened post.',
      expand: 'Expand the user\'s short note into a fuller, engaging social post (2-4 sentences), keeping their voice and language. Return ONLY the post.',
      fix: 'Fix spelling, grammar and punctuation in the user\'s social post. Do not change meaning, tone, language or emojis. Return ONLY the corrected text.',
      hashtags: 'Suggest 5 relevant, non-spammy hashtags for this social post. Return ONLY the hashtags on one line, space-separated, each starting with #.',
      ideas: 'Suggest 3 short, engaging social post ideas for a privacy-first decentralized social platform called MILAN. Return them as 3 numbered lines.'
    };
    const system = `You are MILAN's friendly writing assistant. MILAN is a privacy-first decentralized social platform. Be concise. If the user's text is in Hinglish or Hindi, keep that language. ${prompts[action] || prompts.improve}`;

    let result = await callAnyLLM(system, text || 'Give me post ideas.');
    const usedAI = !!result;

    if (!result) {
      // Rule-based fallbacks (no API key)
      if (action === 'hashtags') {
        const words = (text.toLowerCase().match(/[a-z]{4,}/g) || []).slice(0, 3)
          .map(w => '#' + w.charAt(0).toUpperCase() + w.slice(1));
        result = [...new Set([...words, '#MILAN', '#OwnYourData', '#Decentralized'])].slice(0, 5).join(' ');
      } else if (action === 'ideas') {
        result = '1. Share why owning your data matters to you.\n2. A behind-the-scenes look at something you made today.\n3. One small win from your week.';
      } else if (action === 'fix' || action === 'improve') {
        result = text.replace(/\s+/g, ' ').trim().replace(/^(.)/, m => m.toUpperCase());
      } else if (action === 'shorten') {
        result = text.split(/[.!?]/)[0].trim() + (text.length > 80 ? '…' : '');
      } else {
        result = text;
      }
    }

    res.json({ success: true, result, action, ai: usedAI });
  } catch (err) {
    console.error('[MILAN AI] assist error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ═══════════════════════════════════════════
   7. AI ASSISTANT CHAT (MILAN AI panel)
   POST /api/ai/chat
   Body: { messages:[{role,content}], system, model, temperature, persona, max_tokens }
   Returns: { success, reply, usage }
   Powered server-side by Claude/OpenAI/Gemini (key stays in .env). Rule-based note if no key.
═══════════════════════════════════════════ */
router.post('/chat', async (req, res) => {
  try {
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
    const system = String(req.body.system || 'You are MILAN AI, a helpful, concise assistant for the MILAN decentralized social platform. If the user writes in Hinglish or Hindi, reply in the same language.');

    // Build a single user prompt from the conversation so we can use the shared LLM helpers.
    const lastUser = [...messages].reverse().find(m => m && m.role === 'user');
    const userPrompt = lastUser
      ? String(lastUser.content || '')
      : messages.map(m => `${m.role === 'assistant' ? 'AI' : 'User'}: ${m.content}`).join('\n');

    // Pass recent context (last ~6 turns) so replies stay coherent without huge prompts.
    const history = messages.slice(-6)
      .map(m => `${m.role === 'assistant' ? 'AI' : 'User'}: ${String(m.content || '')}`)
      .join('\n');
    const fullPrompt = history && history !== userPrompt ? `${history}\n\nReply to the last User message.` : userPrompt;

    let reply;
    const travelAgentUrl = String(process.env.TRAVEL_AGENT_URL || '').trim();

    // Use the self-hosted RAG agent when configured.
    if (travelAgentUrl) {
      try {
        const authorization = req.get('authorization');
        const travelRes = await fetch(travelAgentUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authorization ? { Authorization: authorization } : {})
          },
          body: JSON.stringify({
            session_id: req.body.session_id || 'milan-session',
            message: fullPrompt || 'Hello'
          })
        });

        const contentType = travelRes.headers.get('content-type') || '';
        const body = await travelRes.text();

        if (!contentType.includes('application/json')) {
          throw new Error(
            `Travel Agent returned ${travelRes.status} ${contentType}: ${body.slice(0, 120)}`
          );
        }

        const data = JSON.parse(body);
        if (travelRes.ok && data.response) {
          reply = data.response;
        } else {
          throw new Error(data.error || `Travel Agent HTTP ${travelRes.status}`);
        }
      } catch (err) {
        console.error('[MILAN AI] Travel Agent failed; trying direct LLM:', err.message);
      }
    }

    // No agent configured, or agent unavailable: try MILAN's existing LLM helper.
    if (!reply) {
      try {
        reply = await callLLM(system, fullPrompt || userPrompt || 'Hello');
      } catch (err) {
        console.error('[MILAN AI] Direct LLM fallback failed:', err.message);
      }
    }

    if (!reply) {
      // No API key configured (or all providers failed) — honest, helpful fallback.
      reply = 'MILAN AI is not connected to a language model yet. Add OPENAI_API_KEY or GEMINI_API_KEY to the server .env and restart to enable full AI chat. Meanwhile, the Caption, Translate, Hashtags and Audience tools still work with built-in fallbacks.';
    }

    res.json({ success: true, reply });
  } catch (err) {
    console.error('[MILAN AI] chat error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* Optional, authenticated performance-AI scoring endpoint.
   This is additive: feed, uploads, and media playback do not depend on it. */
const { scoreCandidates } = require('../services/performanceAiClient');

router.post('/performance/prefetch-score', auth, async (req, res) => {
  try {
    const results = await scoreCandidates(req.body && req.body.candidates);
    res.json({ success: true, results });
  } catch (err) {
    if (err && err.code === 'INVALID_CANDIDATES') {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (err && err.code === 'NOT_CONFIGURED') {
      return res.status(503).json({ success: false, error: 'Performance AI is not configured.' });
    }
    return res.status(503).json({
      success: false,
      error: 'Performance AI is unavailable. Continue with standard media behavior.'
    });
  }
});


/* Temporary, aggregate-only performance telemetry for the authenticated account.
   Values stay in this process's memory; no media URLs or content are accepted. */
const performanceMetricsByUser = new Map();
const PERFORMANCE_METRIC_FIELDS = [
  'sampledImageLoads',
  'imageLoadP50Ms',
  'imageLoadP95Ms',
  'scrollFrameSamples',
  'scrollFrameP95Ms',
  'longTaskCount',
  'longTaskP95Ms'
];

function normalizePerformanceMetrics(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const result = {};
  for (const key of PERFORMANCE_METRIC_FIELDS) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    if (key.endsWith('Samples') || key === 'sampledImageLoads' || key === 'longTaskCount') {
      if (!Number.isInteger(value) || value > 120) return null;
    } else if (value > 120000) {
      return null;
    }
    result[key] = value;
  }
  return result;
}

router.post('/performance/metrics', auth, (req, res) => {
  const metrics = normalizePerformanceMetrics(req.body);
  if (!metrics) {
    return res.status(400).json({ success: false, error: 'Invalid aggregate performance metrics.' });
  }

  const userKey = String(req.userId || '');
  if (!userKey) return res.status(401).json({ success: false, error: 'Authentication required.' });

  performanceMetricsByUser.delete(userKey);
  performanceMetricsByUser.set(userKey, {
    metrics,
    collectedAt: new Date().toISOString()
  });

  // Keep the in-memory store bounded.
  while (performanceMetricsByUser.size > 500) {
    performanceMetricsByUser.delete(performanceMetricsByUser.keys().next().value);
  }

  return res.status(202).json({ success: true, stored: true });
});

router.get('/performance/metrics', auth, (req, res) => {
  const entry = performanceMetricsByUser.get(String(req.userId || ''));
  return res.json({
    success: true,
    collected: Boolean(entry),
    collectedAt: entry ? entry.collectedAt : null,
    metrics: entry ? entry.metrics : null
  });
});

module.exports = router;
