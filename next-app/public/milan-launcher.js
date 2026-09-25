/*! MILAN — quick launcher: always-visible Music button (works on mobile too). */
(function () {
  'use strict';
  if (window.__milanLauncher) return;
  window.__milanLauncher = true;

  var css = [
    '.mlz-fab{position:fixed;left:16px;bottom:18px;z-index:99997;display:flex;align-items:center;gap:8px;',
    'padding:11px 16px 11px 13px;border-radius:999px;border:0;cursor:pointer;font:800 13px Inter,system-ui,sans-serif;',
    'color:#fff;background:linear-gradient(135deg,#7c5cff,#f472b6);box-shadow:0 10px 28px rgba(124,92,255,.45);',
    'text-decoration:none;transition:transform .18s,box-shadow .18s;}',
    '.mlz-fab:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 14px 36px rgba(244,114,182,.5);}',
    '.mlz-fab:active{transform:scale(.96);}',
    '.mlz-fab .ic{font-size:18px;line-height:1;}',
    '@media(max-width:780px){.mlz-fab{bottom:74px;left:12px;padding:10px 14px;font-size:12px;}.mlz-fab .lbl{display:none;}}'
  ].join('');

  function boot() {
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    var a = document.createElement('a');
    a.className = 'mlz-fab'; a.href = '/music'; a.title = 'MILAN Music';
    a.innerHTML = '<span class="ic">🎵</span><span class="lbl">Music</span>';
    document.body.appendChild(a);
  }
  if (window.__milanAppReady) boot(); else window.addEventListener('milan:app-ready', boot, {once:true});
})();
