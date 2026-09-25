/*!
 * MILAN — Effortless Auto-Upload
 * User ko manually browse/select kuch nahi karna. Bas file ko kahin bhi
 * DRAG-DROP ya PASTE karo — file khud composer me lag jaati hai, preview
 * aa jaata hai, aur ek-tap (ya auto) Publish.
 * Reuses the app's existing #mediaFile + #publishBtn pipeline.
 */
(function () {
  'use strict';
  if (window.__milanAutoUpload) return;
  window.__milanAutoUpload = true;

  var MEDIA = ['image/', 'video/', 'audio/'];
  function el(id) { return document.getElementById(id); }
  function isMedia(f) { for (var i = 0; i < MEDIA.length; i++) if (f.type && f.type.indexOf(MEDIA[i]) === 0) return true; return /\.(mp4|mov|m4v|webm|mkv|avi|3gp|mpeg|mpg|jpg|jpeg|png|gif|webp|heic|mp3|wav|m4a)$/i.test(f.name || ''); }

  function targetInput(file) {
    var media = el('mediaFile');
    var attach = el('milan-attach-input');
    if (isMedia(file)) return media || attach;
    return attach || media;            // pdf/doc/txt -> attach input if present
  }

  function setFile(input, file) {
    if (!input) return false;
    try {
      var dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) { return false; }
  }

  function scrollToComposer() {
    var c = el('postText') || el('mediaFile');
    if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var t = el('postText'); if (t) try { t.focus(); } catch (e) {}
  }

  /* ── UI: full-screen drop overlay + ready banner ──────────── */
  var CSS = [
    '.mau-ov{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;background:rgba(8,9,14,.72);backdrop-filter:blur(8px)}',
    '.mau-ov.show{display:flex;animation:mauF .15s ease}',
    '@keyframes mauF{from{opacity:0}to{opacity:1}}',
    '.mau-box{width:min(560px,86vw);min-height:300px;border:2px dashed rgba(216,179,90,.7);border-radius:26px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(216,179,90,.06);color:#f4ecd6;text-align:center;padding:30px}',
    '.mau-box .ic{font-size:60px;animation:mauBob 1.4s ease-in-out infinite}',
    '@keyframes mauBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}',
    '.mau-box h3{font:800 22px Inter,system-ui,sans-serif;margin:0;color:#fff}',
    '.mau-box p{font:500 14px Inter,system-ui,sans-serif;color:#cdbf99;margin:0;max-width:380px;line-height:1.5}',
    '.mau-pick{margin-top:6px;background:linear-gradient(135deg,#d8b35a,#ecca7e);color:#1b1306;border:0;border-radius:14px;padding:11px 22px;font:800 14px Inter,sans-serif;cursor:pointer}',
    '.mau-banner{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);z-index:100001;display:none;align-items:center;gap:12px;background:#13151d;border:1px solid rgba(216,179,90,.4);border-radius:16px;padding:11px 14px;box-shadow:0 16px 44px rgba(0,0,0,.5);opacity:0;transition:opacity .25s,transform .25s;max-width:calc(100vw - 28px)}',
    '.mau-banner.show{display:flex;opacity:1;transform:translateX(-50%) translateY(0)}',
    '.mau-banner img{width:42px;height:42px;border-radius:9px;object-fit:cover;background:#222;flex:0 0 auto}',
    '.mau-banner .fi{width:42px;height:42px;border-radius:9px;display:grid;place-items:center;font-size:20px;background:rgba(216,179,90,.16);flex:0 0 auto}',
    '.mau-banner .m{min-width:0}',
    '.mau-banner .m b{display:block;font:700 13px Inter,sans-serif;color:#f4ecd6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}',
    '.mau-banner .m span{font:500 11.5px Inter,sans-serif;color:#9aa1b4}',
    '.mau-banner button{border:0;border-radius:11px;padding:9px 14px;font:800 12.5px Inter,sans-serif;cursor:pointer;flex:0 0 auto}',
    '.mau-post{background:linear-gradient(135deg,#d8b35a,#ecca7e);color:#1b1306}',
    '.mau-x{background:rgba(255,255,255,.08);color:#cdd6ee}',
    '.mau-prog{position:absolute;left:0;bottom:0;height:3px;border-radius:0 0 16px 16px;background:linear-gradient(90deg,#d8b35a,#ecca7e);width:0}'
  ].join('\n');

  var overlay, banner, fileInput, dragDepth = 0, autoTimer = null, current = null;

  function showOverlay(s) { overlay.classList.toggle('show', s); }

  function showBanner(file) {
    clearTimeout(autoTimer);
    banner.querySelector('.mau-prog').style.width = '0';
    var thumb = banner.querySelector('.thumb');
    if (isMedia(file) && /^image\//.test(file.type)) {
      var url = URL.createObjectURL(file);
      thumb.outerHTML = '<img class="thumb" alt="" src="' + url + '">';
    } else {
      thumb.outerHTML = '<div class="thumb fi">' + (/^video\//.test(file.type) ? '🎬' : /^audio\//.test(file.type) ? '🎵' : '📄') + '</div>';
    }
    banner.querySelector('b').textContent = file.name || 'File';
    banner.querySelector('.sz').textContent = Math.max(1, Math.round(file.size / 1024)) + ' KB · ready to post';
    banner.classList.add('show');
    // gentle auto-post countdown (cancellable) so user kuch na kare
    var prog = banner.querySelector('.mau-prog'), t0 = Date.now(), DUR = 6000;
    (function tick() {
      var p = (Date.now() - t0) / DUR;
      prog.style.width = Math.min(100, p * 100) + '%';
      if (p >= 1) { doPublish(); return; }
      autoTimer = setTimeout(tick, 60);
    })();
  }
  function hideBanner() { clearTimeout(autoTimer); banner.classList.remove('show'); }

  function doPublish() {
    clearTimeout(autoTimer);
    // Auto-fill a friendly title from the filename if user left it empty (so a no-caption post still works).
    if (current) {
      var ti = el('postTitle');
      if (ti && !ti.value.trim()) { ti.value = String(current.name || 'My upload').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80); ti.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    var btn = el('publishBtn');
    if (btn) btn.click();
    hideBanner();
  }

  function handleFiles(files) {
    if (!files || !files.length) return;
    var file = files[0];
    var input = targetInput(file);
    if (!input) { toast('Composer ready nahi — pehle app me aao.'); return; }
    if (!setFile(input, file)) { toast('File set nahi ho payi, dobara try karo.'); return; }
    current = file;
    scrollToComposer();
    showBanner(file);
  }

  function toast(msg) {
    if (window.toast) { try { window.toast(msg); return; } catch (e) {} }
    console.log('[MILAN auto-upload]', msg);
  }

  function build() {
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    overlay = document.createElement('div'); overlay.className = 'mau-ov';
    overlay.innerHTML = '<div class="mau-box"><div class="ic">📤</div><h3>Drop to share on MILAN</h3>' +
      '<p>File yahin chhod do — automatically aapke post me lag jaayegi. Manually kuch select karne ki zaroorat nahi.</p>' +
      '<button class="mau-pick">Or choose a file</button></div>';
    document.body.appendChild(overlay);

    banner = document.createElement('div'); banner.className = 'mau-banner';
    banner.innerHTML = '<div class="thumb fi">📄</div><div class="m"><b>File</b><span class="sz">ready</span></div>' +
      '<button class="mau-post">Post now</button><button class="mau-x">Cancel</button><div class="mau-prog"></div>';
    document.body.appendChild(banner);

    fileInput = document.createElement('input'); fileInput.type = 'file';
    fileInput.accept = 'image/*,video/*,audio/*,.pdf,.txt,.md,.csv'; fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    fileInput.addEventListener('change', function () { if (fileInput.files[0]) handleFiles(fileInput.files); fileInput.value = ''; });

    overlay.querySelector('.mau-pick').addEventListener('click', function (e) { e.stopPropagation(); showOverlay(false); dragDepth = 0; fileInput.click(); });
    overlay.addEventListener('click', function () { showOverlay(false); dragDepth = 0; });
    banner.querySelector('.mau-post').addEventListener('click', doPublish);
    banner.querySelector('.mau-x').addEventListener('click', hideBanner);

    // Drag tracking across the whole window
    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; showOverlay(true);
    });
    window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; dragDepth--; if (dragDepth <= 0) { dragDepth = 0; showOverlay(false); } });
    window.addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault(); dragDepth = 0; showOverlay(false); handleFiles(e.dataTransfer.files);
    });
    // Paste image/file from clipboard
    window.addEventListener('paste', function (e) {
      var items = (e.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') { var f = items[i].getAsFile(); if (f) { handleFiles([f]); break; } }
      }
    });
  }
  function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; if (!t) return false; for (var i = 0; i < t.length; i++) if (t[i] === 'Files') return true; return false; }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
