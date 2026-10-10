(function(){
'use strict';

/* ── State ─────────────────────────────────────────────────────── */
var maiState = {
  model: 'claude-sonnet-4-20250514',
  persona: 'milan',
  temp: 0.7,
  messages: [],
  tokens: parseInt(localStorage.getItem('mai_tokens')||'0', 10),
  requests: parseInt(localStorage.getItem('mai_requests')||'0', 10),
  isLoading: false,
  ttsActive: false,
  micActive: false,
  tone: 'casual',
  imgStyle: 'realistic',
  activeTab: 'chat'
};

/* ── System Prompts ─────────────────────────────────────────────── */
var PERSONAS = {
  milan: 'You are MILAN AI, the intelligent assistant of the MILAN social platform — a privacy-first decentralized social network built on Web5/DWN technology. You are warm, helpful, and knowledgeable about the platform. You speak in a mix of Hindi and English (Hinglish) when appropriate, matching the user\'s language preference. You help users compose posts, understand privacy settings, debug code, and answer any questions. Be concise, direct, and use relevant emojis occasionally. The platform uses DID/DWN architecture, Node.js backend, and has features like posts, connections, reactions, and more.',
  dev: 'You are an expert Python and JavaScript developer. You write clean, efficient, well-commented code. You debug issues systematically, explain concepts clearly, and suggest best practices. When writing code, always include brief comments explaining the logic.',
  analyst: 'You are a senior data analyst and scientist. You are skilled in Python (pandas, numpy, matplotlib), SQL, statistics, and data visualization. You explain data concepts clearly, help interpret results, and suggest analytical approaches.',
  writer: 'You are a creative writer and content strategist specializing in social media content. You write engaging, viral-worthy posts, captions, and stories. You understand tone, audience, and platform-specific writing styles.',
  coach: 'You are a supportive life coach and motivator. You listen actively, ask thoughtful questions, help people set and achieve goals, and provide evidence-based advice. You are empathetic, encouraging, and practical.',
  debug: 'You are a debugging expert. You systematically analyze code and error messages, identify root causes, suggest fixes, and explain why issues occur. You are thorough and methodical.'
};

/* ── Render Markdown ─────────────────────────────────────────────── */
function maiMarkdown(text){
  if(!text) return '';
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, function(m, lang, code){
    return '<pre><code>' + code.trim().replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code></pre>';
  });
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/^### (.+)$/gm, '<h4 style="margin:8px 0 4px;color:#93c5fd;">$1</h4>');
  text = text.replace(/^## (.+)$/gm, '<h3 style="margin:10px 0 6px;color:#c4b5fd;">$1</h3>');
  text = text.replace(/^# (.+)$/gm, '<h2 style="margin:10px 0 6px;color:#fbbf24;">$1</h2>');
  text = text.replace(/^- (.+)$/gm, '• $1<br>');
  text = text.replace(/\n\n/g, '<br><br>');
  text = text.replace(/\n/g, '<br>');
  return text;
}

/* ── API Call ─────────────────────────────────────────────────────── */
async function maiCallAPI(userMessages, stream) {
  var systemPrompt = PERSONAS[maiState.persona] || PERSONAS.milan;
  // Route through MILAN's own backend so the API key stays server-side (in .env)
  // and there are no CORS / key-exposure problems from the browser.
  var headers = { 'Content-Type': 'application/json' };
  try { var t = localStorage.getItem('milan_token'); if (t) headers.Authorization = 'Bearer ' + t; } catch(_) {}
  var res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      model: maiState.model,
      max_tokens: 1024,
      temperature: maiState.temp,
      system: systemPrompt,
      persona: maiState.persona,
      messages: userMessages
    })
  });
  var data = await res.json().catch(function(){ return {}; });
  if(!res.ok || data.success === false){
    throw new Error(data.error || 'AI request failed. Make sure an AI API key is set in the server .env.');
  }
  var text = data.reply || '';
  // Track usage
  maiState.tokens += (data.usage && (data.usage.input_tokens + data.usage.output_tokens)) || 80;
  maiState.requests++;
  localStorage.setItem('mai_tokens', String(maiState.tokens));
  localStorage.setItem('mai_requests', String(maiState.requests));
  return text;
}

/* ── Chat Functions ─────────────────────────────────────────────── */
function maiAddMessage(role, text, isHtml){
  var area = document.getElementById('mai-chat-area');
  if(!area) return;
  var msgDiv = document.createElement('div');
  msgDiv.className = 'mai-msg ' + role;
  var initials = (role === 'ai') ? '🤖' : ((window.me && window.me.profile && window.me.profile.display_name) ? window.me.profile.display_name[0].toUpperCase() : 'U');
  var bubbleContent = isHtml ? text : maiMarkdown(text);
  msgDiv.innerHTML =
    '<div class="mai-avatar '+role+'">'+ initials +'</div>' +
    '<div>' +
      '<div class="mai-bubble">' + bubbleContent + '</div>' +
      (role === 'ai' ? '<div class="mai-msg-actions"><button class="mai-msg-action" onclick="maiSpeak(this.closest(\'.mai-msg\').querySelector(\'.mai-bubble\').innerText)">🔊 Read</button><button class="mai-msg-action" onclick="navigator.clipboard&&navigator.clipboard.writeText(this.closest(\'.mai-msg\').querySelector(\'.mai-bubble\').innerText)">📋 Copy</button></div>' : '') +
    '</div>';
  area.appendChild(msgDiv);
  area.scrollTop = area.scrollHeight;
  return msgDiv;
}

function maiShowThinking(){
  var area = document.getElementById('mai-chat-area');
  var div = document.createElement('div');
  div.id = 'mai-thinking-bubble';
  div.innerHTML = '<div class="mai-thinking"><div class="mai-dot-anim"></div><div class="mai-dot-anim"></div><div class="mai-dot-anim"></div><span style="font-size:12px;color:#6b84b0;margin-left:6px;">MILAN AI thinking...</span></div>';
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function maiRemoveThinking(){
  var el = document.getElementById('mai-thinking-bubble');
  if(el) el.remove();
}

async function maiSend(){
  var input = document.getElementById('mai-input');
  var text = (input.value || '').trim();
  if(!text || maiState.isLoading) return;

  input.value = '';
  input.style.height = '';
  document.getElementById('mai-char-count').textContent = '0/4000';

  maiAddMessage('user', text, false);
  maiState.messages.push({ role: 'user', content: text });

  maiState.isLoading = true;
  document.getElementById('mai-send').disabled = true;
  maiShowThinking();

  try{
    var reply = await maiCallAPI(maiState.messages);
    maiRemoveThinking();
    maiState.messages.push({ role: 'assistant', content: reply });
    maiAddMessage('ai', reply, false);
    if(maiState.messages.length > 30){
      maiState.messages = maiState.messages.slice(-28);
    }
  } catch(e){
    maiRemoveThinking();
    maiAddMessage('ai', '❌ Error: ' + e.message + '<br><span style="font-size:12px;color:#6b84b0;">API key check karo ya internet connection dekho.</span>', true);
  }
  maiState.isLoading = false;
  document.getElementById('mai-send').disabled = false;
  input.focus();
}

function maiQuickPrompt(prompt){
  var input = document.getElementById('mai-input');
  if(input){ input.value = prompt; input.focus(); }
  // Switch to chat tab
  maiSwitchTab('chat');
}

function maiClearChat(){
  var area = document.getElementById('mai-chat-area');
  maiState.messages = [];
  if(area) area.innerHTML = '';
  maiAddMessage('ai', '🧹 Chat cleared! Nayi conversation shuru karo.', true);
}

function maiExportChat(){
  var text = maiState.messages.map(function(m){ return '['+m.role.toUpperCase()+']\n'+m.content; }).join('\n\n---\n\n');
  var a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
  a.download = 'milan-ai-chat-' + Date.now() + '.txt';
  a.click();
}
window.maiClearChat = maiClearChat;
window.maiExportChat = maiExportChat;

/* ── AI Composer ──────────────────────────────────────────────────── */
async function maiGeneratePost(){
  var input = document.getElementById('mai-composer-input');
  var out = document.getElementById('mai-composer-output');
  var copyBtn = document.getElementById('mai-copy-to-composer');
  var topic = (input && input.value || '').trim();
  if(!topic){ out.textContent = '⚠️ Topic likho pehle!'; return; }
  out.innerHTML = '<div style="color:#8ba4d4">âš¡ Generating...</div>';
  try{
    var prompt = 'Write a social media post in ' + maiState.tone + ' tone about: ' + topic + '. Keep it engaging, authentic, and around 150-200 words. Add relevant emojis. Make it feel genuine, not corporate.';
    var result = await maiCallAPI([{role:'user', content:prompt}]);
    out.innerHTML = maiMarkdown(result);
    if(copyBtn) copyBtn.style.display = 'block';
    window.__mai_generated_post = result;
  } catch(e){
    out.innerHTML = '❌ ' + e.message;
  }
}

async function maiGenerateCaptions(){
  var input = document.getElementById('mai-composer-input');
  var out = document.getElementById('mai-composer-output');
  var copyBtn = document.getElementById('mai-copy-to-composer');
  var topic = (input && input.value || '').trim();
  if(!topic){ out.textContent = '⚠️ Topic likho pehle!'; return; }
  out.innerHTML = '<div style="color:#8ba4d4">âš¡ Generating 5 captions...</div>';
  try{
    var prompt = 'Generate 5 different social media captions for: ' + topic + '. Each should be different in tone and style (casual, professional, funny, inspirational, question-based). Number them 1-5. Keep each under 150 chars.';
    var result = await maiCallAPI([{role:'user', content:prompt}]);
    out.innerHTML = maiMarkdown(result);
    if(copyBtn) copyBtn.style.display = 'block';
    window.__mai_generated_post = result;
  } catch(e){
    out.innerHTML = '❌ ' + e.message;
  }
}
window.maiGeneratePost = maiGeneratePost;
window.maiGenerateCaptions = maiGenerateCaptions;

function maiCopyToMilanComposer(){
  var text = window.__mai_generated_post || '';
  var ta = document.querySelector('.composer textarea') || document.querySelector('#postText');
  if(ta && text){ ta.value = text.replace(/<[^>]*>/g,''); ta.dispatchEvent(new Event('input')); }
  document.getElementById('milan-ai-overlay').classList.remove('open');
  if(typeof window.toast === 'function') window.toast('✅ Content composer mein copy ho gaya!');
}
window.maiCopyToMilanComposer = maiCopyToMilanComposer;

/* ── Image Gen (AI Prompt Enhancer) ─────────────────────────────── */
async function maiGenerateImageDesc(){
  var input = document.getElementById('mai-img-prompt');
  var result = document.getElementById('mai-img-result');
  var desc = (input && input.value || '').trim();
  if(!desc){ result.innerHTML = '⚠️ Pehle describe karo kya chahiye!'; return; }
  result.innerHTML = '<div style="color:#8ba4d4">âš¡ Enhancing your prompt with AI...</div>';
  try{
    var styleMap = {realistic:'photorealistic, ultra detailed, 8K', anime:'anime style, vibrant colors, Studio Ghibli', oil:'oil painting, impressionist, rich textures', pixel:'pixel art, 16-bit, retro game style', '3d':'3D rendered, Unreal Engine 5, ray tracing'};
    var styleHint = styleMap[maiState.imgStyle] || 'photorealistic';
    var prompt = 'Enhance this image generation prompt to make it more vivid and detailed for an AI image generator. Keep the core concept but add artistic details, lighting, composition, and style. Return ONLY the enhanced prompt, nothing else.\n\nOriginal: ' + desc + '\nStyle: ' + styleHint;
    var enhanced = await maiCallAPI([{role:'user', content:prompt}]);
    result.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:12px;width:100%;">' +
        '<div style="font-size:12px;font-weight:700;color:#8ba4d4;">✨ AI-Enhanced Prompt:</div>' +
        '<div style="background:rgba(5,10,27,.8);border:1px solid rgba(100,160,255,.2);border-radius:12px;padding:12px;color:#f0e6ff;font-size:13px;line-height:1.6;">' + maiMarkdown(enhanced) + '</div>' +
        '<button onclick="navigator.clipboard&&navigator.clipboard.writeText(this.previousElementSibling.innerText).then(function(){if(window.toast)window.toast(\'📋 Copied!\');})" style="padding:8px;border-radius:10px;border:1px solid rgba(36,93,255,.3);background:rgba(36,93,255,.1);color:#93c5fd;cursor:pointer;font-weight:700;">📋 Copy Enhanced Prompt</button>' +
        '<div style="font-size:11px;color:#4b6a9a;text-align:center;">Midjourney, DALL-E, or Stable Diffusion mein paste karo</div>' +
      '</div>';
  } catch(e){
    result.innerHTML = '❌ ' + e.message;
  }
}
window.maiGenerateImageDesc = maiGenerateImageDesc;

/* ── Post Analyzer ──────────────────────────────────────────────── */
async function maiAnalyze(type){
  var input = document.getElementById('mai-analyze-input');
  var out = document.getElementById('mai-analyze-output');
  var post = (input && input.value || '').trim();
  if(!post){ out.textContent = '⚠️ Post paste karo pehle!'; return; }
  out.innerHTML = '<div style="color:#8ba4d4">âš¡ Analyzing...</div>';

  var prompts = {
    engagement: 'Analyze this social media post and give an engagement score out of 10. Explain what works and what doesn\'t. Provide specific improvement tips.\n\nPost: ' + post,
    sentiment: 'Analyze the sentiment of this post. Is it positive, negative, neutral? What emotions does it evoke? How might different audiences perceive it?\n\nPost: ' + post,
    improve: 'Improve this social media post. Make it more engaging, add better hooks, improve the CTA, and make it more shareable. Show the improved version clearly.\n\nPost: ' + post,
    hashtags: 'Suggest 10-15 relevant, trending hashtags for this post. Group them by category (broad, niche, trending). Explain why each is relevant.\n\nPost: ' + post
  };

  try{
    var result = await maiCallAPI([{role:'user', content: prompts[type]}]);
    out.innerHTML = maiMarkdown(result);
  } catch(e){
    out.innerHTML = '❌ ' + e.message;
  }
}
window.maiAnalyze = maiAnalyze;

/* ── TTS ─────────────────────────────────────────────────────────── */
function maiSpeak(text){
  if(!window.speechSynthesis) return;
  if(window.speechSynthesis.speaking){ window.speechSynthesis.cancel(); return; }
  var utt = new SpeechSynthesisUtterance(text.replace(/<[^>]*>/g,'').slice(0,800));
  utt.rate = 0.95;
  window.speechSynthesis.speak(utt);
}
window.maiSpeak = maiSpeak;

/* ── Voice Input ─────────────────────────────────────────────────── */
if(window.SpeechRecognition || window.webkitSpeechRecognition){
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var sr = new SR();
  sr.continuous = false;
  sr.interimResults = false;
  sr.onresult = function(e){
    var t = e.results[0][0].transcript;
    var inp = document.getElementById('mai-input');
    if(inp){ inp.value = t; inp.dispatchEvent(new Event('input')); }
    document.getElementById('mai-mic').classList.remove('recording');
    maiState.micActive = false;
    document.getElementById('mai-mic').textContent = '🎙️';
  };
  sr.onerror = function(){ document.getElementById('mai-mic').classList.remove('recording'); maiState.micActive = false; document.getElementById('mai-mic').textContent = '🎙️'; };
  document.getElementById('mai-mic').onclick = function(){
    if(maiState.micActive){ sr.stop(); this.classList.remove('recording'); this.textContent='🎙️'; maiState.micActive=false; }
    else{ sr.start(); this.classList.add('recording'); this.textContent='⏹️'; maiState.micActive=true; }
  };
}

/* ── Tab Switching ─────────────────────────────────────────────── */
function maiSwitchTab(tab){
  maiState.activeTab = tab;
  ['chat','composer','image','analyze','usage'].forEach(function(t){
    var el = document.getElementById('mai-'+t+'-view');
    if(el) el.style.display = (t===tab) ? 'flex' : 'none';
  });
  // Special case for image view which uses its own class
  var imgView = document.getElementById('mai-image-view');
  if(imgView){ imgView.style.display = (tab==='image') ? 'flex' : 'none'; }
  document.querySelectorAll('.mai-tab').forEach(function(btn){
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if(tab === 'usage') maiUpdateUsage();
}
window.maiSwitchTab = maiSwitchTab;

document.querySelectorAll('.mai-tab').forEach(function(btn){
  btn.onclick = function(){ maiSwitchTab(this.dataset.tab); };
});

/* ── Usage Dashboard ─────────────────────────────────────────────── */
function maiUpdateUsage(){
  var el = document.getElementById('mai-usage-content');
  if(!el) return;
  var data = [
    {label:'Total Tokens Used', val: maiState.tokens.toLocaleString() + ' / 100K'},
    {label:'Total Requests', val: maiState.requests},
    {label:'Active Model', val: maiState.model.replace('claude-','').replace('-20250514','').replace('-20251001','')},
    {label:'Current Persona', val: maiState.persona},
    {label:'Temperature', val: maiState.temp},
    {label:'Chat Messages', val: maiState.messages.length},
  ];
  el.innerHTML = data.map(function(d){
    return '<div class="mai-stat-row"><span>' + d.label + '</span><b>' + d.val + '</b></div>';
  }).join('') +
  '<div style="height:8px;"></div>' +
  '<div style="background:rgba(10,20,50,.6);border-radius:12px;overflow:hidden;height:8px;margin:4px 0;">' +
    '<div style="height:100%;width:'+Math.min(100,(maiState.tokens/100000*100))+'%;background:linear-gradient(90deg,#f59e0b,#d946ef);border-radius:12px;transition:width .5s;"></div>' +
  '</div>' +
  '<div style="font-size:11px;color:#4b6a9a;text-align:right;">' + Math.round(maiState.tokens/100000*100) + '% of free tier</div>' +
  '<button onclick="if(confirm(\'Reset?\')){maiState.tokens=0;maiState.requests=0;localStorage.setItem(\'mai_tokens\',\'0\');localStorage.setItem(\'mai_requests\',\'0\');maiUpdateUsage();}" style="margin-top:10px;width:100%;padding:8px;border-radius:10px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.1);color:#fca5a5;cursor:pointer;font-weight:700;font-size:12px;">🗑️ Reset Counters</button>';
}

/* ── Model + Persona Switching ──────────────────────────────────── */
document.querySelectorAll('.mai-model-btn').forEach(function(btn){
  btn.onclick = function(){
    document.querySelectorAll('.mai-model-btn').forEach(function(b){ b.classList.remove('active'); });
    this.classList.add('active');
    maiState.model = this.dataset.model;
    var badge = document.getElementById('mai-model-badge');
    if(badge) badge.textContent = maiState.model.replace('claude-','').replace('-20250514','').replace('-20251001','');
  };
});

document.querySelectorAll('.mai-persona-btn').forEach(function(btn){
  btn.onclick = function(){
    document.querySelectorAll('.mai-persona-btn').forEach(function(b){ b.classList.remove('active'); });
    this.classList.add('active');
    maiState.persona = this.dataset.persona;
    // Reset conversation context for new persona
    maiState.messages = [];
    maiAddMessage('ai', '✅ Persona changed to <b>' + this.textContent + '</b>. New conversation started!', true);
  };
});

/* ── Composer Tone Buttons ────────────────────────────────────── */
document.querySelectorAll('[data-tone]').forEach(function(btn){
  btn.onclick = function(){
    document.querySelectorAll('[data-tone]').forEach(function(b){ b.classList.remove('active'); });
    this.classList.add('active');
    maiState.tone = this.dataset.tone;
  };
});

/* ── Image Style Buttons ──────────────────────────────────────── */
document.querySelectorAll('[data-style]').forEach(function(btn){
  btn.onclick = function(){
    document.querySelectorAll('[data-style]').forEach(function(b){ b.classList.remove('active'); });
    this.classList.add('active');
    maiState.imgStyle = this.dataset.style;
  };
});

/* ── Temperature Slider ──────────────────────────────────────── */
var tempRange = document.getElementById('mai-temp-range');
var tempDisplay = document.getElementById('mai-temp-display');
if(tempRange && tempDisplay){
  tempRange.oninput = function(){
    maiState.temp = parseFloat(this.value);
    tempDisplay.textContent = maiState.temp.toFixed(2);
  };
}

/* ── Send Button + Enter Key ─────────────────────────────────── */
document.getElementById('mai-send').onclick = maiSend;
var maiInputEl = document.getElementById('mai-input');
if(maiInputEl){
  maiInputEl.addEventListener('keydown', function(e){
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); maiSend(); }
  });
  maiInputEl.addEventListener('input', function(){
    this.style.height = 'auto';
    this.style.height = Math.min(120, this.scrollHeight) + 'px';
    var counter = document.getElementById('mai-char-count');
    if(counter) counter.textContent = this.value.length + '/4000';
  });
}

/* ── Open/Close ──────────────────────────────────────────────── */
var milanAiBtn = document.getElementById('milanAiBtn');
if(milanAiBtn){
  milanAiBtn.onclick = function(){
    document.getElementById('milan-ai-overlay').classList.add('open');
  };
}

// Also wire up the topbar AI button if it exists
setTimeout(function(){
  var topAiBtn = document.getElementById('milan-model-btn');
  if(topAiBtn){
    // Remove old onclick, add new one
    topAiBtn.textContent = '🤖 AI Chat';
    topAiBtn.onclick = function(e){
      e.stopPropagation();
      document.getElementById('milan-ai-overlay').classList.add('open');
    };
  }
}, 500);

console.log('%c[MILAN AI V5] 🚀 Full AI System Active — Real Claude API Integration', 'color:#d946ef;font-weight:900;font-size:13px;background:rgba(217,70,239,0.1);padding:6px 12px;border-radius:8px;');
})();
