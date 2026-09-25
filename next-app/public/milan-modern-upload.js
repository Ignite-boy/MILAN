/* ============================================================
   MILAN — Modern Media Upload + Inline AI Composer Assist
   Progressive enhancement: upgrades the existing #mediaFile input
   into a drag-and-drop dropzone with thumbnail previews, and adds
   AI writing helpers to the composer. No backend changes to publish
   flow — it reuses the same #mediaFile input the publish() reads.
   ============================================================ */
(function () {
  'use strict';
  if (window.__milanModernUploadV1) return;
  window.__milanModernUploadV1 = true;

  var ACCENT = '#4f7cf6';

  /* ---------- styles ---------- */
  var css = document.createElement('style');
  css.textContent = [
    '.milan-dropzone{position:relative;border:1.5px dashed rgba(148,163,196,.32);border-radius:16px;background:rgba(148,163,196,.04);padding:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:border-color .18s,background .18s;text-align:center;min-height:96px}',
    '.milan-dropzone:hover{border-color:rgba(79,124,246,.5);background:rgba(79,124,246,.06)}',
    '.milan-dropzone.dragover{border-color:' + ACCENT + ';background:rgba(79,124,246,.12)}',
    '.milan-dz-icon{font-size:26px;opacity:.8}',
    '.milan-dz-title{font-weight:650;font-size:14px;color:var(--text,#eef1f8)}',
    '.milan-dz-sub{font-size:12px;color:var(--muted,#97a2bd)}',
    '.milan-dz-browse{color:' + ACCENT + ';text-decoration:underline;cursor:pointer}',
    '.milan-dz-preview{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border:1px solid rgba(148,163,196,.18);border-radius:14px;background:rgba(148,163,196,.05)}',
    '.milan-dz-thumb{width:54px;height:54px;border-radius:11px;object-fit:cover;background:#0d1322;flex-shrink:0;display:grid;place-items:center;font-size:22px;color:var(--muted,#97a2bd)}',
    '.milan-dz-meta{flex:1;min-width:0}',
    '.milan-dz-meta b{display:block;font-size:13px;color:var(--text,#eef1f8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.milan-dz-meta span{font-size:12px;color:var(--muted,#97a2bd)}',
    '.milan-dz-remove{background:transparent;border:1px solid rgba(148,163,196,.25);color:var(--muted,#97a2bd);border-radius:10px;padding:6px 10px;font-size:12px;cursor:pointer;flex-shrink:0}',
    '.milan-dz-remove:hover{color:#e5645f;border-color:rgba(229,100,95,.4)}',
    '.milan-ai-assist{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;align-items:center}',
    '.milan-ai-assist .lbl{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#97a2bd);margin-right:2px}',
    '.milan-ai-btn{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:10px;border:1px solid rgba(148,163,196,.22);background:rgba(148,163,196,.05);color:var(--text,#eef1f8);cursor:pointer;transition:.15s}',
    '.milan-ai-btn:hover{border-color:rgba(79,124,246,.5);background:rgba(79,124,246,.08);color:#9fc0ff}',
    '.milan-ai-btn:disabled{opacity:.55;cursor:wait}',
    '.milan-ai-hint{font-size:11px;color:var(--muted,#97a2bd);width:100%;margin-top:2px}'
  ].join('');
  document.head.appendChild(css);

  function fmtBytes(n) {
    n = Number(n || 0); if (!n) return '';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + u[i];
  }
  function kindIcon(type) {
    type = type || '';
    if (type.indexOf('image/') === 0) return '🖼️';
    if (type.indexOf('video/') === 0) return '🎬';
    if (type.indexOf('audio/') === 0) return '🎧';
    if (type.indexOf('pdf') >= 0) return '📄';
    return '📎';
  }
  function getComposer() { return document.querySelector('.composer'); }
  function getTextarea() { return document.querySelector('.composer textarea') || document.getElementById('postText'); }

  /* ---------- 1) Modern dropzone ---------- */
  function buildDropzone() {
    var input = document.getElementById('mediaFile');
    if (!input || input.dataset.milanDz === '1') return;
    input.dataset.milanDz = '1';

    // Hide the raw input, keep it in DOM (publish() reads its .files)
    input.style.display = 'none';

    var dz = document.createElement('div');
    dz.className = 'milan-dropzone';
    dz.setAttribute('role', 'button');
    dz.setAttribute('tabindex', '0');
    dz.innerHTML =
      '<div class="milan-dz-icon">⬆️</div>' +
      '<div class="milan-dz-title">Add a photo, video or file</div>' +
      '<div class="milan-dz-sub">Drag &amp; drop here, or <span class="milan-dz-browse">browse</span></div>';

    var preview = document.createElement('div');
    preview.className = 'milan-dz-preview';
    preview.style.display = 'none';

    input.parentNode.insertBefore(dz, input);
    input.parentNode.insertBefore(preview, input.nextSibling);

    function showPreview(file) {
      if (!file) { preview.style.display = 'none'; dz.style.display = 'flex'; return; }
      dz.style.display = 'none';
      preview.style.display = 'flex';
      var thumbHtml;
      if (file.type && file.type.indexOf('image/') === 0) {
        var url = URL.createObjectURL(file);
        thumbHtml = '<img class="milan-dz-thumb" src="' + url + '" alt="preview">';
      } else {
        thumbHtml = '<div class="milan-dz-thumb">' + kindIcon(file.type) + '</div>';
      }
      preview.innerHTML =
        thumbHtml +
        '<div class="milan-dz-meta"><b></b><span>' + (file.type || 'file') + (file.size ? ' • ' + fmtBytes(file.size) : '') + '</span></div>' +
        '<button type="button" class="milan-dz-remove">Remove</button>';
      preview.querySelector('b').textContent = file.name || 'Selected file';
      preview.querySelector('.milan-dz-remove').onclick = function () {
        try { input.value = ''; } catch (_) {}
        showPreview(null);
      };
    }

    function setFile(files) {
      if (!files || !files.length) return;
      try {
        var dt = new DataTransfer();
        dt.items.add(files[0]);
        input.files = dt.files;
      } catch (_) { /* DataTransfer unsupported: input change still fires natively */ }
      showPreview(files[0]);
    }

    dz.addEventListener('click', function () { input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', function () { if (input.files && input.files[0]) showPreview(input.files[0]); });

    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) setFile(files);
    });

    // If publish clears the input later, reset preview too
    var pub = document.getElementById('publishBtn');
    if (pub) pub.addEventListener('click', function () {
      setTimeout(function () { if (!input.value) showPreview(null); }, 1500);
    });
  }

  /* ---------- 2) Inline AI composer assist ---------- */
  function buildAIAssist() {
    var composer = getComposer();
    if (!composer || composer.dataset.milanAssist === '1') return;
    composer.dataset.milanAssist = '1';
    var ta = getTextarea();
    if (!ta) return;

    var bar = document.createElement('div');
    bar.className = 'milan-ai-assist';
    bar.innerHTML =
      '<span class="lbl">AI help</span>' +
      '<button type="button" class="milan-ai-btn" data-act="improve">✨ Improve</button>' +
      '<button type="button" class="milan-ai-btn" data-act="shorten">✂️ Shorten</button>' +
      '<button type="button" class="milan-ai-btn" data-act="fix">✓ Fix grammar</button>' +
      '<button type="button" class="milan-ai-btn" data-act="hashtags"># Hashtags</button>' +
      '<button type="button" class="milan-ai-btn" data-act="ideas">💡 Ideas</button>' +
      '<div class="milan-ai-hint"></div>';
    // Place right under the textarea row
    ta.parentNode.insertBefore(bar, ta.nextSibling);

    var hint = bar.querySelector('.milan-ai-hint');

    bar.querySelectorAll('.milan-ai-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.dataset.act;
        var text = (ta.value || '').trim();
        if (!text && act !== 'ideas') { hint.textContent = 'Write something first, then let AI help.'; return; }
        var old = btn.textContent;
        bar.querySelectorAll('.milan-ai-btn').forEach(function (b) { b.disabled = true; });
        btn.textContent = '…';
        hint.textContent = 'Thinking…';
        fetch('/api/ai/assist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, action: act })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (!d.success) throw new Error(d.error || 'AI unavailable');
          var out = (d.result || '').trim();
          if (!out) { hint.textContent = d.note || 'Nothing to suggest.'; return; }
          if (act === 'hashtags') {
            ta.value = (text ? text.replace(/\s+$/, '') + '\n\n' : '') + out;
          } else if (act === 'ideas') {
            ta.value = out;
          } else {
            ta.value = out;
          }
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          hint.textContent = d.ai === false ? 'Done (built-in suggestion — add an AI key for smarter results).' : 'Done ✓';
          try { ta.focus(); } catch (_) {}
        }).catch(function (e) {
          hint.textContent = e.message || 'AI is unavailable right now.';
        }).finally(function () {
          bar.querySelectorAll('.milan-ai-btn').forEach(function (b) { b.disabled = false; });
          btn.textContent = old;
        });
      });
    });
  }

  function init() {
    buildDropzone();
    buildAIAssist();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 300); });
  } else {
    setTimeout(init, 300);
  }
  // Re-run after the app shell appears (composer may render late)
  setTimeout(init, 1200);
  setTimeout(init, 3000);
})();
