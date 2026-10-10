/*!
 * MILAN Assistant 🤖 — talk to the app in a meaningful way.
 * A self-contained chat widget with a built-in rule-based brain (no AI API / no key).
 * Drag/drop/paste media, suggested prompts, persistent history. No deps.
 */
(function () {
  'use strict';
  if (window.__milanAssistant) return;
  window.__milanAssistant = true;

  var KEY = 'milan_assistant_history';
  var SYSTEM = "You are MILAN Assistant, a warm, concise helper inside MILAN — a privacy-first decentralized social app where every user owns their data (DWN + DID). Help users post, find people, change settings, play music, and understand decentralization. If the user writes in Hindi or Hinglish, reply in the same language. Keep replies short and friendly.";

  var SUGGEST = ["MILAN kaise kaam karta hai?", "Mera pehla post likho", "Music kaise sunu?", "Privacy settings samjhao"];

  var CSS = [
    '.ma-fab{position:fixed;right:18px;bottom:18px;z-index:99996;display:flex;align-items:center;gap:9px;padding:11px 17px 11px 13px;border:0;border-radius:999px;cursor:pointer;font:800 13px Inter,system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#3a6df0,#7c5cff);box-shadow:0 12px 30px rgba(58,109,240,.5);transition:transform .18s,box-shadow .2s}',
    '.ma-fab:hover{transform:translateY(-2px) scale(1.04)}',
    '.ma-fab:active{transform:scale(.96)}',
    '.ma-fab .av{width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,.22);display:grid;place-items:center;font-size:15px}',
    '.ma-fab .dot{position:absolute;top:9px;left:30px;width:9px;height:9px;border-radius:50%;background:#34d399;box-shadow:0 0 0 2px #0b1024}',
    '.ma-panel{position:fixed;right:18px;bottom:18px;z-index:99999;width:min(390px,calc(100vw - 28px));height:min(600px,calc(100vh - 36px));display:none;flex-direction:column;background:#0c1226;border:1px solid rgba(255,255,255,.1);border-radius:22px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55)}',
    '.ma-panel.open{display:flex;animation:maUp .26s cubic-bezier(.16,.84,.44,1)}',
    '@keyframes maUp{from{transform:translateY(30px);opacity:.3}to{transform:none;opacity:1}}',
    '.ma-head{display:flex;align-items:center;gap:11px;padding:14px 16px;background:linear-gradient(135deg,rgba(58,109,240,.22),rgba(124,92,255,.16));border-bottom:1px solid rgba(255,255,255,.08)}',
    '.ma-head .av{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#3a6df0,#7c5cff);display:grid;place-items:center;font-weight:900;color:#fff;font-size:17px}',
    '.ma-head .t{font:800 15px Inter,system-ui,sans-serif;color:#fff}',
    '.ma-head .s{font:600 11.5px Inter,system-ui,sans-serif;color:#34d399;display:flex;align-items:center;gap:5px}',
    '.ma-head .s::before{content:"";width:7px;height:7px;border-radius:50%;background:#34d399}',
    '.ma-head .sp{flex:1}',
    '.ma-ic{background:rgba(255,255,255,.08);border:0;color:#cdd6ee;width:32px;height:32px;border-radius:50%;font-size:15px;cursor:pointer}',
    '.ma-ic:hover{background:rgba(255,255,255,.16)}',
    '.ma-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin}',
    '.ma-msg{max-width:84%;padding:10px 13px;border-radius:16px;font:400 13.5px/1.55 Inter,system-ui,sans-serif;word-wrap:break-word;white-space:pre-wrap}',
    '.ma-msg.u{align-self:flex-end;background:linear-gradient(135deg,#3a6df0,#7c5cff);color:#fff;border-bottom-right-radius:5px}',
    '.ma-msg.a{align-self:flex-start;background:#161d38;color:#e7ecff;border-bottom-left-radius:5px}',
    '.ma-msg.a a{color:#7fa9ff}',
    '.ma-msg.a code{background:rgba(255,255,255,.1);padding:1px 5px;border-radius:5px;font-family:ui-monospace,Consolas,monospace;font-size:12px}',
    '.ma-msg img{max-width:180px;border-radius:10px;display:block;margin-top:6px}',
    '.ma-sugg{display:flex;flex-wrap:wrap;gap:7px;align-self:flex-start;max-width:100%}',
    '.ma-sugg button{background:rgba(124,92,255,.12);border:1px solid rgba(124,92,255,.3);color:#bcc6ff;font:600 12px Inter,system-ui,sans-serif;padding:7px 12px;border-radius:14px;cursor:pointer;text-align:left}',
    '.ma-sugg button:hover{background:rgba(124,92,255,.22);color:#fff}',
    '.ma-typing{align-self:flex-start;background:#161d38;border-radius:16px;padding:13px 15px;display:flex;gap:4px}',
    '.ma-typing span{width:7px;height:7px;border-radius:50%;background:#7c84a8;animation:maBlink 1.2s infinite}',
    '.ma-typing span:nth-child(2){animation-delay:.2s}.ma-typing span:nth-child(3){animation-delay:.4s}',
    '@keyframes maBlink{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}',
    '.ma-foot{border-top:1px solid rgba(255,255,255,.08);padding:10px 12px;background:#0c1226}',
    '.ma-prev{display:none;align-items:center;gap:8px;margin-bottom:8px;background:#161d38;border-radius:10px;padding:6px 8px}',
    '.ma-prev img{width:34px;height:34px;border-radius:7px;object-fit:cover}',
    '.ma-prev .x{margin-left:auto;background:none;border:0;color:#9aa6cf;cursor:pointer;font-size:15px}',
    '.ma-inwrap{display:flex;align-items:flex-end;gap:8px}',
    '.ma-attach{background:rgba(255,255,255,.07);border:0;color:#9aa6cf;width:38px;height:38px;border-radius:11px;cursor:pointer;font-size:17px;flex:0 0 auto}',
    '.ma-attach:hover{color:#fff}',
    '.ma-input{flex:1;min-height:38px;max-height:120px;background:#11162c;border:1px solid rgba(255,255,255,.1);color:#eef1ff;border-radius:12px;padding:9px 12px;font:400 13.5px Inter,system-ui,sans-serif;resize:none;outline:none;line-height:1.4}',
    '.ma-input:focus{border-color:rgba(58,109,240,.6)}',
    '.ma-send{flex:0 0 auto;width:38px;height:38px;border:0;border-radius:11px;cursor:pointer;color:#fff;font-size:17px;background:linear-gradient(135deg,#3a6df0,#7c5cff)}',
    '.ma-send:disabled{opacity:.5;cursor:default}',
    '.ma-drag{position:absolute;inset:0;background:rgba(58,109,240,.22);border:2px dashed #7c5cff;border-radius:22px;display:none;align-items:center;justify-content:center;color:#fff;font:700 14px Inter,sans-serif;z-index:5}',
    '@media(max-width:480px){.ma-panel{right:8px;bottom:8px;width:calc(100vw - 16px);height:calc(100vh - 16px)}.ma-fab{bottom:74px}}'
  ].join('\n');

  var hist = [];
  try { hist = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!Array.isArray(hist)) hist = []; } catch (e) { hist = []; }
  var pendingImg = null;

  function save() { try { localStorage.setItem(KEY, JSON.stringify(hist.slice(-40))); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }
  function md(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  }

  /* ── Local rule-based brain (no AI API / no key needed) ──────── */
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  var KB = [
    { k: [' hi ', 'hello', 'hey ', 'namaste', 'helo', ' hii', 'yo ', 'hola', 'salaam'], a: [
      "Namaste! 🙏 Main MILAN Assistant. Kaise help karoon?",
      "Hello! 😊 Posting, music, settings — kuch bhi poochho." ] },
    { k: ['music', 'song', 'gaana', 'gana', 'bollywood', 'hollywood', 'play song', 'audio', 'sun'], a: [
      "🎵 Niche-left **Music** button dabao (ya /music kholo) — Bollywood, Hollywood, sab search karke app ke andar hi sun sakte ho!" ] },
    { k: ['post', 'likho', 'caption', 'share', 'status', 'create', 'daal', 'photo upload', 'video upload'], a: [
      "Post banane ke liye compose (+) box me likho, photo/video add karo, audience choose karo (private by default), aur **Share** dabao. 🚀 Caption me help chahiye to topic batao!" ] },
    { k: ['theme', 'creative', 'dark mode', 'look', 'colour', 'color', 'design', 'ui change'], a: [
      "🎨 Niche-right **Creative Mode** button dabao — 10 themes (Aurora, Sunset, Cyberpunk, Sakura...) me se koi bhi **ek click** me lagao. Poora UI badal jayega!" ] },
    { k: ['2fa', 'two factor', 'two-factor', 'authenticator', 'otp', 'totp'], a: [
      "🛡️ Two-factor on karne ke liye **Settings → Security → 'Set up two-factor'**. Google Authenticator/Authy se code scan karo — account aur secure!" ] },
    { k: ['password', 'reset', 'forgot', 'bhul', 'change pass'], a: [
      "Password change: **Settings → Security → Change password**. Bhool gaye? Login page pe **'Forgot password?'** → email pe reset link aayega." ] },
    { k: ['verify', 'verification', 'confirm email', 'email confirm'], a: [
      "Email verify karne ke liye signup ke baad aayi mail ka link/6-digit code use karo, ya **/verify-email** pe jaake resend karo." ] },
    { k: ['block', 'unblock'], a: [
      "Kisi ko block/unblock karne ke liye **Settings → Blocking** me uska DID ya email daalo." ] },
    { k: ['privacy', 'who can see', 'kaun dekh', 'visible', 'audience', 'search by email', 'kaun message'], a: [
      "🔒 Privacy aapke haath me — **Settings → Privacy**: kaun aapko dekh sake, friend-request bheje ya message kare, sab set karo. Sab aapke DWN me save." ] },
    { k: ['delete account', 'deactivate', 'remove account', 'data download', 'export', 'download my'], a: [
      "**Settings → Your data**: data download, account **deactivate** (login se wapas active), ya **delete** (password confirm ke saath)." ] },
    { k: ['friend', 'people', 'connect', 'request', 'follow', 'dost', 'add karo'], a: [
      "Logo se judne ke liye **People** me search karke friend request bhejo. Request aane pe notification + email milega." ] },
    { k: ['notification', 'email alert', 'alerts', 'mail setting'], a: [
      "**Settings → Notifications** me har cheez (comment, reaction, friend request, login alert) ka email toggle on/off kar sakte ho." ] },
    { k: ['decentral', 'dwn', ' did', 'web5', 'own your', 'kaise kaam', 'how does', 'blockchain', 'self sovereign'], a: [
      "MILAN ek **privacy-first decentralized** network hai 🌐 — har user ka apna **DWN** (data node) aur **DID** hota hai, to data sirf aapka. Koi ads, tracking ya data-selling nahi." ] },
    { k: ['who are you', 'your name', 'tum kaun', 'kaun ho', 'aap kaun'], a: [
      "Main **MILAN Assistant** hoon 🤖 — app ke andar aapki madad ke liye. MILAN ke har feature ke baare me jaanta hoon!" ] },
    { k: ['thank', 'shukriya', 'dhanyavad', 'thanks', 'thx', 'great', 'badhiya', 'nice'], a: [
      "Koi baat nahi! 😊 Aur kuch chahiye to bata dena.", "Khushi hui help karke! 🙏" ] },
    { k: ['help', 'what can you', 'kya kar', 'capab', 'options', 'madad', 'menu'], a: [
      "Main in sab me help karta hoon 👇\n• **Posting** & captions\n• **Music** (Bollywood/Hollywood)\n• **Privacy** & settings\n• **2FA** & security\n• **Themes**\n• **Friends**\nKuch bhi type karo!" ] }
  ];
  function answer(text, img) {
    var t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ') + ' ';
    if (img && t.trim().length < 4) return "Sundar image! 📸 Ise post karne ke liye app me **compose (+)** button use karo — drag/drop ya select karke add ho jayegi.";
    for (var i = 0; i < KB.length; i++) for (var j = 0; j < KB[i].k.length; j++) if (t.indexOf(KB[i].k[j]) >= 0) return pick(KB[i].a);
    return "Hmm, isme main sure nahi 🤔 — par MILAN ke baare me madad kar sakta hoon: **posting, music, privacy/settings, 2FA, themes, friends**. Inme se kuch poochho, ya **help** likho.";
  }

  var panel, body, input;

  function bubble(role, text, img) {
    var d = document.createElement('div');
    d.className = 'ma-msg ' + (role === 'user' ? 'u' : 'a');
    d.innerHTML = (text ? md(text) : '') + (img ? '<img src="' + esc(img) + '" alt="attachment">' : '');
    body.appendChild(d); scrollDown(); return d;
  }
  function scrollDown() { body.scrollTop = body.scrollHeight; }

  function suggestions() {
    var w = document.createElement('div'); w.className = 'ma-sugg';
    w.innerHTML = SUGGEST.map(function (s) { return '<button>' + esc(s) + '</button>'; }).join('');
    body.appendChild(w);
    Array.prototype.forEach.call(w.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { w.remove(); send(b.textContent); });
    });
    scrollDown();
  }

  function renderHistory() {
    body.innerHTML = '';
    bubble('assistant', "Namaste! 🙏 Main MILAN Assistant hoon. Posting, settings, music, privacy — kuch bhi poochho. Aap Hindi ya English me baat kar sakte ho.");
    hist.forEach(function (m) { bubble(m.role, m.content, m.img); });
    if (!hist.length) suggestions();
  }

  function send(text) {
    text = (text != null ? text : input.value).trim();
    if (!text && !pendingImg) return;
    var img = pendingImg;
    bubble('user', text, img);
    hist.push({ role: 'user', content: text + (img ? ' (image attached)' : ''), img: img });
    save();
    input.value = ''; input.style.height = 'auto'; clearPreview();

    var typing = document.createElement('div'); typing.className = 'ma-typing';
    typing.innerHTML = '<span></span><span></span><span></span>'; body.appendChild(typing); scrollDown();

    // Local rule-based reply — no API, no key, fully offline.
    var reply = answer(text, img);
    setTimeout(function () {
      typing.remove();
      bubble('assistant', reply);
      hist.push({ role: 'assistant', content: reply }); save();
    }, 480 + Math.random() * 520);
  }

  /* media attach */
  function setPreview(dataUrl) {
    pendingImg = dataUrl;
    var p = panel.querySelector('.ma-prev');
    p.querySelector('img').src = dataUrl; p.style.display = 'flex';
  }
  function clearPreview() { pendingImg = null; var p = panel.querySelector('.ma-prev'); if (p) p.style.display = 'none'; }
  function readFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    var r = new FileReader(); r.onload = function () { setPreview(r.result); }; r.readAsDataURL(file);
  }

  function build() {
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    var fab = document.createElement('button');
    fab.className = 'ma-fab'; fab.title = 'MILAN Assistant';
    fab.innerHTML = '<span class="av" style="overflow:hidden;padding:0"><img src="/assets/icon-192.png" alt="" style="width:100%;height:100%;object-fit:cover"></span><span>Ask MILAN</span><span class="dot"></span>';
    document.body.appendChild(fab);

    panel = document.createElement('div'); panel.className = 'ma-panel';
    panel.innerHTML =
      '<div class="ma-drag">Drop image to attach 📎</div>' +
      '<div class="ma-head"><div class="av" style="overflow:hidden"><img src="/assets/icon-192.png" alt="MILAN" style="width:100%;height:100%;object-fit:cover"></div><div><div class="t">MILAN Assistant</div><div class="s">Online</div></div><div class="sp"></div>' +
        '<button class="ma-ic ma-clear" title="Clear chat">🗑</button><button class="ma-ic ma-close" title="Close">✕</button></div>' +
      '<div class="ma-body"></div>' +
      '<div class="ma-foot">' +
        '<div class="ma-prev"><img alt="preview"><span style="font-size:12px;color:#9aa6cf">Image attached</span><button class="x" title="Remove">✕</button></div>' +
        '<div class="ma-inwrap">' +
          '<button class="ma-attach" title="Attach image">📎</button>' +
          '<textarea class="ma-input" rows="1" placeholder="Type a message…"></textarea>' +
          '<button class="ma-send" title="Send">➤</button>' +
        '</div></div>';
    document.body.appendChild(panel);

    body = panel.querySelector('.ma-body');
    input = panel.querySelector('.ma-input');
    var fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';
    panel.appendChild(fileInput);

    function open() { panel.classList.add('open'); fab.style.display = 'none'; if (!body.childNodes.length) renderHistory(); input.focus(); }
    function close() { panel.classList.remove('open'); fab.style.display = 'flex'; }
    fab.addEventListener('click', open);
    panel.querySelector('.ma-close').addEventListener('click', close);
    panel.querySelector('.ma-clear').addEventListener('click', function () { hist = []; save(); renderHistory(); });
    panel.querySelector('.ma-send').addEventListener('click', function () { send(); });
    panel.querySelector('.ma-attach').addEventListener('click', function () { fileInput.click(); });
    panel.querySelector('.ma-prev .x').addEventListener('click', clearPreview);
    fileInput.addEventListener('change', function () { readFile(fileInput.files[0]); fileInput.value = ''; });

    input.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(120, this.scrollHeight) + 'px'; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    input.addEventListener('paste', function (e) {
      var items = (e.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++) if (items[i].type && items[i].type.indexOf('image') === 0) readFile(items[i].getAsFile());
    });

    var drag = panel.querySelector('.ma-drag');
    panel.addEventListener('dragover', function (e) { e.preventDefault(); drag.style.display = 'flex'; });
    panel.addEventListener('dragleave', function (e) { if (e.target === panel || e.target === drag) drag.style.display = 'none'; });
    panel.addEventListener('drop', function (e) { e.preventDefault(); drag.style.display = 'none'; if (e.dataTransfer && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
