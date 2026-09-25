/*!
 * MILAN — YouTube to Feed
 *  1) Composer "🎬 YouTube" button: search any video by name and add it to your post.
 *  2) Feed enhancer: any YouTube link in a post renders as a responsive embedded player.
 *  Same on desktop and mobile/PWA. Uses the app's /api/music/search proxy.
 */
(function () {
  'use strict';
  if (window.__milanYtFeed) return;
  window.__milanYtFeed = true;

  function vidId(s) {
    var m = String(s || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }

  // Lazy-load facade thumbnails only when the post nears the viewport (saves data + improves LCP).
  var _io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target, bg = el.getAttribute('data-bg');
      if (bg) { el.style.backgroundImage = 'url(' + bg + ')'; el.removeAttribute('data-bg'); }
      _io.unobserve(el);
    });
  }, { rootMargin: '300px' }) : null;

  /* ── 1) Feed embeds ─────────────────────────────────────────── */
  // Fast "facade" embed: thumbnail + big premium play button; loads the real
  // player only on click. The 🎧 button plays audio-only through a page-owned
  // <audio> element (server proxy /api/music/stream/:id) — that is the only
  // playback mobile browsers keep running when the app is backgrounded; the
  // YouTube iframe always gets force-paused there.
  var bgAudio = null, bgBox = null;
  function sharedAudio() {
    if (bgAudio) return bgAudio;
    bgAudio = document.createElement('audio');
    bgAudio.preload = 'none';
    document.body.appendChild(bgAudio);
    var sync = function () {
      if (!bgBox) return;
      var pp = bgBox.querySelector('.myt-pp');
      if (pp) pp.textContent = bgAudio.paused ? '▶' : '⏸';
      if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = bgAudio.paused ? 'paused' : 'playing'; } catch (e) {}
    };
    bgAudio.addEventListener('play', sync);
    bgAudio.addEventListener('pause', sync);
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', function () { bgAudio.play().catch(function () {}); });
        navigator.mediaSession.setActionHandler('pause', function () { bgAudio.pause(); });
      } catch (e) {}
    }
    return bgAudio;
  }
  function stopBgAudio() {
    if (!bgAudio) return;
    try { bgAudio.pause(); bgAudio.removeAttribute('src'); bgAudio.load(); } catch (e) {}
    bgBox = null;
  }
  function postTitle(d) {
    var p = d.closest('.post,[data-post],.feedItem');
    var t = p && p.querySelector('.postTitle,.post-title,.title');
    return (t && t.textContent.trim()) || 'YouTube audio';
  }
  function facadeHtml(d, id) {
    d.classList.add('facade');
    d.style.cursor = 'pointer'; d.style.backgroundImage = 'url(https://i.ytimg.com/vi/' + id + '/hqdefault.jpg)';
    d.innerHTML = '<div class="myt-grad"></div><div class="myt-play">▶</div><div class="myt-badge">▶ YouTube</div><div class="myt-abadge" title="Listen with the screen off">🎧 Audio</div>';
  }
  function loadIframe(d, id) {
    d.classList.remove('facade'); d.style.cursor = 'default'; d.style.backgroundImage = 'none';
    d.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1&modestbranding=1&enablejsapi=1&mbg=1" title="YouTube video" frameborder="0" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture;web-share" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe>' +
      '<button class="myt-bg" type="button" title="Listen in background">🎧</button>';
  }
  function playAudioIn(d, id) {
    if (bgBox && bgBox !== d) { var oldId = bgBox.getAttribute('data-myt-id'); facadeHtml(bgBox, oldId); }
    var a = sharedAudio();
    bgBox = d;
    d.classList.remove('facade'); d.style.cursor = 'default';
    d.style.backgroundImage = 'url(https://i.ytimg.com/vi/' + id + '/hqdefault.jpg)';
    var title = postTitle(d);
    d.innerHTML = '<div class="myt-grad"></div><div class="myt-audio">🎧<span class="tt">' + esc(title) + '</span>' +
      '<button class="myt-pp" type="button" title="Play / pause">⏸</button>' +
      '<button class="myt-vv" type="button" title="Watch video">▶ Video</button></div>' +
      '<div class="myt-badge">🎧 Background audio — keeps playing when you leave</div>';
    a.onerror = function () {
      if (bgBox !== d) return;
      var tt = d.querySelector('.tt'); if (tt) tt.textContent = 'Audio unavailable — opening video…';
      setTimeout(function () { if (bgBox === d) { stopBgAudio(); loadIframe(d, id); } }, 1000);
    };
    a.src = '/api/music/stream/' + id;
    a.play().catch(function () {});
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title, artist: 'MILAN', album: 'MILAN Feed',
          artwork: [{ src: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', sizes: '480x360', type: 'image/jpeg' }]
        });
      } catch (e) {}
    }
  }
  function embed(id) {
    var d = document.createElement('div');
    d.className = 'myt-embed';
    d.setAttribute('data-myt-id', id);
    d.style.cssText = 'position:relative;width:100%;aspect-ratio:16/9;border-radius:14px;overflow:hidden;margin-top:10px;cursor:pointer;border:1px solid rgba(255,255,255,.08);background:#000 center/cover no-repeat';
    var thumb = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
    facadeHtml(d, id);
    if (_io) { d.style.backgroundImage = 'none'; d.setAttribute('data-bg', thumb); _io.observe(d); }
    d.addEventListener('click', function (e) {
      if (e.target.closest('.myt-abadge') || e.target.closest('.myt-bg')) { e.stopPropagation(); playAudioIn(d, id); return; }
      if (e.target.closest('.myt-pp')) { var a = sharedAudio(); a.paused ? a.play().catch(function () {}) : a.pause(); return; }
      if (e.target.closest('.myt-vv')) { stopBgAudio(); loadIframe(d, id); return; }
      if (d.classList.contains('facade')) loadIframe(d, id);
    });
    return d;
  }
  function scan(root) {
    var posts = (root || document).querySelectorAll('.post:not([data-myt]),[data-post]:not([data-myt]),.feedItem:not([data-myt])');
    Array.prototype.forEach.call(posts, function (p) {
      p.setAttribute('data-myt', '1');
      var id = null;
      var a = p.querySelector('a[href*="youtu"]');
      if (a) id = vidId(a.getAttribute('href'));
      if (!id) id = vidId(p.textContent || '');
      if (!id) return;
      if (p.querySelector('.myt-embed')) return;

      // Hide/remove the raw YouTube URL from visible post text.
      // Keep the detected video ID so the embedded player still works.
      try {
        var walker = document.createTreeWalker(
          p,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: function (node) {
              if (!node.nodeValue || !/youtube\.com\/|youtu\.be\//i.test(node.nodeValue)) {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );

        var nodes = [];
        var node;
        while ((node = walker.nextNode())) nodes.push(node);

        nodes.forEach(function (textNode) {
          textNode.nodeValue = textNode.nodeValue.replace(
            /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)[A-Za-z0-9_-]{11}(?:[^\s]*)?|youtu\.be\/[A-Za-z0-9_-]{11}(?:[^\s]*)?)/gi,
            ''
          );
        });
      } catch (e) {}

      // Also hide a link element if the URL was auto-linkified.
      if (a) {
        a.style.display = 'none';
        a.setAttribute('aria-hidden', 'true');
      }

      var target = p.querySelector('.postText, .postBody, .post-body, .text, .caption, .body') || p;
      target.appendChild(embed(id));
    });
  }
  function startFeedWatch() {
    var feed = document.getElementById('feed') || document.querySelector('.feed') || document.body;
    scan(document);
    try {
      var mo = new MutationObserver(function () { scan(feed); });
      mo.observe(feed, { childList: true, subtree: true });
    } catch (e) {}
    setInterval(function () { scan(document); }, 4000); // safety net for re-rendered feeds
  }

  /* ── 2) Composer: search & add a YouTube video ──────────────── */
  var CSS = [
    '.myt-add{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#e7ecff;border-radius:11px;padding:8px 13px;font:700 12.5px Inter,system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:6px;margin:4px 6px 4px 0}',
    '.myt-add:hover{border-color:rgba(216,179,90,.5);color:#fff}',
    '.myt-ov{position:fixed;inset:0;z-index:100000;display:none;align-items:flex-start;justify-content:center;background:rgba(8,9,14,.7);backdrop-filter:blur(8px);padding:40px 14px}',
    '.myt-ov.show{display:flex}',
    '.myt-modal{width:min(520px,96vw);max-height:80vh;display:flex;flex-direction:column;background:#0c1226;border:1px solid rgba(255,255,255,.1);border-radius:20px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55)}',
    '.myt-h{display:flex;align-items:center;gap:9px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);font:800 15px Inter,sans-serif;color:#fff}',
    '.myt-h .x{margin-left:auto;background:rgba(255,255,255,.08);border:0;color:#cdd6ee;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:15px}',
    '.myt-srch{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.06)}',
    '.myt-srch input{width:100%;height:40px;background:#11162c;border:1px solid rgba(255,255,255,.12);color:#eef1ff;border-radius:11px;padding:0 13px;font-size:14px;outline:none}',
    '.myt-list{overflow-y:auto;padding:8px}',
    '.myt-row{display:flex;gap:10px;padding:8px;border-radius:11px;cursor:pointer;align-items:center}',
    '.myt-row:hover{background:rgba(255,255,255,.06)}',
    '.myt-row img{width:72px;height:46px;border-radius:8px;object-fit:cover;flex:0 0 auto;background:#000}',
    '.myt-row .t{font:600 13px Inter,sans-serif;color:#eef1ff;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.myt-row .c{font:500 11.5px Inter,sans-serif;color:#9aa6cf;margin-top:2px}',
    '.myt-msg{padding:18px;text-align:center;color:#9aa6cf;font-size:13px}',
    '.myt-embed{transition:transform .18s,border-color .18s,box-shadow .18s}',
    '.myt-embed.facade:hover{transform:translateY(-2px);border-color:rgba(216,179,90,.45);box-shadow:0 14px 36px rgba(0,0,0,.45)}',
    '.myt-grad{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.5));pointer-events:none}',
    '.myt-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:62px;height:62px;border-radius:50%;background:linear-gradient(135deg,#d8b35a,#ecca7e);color:#1b1306;display:grid;place-items:center;font-size:25px;box-shadow:0 10px 30px rgba(0,0,0,.55);transition:transform .18s}',
    '.myt-embed.facade:hover .myt-play{transform:translate(-50%,-50%) scale(1.1)}',
    '.myt-badge{position:absolute;left:10px;bottom:10px;background:rgba(0,0,0,.62);color:#fff;font:700 11px Inter,system-ui,sans-serif;padding:4px 9px;border-radius:8px}',
    '.myt-abadge{position:absolute;right:10px;bottom:10px;background:rgba(0,0,0,.62);color:#fff;font:700 11px Inter,system-ui,sans-serif;padding:5px 10px;border-radius:8px;border:1px solid rgba(216,179,90,.45);cursor:pointer}',
    '.myt-abadge:hover{background:rgba(216,179,90,.28)}',
    '.myt-bg{position:absolute;right:10px;top:10px;z-index:5;width:38px;height:38px;border-radius:50%;border:1px solid rgba(216,179,90,.5);background:rgba(0,0,0,.6);color:#fff;font-size:17px;cursor:pointer;display:grid;place-items:center}',
    '.myt-bg:hover{background:rgba(216,179,90,.35)}',
    '.myt-audio{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:10px;max-width:92%;background:rgba(5,8,20,.82);border:1px solid rgba(216,179,90,.4);border-radius:14px;padding:10px 14px;color:#fff;font:600 13px Inter,system-ui,sans-serif}',
    '.myt-audio .tt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52vw}',
    '.myt-audio button{border:0;cursor:pointer;font:700 12px Inter,system-ui,sans-serif;border-radius:10px}',
    '.myt-audio .myt-pp{width:36px;height:36px;border-radius:50%;font-size:15px;color:#1b1306;background:linear-gradient(135deg,#d8b35a,#ecca7e)}',
    '.myt-audio .myt-vv{background:rgba(255,255,255,.1);color:#e7ecff;padding:9px 11px;border:1px solid rgba(255,255,255,.16)}'
  ].join('\n');

  var overlay;
  function buildModal() {
    overlay = document.createElement('div'); overlay.className = 'myt-ov';
    overlay.innerHTML = '<div class="myt-modal"><div class="myt-h">🎬 Add a YouTube video<button class="x" title="Close">✕</button></div>' +
      '<div class="myt-srch"><input type="search" placeholder="Search any song or video…" autocomplete="off"></div>' +
      '<div class="myt-list"><div class="myt-msg">Type a video name to search.</div></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('.x').addEventListener('click', close);
    var input = overlay.querySelector('input'), list = overlay.querySelector('.myt-list'), t = null;
    input.addEventListener('input', function () {
      clearTimeout(t); var q = this.value.trim();
      if (!q) { list.innerHTML = '<div class="myt-msg">Type a video name to search.</div>'; return; }
      t = setTimeout(function () {
        list.innerHTML = '<div class="myt-msg">Searching…</div>';
        fetch('/api/music/search?q=' + encodeURIComponent(q)).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw j; return j; }); })
          .then(function (j) { renderResults(list, j.items || []); })
          .catch(function (j) {
            list.innerHTML = '<div class="myt-msg">' + ((j && j.code === 'no_key')
              ? 'YouTube search ke liye <b>YOUTUBE_API_KEY</b> chahiye (backend/.env). Tab tak link paste karke bhi add kar sakte ho.'
              : 'Search failed. Try again.') + '</div>';
          });
      }, 340);
    });
  }
  function renderResults(list, items) {
    if (!items.length) { list.innerHTML = '<div class="myt-msg">No videos found.</div>'; return; }
    list.innerHTML = items.map(function (it) {
      return '<div class="myt-row"><img loading="lazy" src="' + esc(it.thumb) + '" alt="">' +
        '<div><div class="t">' + esc(it.title) + '</div><div class="c">' + esc(it.channel) + '</div></div></div>';
    }).join('');
    var rows = list.querySelectorAll('.myt-row');
    items.forEach(function (it, i) { if (rows[i]) rows[i].addEventListener('click', function () { addToPost(it); }); });
  }
  // Click a result -> auto-fill the composer AND auto-publish to the feed (no manual Publish).
  function addToPost(item) {
    var url = 'https://www.youtube.com/watch?v=' + item.id;
    var ta = document.getElementById('postText');
    if (ta) { ta.value = (ta.value ? ta.value.trim() + '\n\n' : '') + url; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    var ti = document.getElementById('postTitle');
    if (ti && !ti.value.trim()) { ti.value = String(item.title || 'YouTube video').slice(0, 80); ti.dispatchEvent(new Event('input', { bubbles: true })); }
    close();
    var pub = document.getElementById('publishBtn');
    if (pub) {
      // small delay so the composer's input/preview handlers settle, then publish for real
      setTimeout(function () {
        pub.click();
        if (window.toast) try { window.toast('🎬 Video posted to your feed!'); } catch (e) {}
      }, 220);
    } else if (window.toast) { try { window.toast('🎬 Video added — tap Publish.'); } catch (e) {} }
  }
  function open() { if (!overlay) buildModal(); overlay.classList.add('show'); overlay.querySelector('input').focus(); }
  function close() { if (overlay) overlay.classList.remove('show'); }

  function injectButton() {
    if (document.getElementById('myt-add-btn')) return true;
    var pub = document.getElementById('publishBtn');
    var anchor = document.getElementById('postText');
    if (!anchor) return false;
    var btn = document.createElement('button');
    btn.id = 'myt-add-btn'; btn.type = 'button'; btn.className = 'myt-add';
    btn.innerHTML = '🎬 <span>Add YouTube</span>';
    btn.addEventListener('click', function (e) { e.preventDefault(); open(); });
    // place it right after the textarea (works on mobile + desktop)
    if (anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    else if (pub && pub.parentNode) pub.parentNode.insertBefore(btn, pub);
    return true;
  }

  function boot() {
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    startFeedWatch();
    if (!injectButton()) {
      var tries = 0, iv = setInterval(function () { if (injectButton() || ++tries > 20) clearInterval(iv); }, 600);
    }
  }
  if (window.__milanAppReady) boot(); else window.addEventListener('milan:app-ready', boot, {once:true});
})();
