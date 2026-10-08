(function () {
  'use strict';
  if (window.__milanTravelLocation) return;
  window.__milanTravelLocation = true;

  var watchId = null;
  var trip = null;
  var lastPosition = null;
  var ACCESS_KEY = 'milan_travel_location_access';

  var CSS = `
    .mtravel-btn{
      display:flex!important;align-items:center!important;gap:8px!important;
      width:100%!important;text-align:left!important;margin-top:4px!important;
    }
    .mtravel-panel{
      position:fixed;inset:0;z-index:100000;display:none;
      align-items:center;justify-content:center;padding:18px;
      background:rgba(1,6,18,.72);backdrop-filter:blur(12px);
    }
    .mtravel-panel.open{display:flex;animation:mtravelFade .18s ease}
    @keyframes mtravelFade{from{opacity:0}to{opacity:1}}
    .mtravel-card{
      width:min(560px,100%);max-height:min(760px,calc(100vh - 36px));
      overflow:auto;border-radius:26px;padding:22px;
      color:#eef2ff;background:linear-gradient(160deg,#0a1a3e,#07132f);
      border:1px solid rgba(245,158,11,.25);
      box-shadow:0 30px 90px rgba(0,0,0,.55);
    }
    .mtravel-head{display:flex;align-items:center;gap:12px}
    .mtravel-icon{
      width:46px;height:46px;border-radius:15px;display:grid;place-items:center;
      font-size:23px;background:linear-gradient(135deg,#f59e0b,#d946ef);
    }
    .mtravel-title{font-size:18px;font-weight:900}
    .mtravel-sub{font-size:11px;color:#8ba4d4;margin-top:3px}
    .mtravel-close{
      margin-left:auto;width:36px!important;height:36px!important;
      border:0!important;border-radius:50%!important;cursor:pointer!important;
    }
    .mtravel-privacy{
      margin-top:16px;padding:13px 14px;border-radius:15px;
      background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);
    }
    .mtravel-privacy strong{display:block;font-size:12px;color:#86efac}
    .mtravel-privacy span{display:block;font-size:10.5px;line-height:1.55;color:#a9bad8;margin-top:4px}
    .mtravel-status{
      margin-top:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:9px;
    }
    .mtravel-stat{
      padding:12px;border-radius:14px;background:rgba(255,255,255,.035);
      border:1px solid rgba(148,163,184,.1)
    }
    .mtravel-stat b{display:block;font-size:16px}
    .mtravel-stat span{display:block;font-size:9px;color:#7183a6;margin-top:4px;text-transform:uppercase;letter-spacing:.06em}
    .mtravel-route{
      margin-top:14px;padding:15px;border-radius:16px;
      background:rgba(91,124,250,.06);border:1px solid rgba(91,124,250,.14);
    }
    .mtravel-route-row{display:flex;align-items:center;gap:10px}
    .mtravel-dot{width:11px;height:11px;border-radius:50%;background:#22c55e;box-shadow:0 0 12px rgba(34,197,94,.45)}
    .mtravel-dot.b{background:#f59e0b;box-shadow:0 0 12px rgba(245,158,11,.45)}
    .mtravel-route-label{font-size:11px;color:#8fa2c5}
    .mtravel-route-value{font-size:13px;font-weight:800;color:#eef2ff}
    .mtravel-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:15px}
    .mtravel-actions button{
      min-height:40px!important;padding:0 14px!important;border-radius:12px!important;
      border:0!important;cursor:pointer!important;font-weight:900!important;
    }
    .mtravel-primary{background:linear-gradient(135deg,#f59e0b,#fbbf24)!important;color:#071126!important}
    .mtravel-secondary{background:rgba(255,255,255,.06)!important;color:#d9e2f3!important;border:1px solid rgba(148,163,184,.14)!important}
    .mtravel-danger{background:rgba(239,68,68,.12)!important;color:#fca5a5!important;border:1px solid rgba(239,68,68,.18)!important}
    .mtravel-note{margin-top:13px;font-size:10px;line-height:1.55;color:#7286aa}
    .mtravel-access{
      margin-top:14px;padding:15px;border-radius:16px;
      background:rgba(217,70,239,.045);border:1px solid rgba(217,70,239,.14);
    }
    .mtravel-access-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .mtravel-access-title{font-size:12px;font-weight:900;color:#eef2ff}
    .mtravel-access-state{
      font-size:9px;font-weight:900;padding:5px 8px;border-radius:999px;
      background:rgba(239,68,68,.12);color:#fca5a5;
      border:1px solid rgba(239,68,68,.18);
    }
    .mtravel-access-state.allowed{
      background:rgba(34,197,94,.10);color:#86efac;
      border-color:rgba(34,197,94,.18);
    }
    .mtravel-access-copy{margin-top:6px;font-size:10px;line-height:1.5;color:#8295b7}
    .mtravel-access-grid{
      display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:11px;
    }
    .mtravel-access-grid label{display:block;font-size:9px;color:#7387ab;font-weight:800;margin-bottom:5px}
    .mtravel-access-grid select{
      width:100%;min-height:38px;border-radius:11px;padding:0 10px;
      background:rgba(2,6,23,.55)!important;color:#eaf0ff!important;
      border:1px solid rgba(148,163,184,.14)!important;
    }
    .mtravel-access-save{margin-top:10px;width:100%}
    @media(max-width:560px){
      .mtravel-access-grid{grid-template-columns:1fr}
    }
    @media(max-width:560px){
      .mtravel-panel{padding:8px}.mtravel-card{padding:17px;border-radius:21px}
      .mtravel-status{grid-template-columns:1fr 1fr}
    }
  `;

  function addStyle() {
    var s = document.createElement('style');
    s.id = 'milan-travel-location-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
  }

  function haversine(a, b) {
    var R = 6371000;
    var p1 = a.lat * Math.PI / 180;
    var p2 = b.lat * Math.PI / 180;
    var dp = (b.lat - a.lat) * Math.PI / 180;
    var dl = (b.lng - a.lng) * Math.PI / 180;
    var x = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function bearing(a, b) {
    var p1 = a.lat * Math.PI / 180;
    var p2 = b.lat * Math.PI / 180;
    var dl = (b.lng - a.lng) * Math.PI / 180;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) -
            Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function compass(deg) {
    return ['N','NE','E','SE','S','SW','W','NW'][Math.round(deg / 45) % 8];
  }

  function fmtDistance(m) {
    if (!isFinite(m)) return '—';
    if (m < 1000) return Math.round(m) + ' m';
    return (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km';
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function defaultAccessPolicy() {
    return { scope: 'blocked', duration: '15m', updatedAt: null };
  }

  function getToken() {
    try { return String(localStorage.getItem('milan_token') || '').trim(); }
    catch (_) { return ''; }
  }

  function getLocalAccessPolicy() {
    try {
      var v = JSON.parse(localStorage.getItem(ACCESS_KEY) || 'null');
      if (v && typeof v === 'object') return { ...defaultAccessPolicy(), ...v };
    } catch (_) {}
    return defaultAccessPolicy();
  }

  var accessPolicy = getLocalAccessPolicy();

  function getAccessPolicy() {
    return accessPolicy || defaultAccessPolicy();
  }

  async function loadAccessPolicy() {
    var token = getToken();
    if (!token) {
      renderAccessPolicy();
      return;
    }

    try {
      var response = await fetch('/api/settings', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        credentials: 'same-origin'
      });

      if (!response.ok) throw new Error('Settings request failed: ' + response.status);

      var data = await response.json();
      if (data?.settings?.travelLocation) {
        accessPolicy = { ...defaultAccessPolicy(), ...data.settings.travelLocation };
        try {
          localStorage.setItem(ACCESS_KEY, JSON.stringify(accessPolicy));
        } catch (_) {}
      }

      renderAccessPolicy();
    } catch (_) {
      accessPolicy = getLocalAccessPolicy();
      renderAccessPolicy();
    }
  }

  async function saveAccessPolicy() {
    var scope = document.getElementById('mtravelAccessScope')?.value || 'blocked';
    var duration = document.getElementById('mtravelAccessDuration')?.value || '15m';

    accessPolicy = {
      ...defaultAccessPolicy(),
      ...getAccessPolicy(),
      scope: scope,
      duration: duration,
      updatedAt: new Date().toISOString()
    };

    try { localStorage.setItem(ACCESS_KEY, JSON.stringify(accessPolicy)); } catch (_) {}

    renderAccessPolicy();
    setText('mtravelMessage',
      scope === 'blocked'
        ? 'Third-party location access is blocked.'
        : 'Saving your location policy…');

    var token = getToken();
    if (!token) {
      setText('mtravelMessage',
        scope === 'blocked'
          ? 'Third-party location access is blocked on this device.'
          : 'Access policy saved locally. Login to sync it to your MILAN account.');
      return;
    }

    try {
      var response = await fetch('/api/settings/travel-location', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          scope: accessPolicy.scope,
          duration: accessPolicy.duration
        })
      });

      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        throw new Error(data.error || 'Policy save failed: ' + response.status);
      }

      accessPolicy = { ...defaultAccessPolicy(), ...(data.travelLocation || accessPolicy) };
      try { localStorage.setItem(ACCESS_KEY, JSON.stringify(accessPolicy)); } catch (_) {}

      renderAccessPolicy();
      setText('mtravelMessage',
        scope === 'blocked'
          ? 'Third-party location access is blocked. Policy synced to your MILAN account.'
          : 'Location policy saved to your MILAN account. No GPS coordinates were shared.');
    } catch (_) {
      renderAccessPolicy();
      setText('mtravelMessage',
        scope === 'blocked'
          ? 'Policy saved on this device; account sync is temporarily unavailable.'
          : 'Policy saved locally; account sync is temporarily unavailable.');
    }
  }

  function renderAccessPolicy() {
    var policy = getAccessPolicy();
    var scope = document.getElementById('mtravelAccessScope');
    var duration = document.getElementById('mtravelAccessDuration');
    var state = document.getElementById('mtravelAccessState');
    if (scope) scope.value = policy.scope || 'blocked';
    if (duration) duration.value = policy.duration || '15m';
    if (state) {
      var allowed = policy.scope !== 'blocked';
      state.textContent = allowed ? 'USER CONTROLLED' : 'BLOCKED';
      state.classList.toggle('allowed', allowed);
    }
  }

  function render() {
    setText('mtravelState', watchId != null ? 'LIVE' : (trip ? 'PAUSED' : 'READY'));
    setText('mtravelDistance', fmtDistance(trip ? trip.distance : 0));
    setText('mtravelAccuracy', lastPosition && isFinite(lastPosition.accuracy)
      ? Math.round(lastPosition.accuracy) + ' m'
      : '—');
    setText('mtravelDirection', trip && trip.current && trip.current.bearing != null
      ? compass(trip.current.bearing)
      : '—');
    setText('mtravelA', trip && trip.start
      ? 'Trip origin captured on this device'
      : 'Not captured');
    setText('mtravelB', trip && trip.current
      ? 'Current position captured locally'
      : 'Waiting for movement');
  }

  function stopWatch() {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    render();
  }

  function fail(err) {
    stopWatch();
    var msg = err && err.code === 1
      ? 'Location permission was denied. You can enable it in browser/site settings.'
      : 'Location could not be read right now.';
    setText('mtravelMessage', msg);
  }

  function onPosition(pos) {
    var cur = {
      lat: Number(pos.coords.latitude),
      lng: Number(pos.coords.longitude),
      accuracy: Number(pos.coords.accuracy)
    };
    if (!isFinite(cur.lat) || !isFinite(cur.lng)) return;

    lastPosition = cur;

    if (!trip) {
      trip = {
        start: cur,
        current: { lat: cur.lat, lng: cur.lng, bearing: null },
        distance: 0
      };
      setText('mtravelMessage', 'Origin A captured. Move to start measuring A → B.');
    } else {
      var prev = trip.current || trip.start;
      var delta = haversine(prev, cur);
      if (isFinite(delta) && delta >= 0 && delta < 5000) trip.distance += delta;
      trip.current = {
        lat: cur.lat,
        lng: cur.lng,
        bearing: bearing(trip.start, cur)
      };
      setText('mtravelMessage', 'Movement is being calculated on this device.');
    }

    render();
  }

  function startTrip() {
    if (!navigator.geolocation) {
      setText('mtravelMessage', 'This browser/device does not expose geolocation.');
      return;
    }

    stopWatch();
    trip = null;
    lastPosition = null;
    setText('mtravelMessage', 'Requesting location permission…');

    watchId = navigator.geolocation.watchPosition(onPosition, fail, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    });
    render();
  }

  function clearTrip() {
    stopWatch();
    trip = null;
    lastPosition = null;
    setText('mtravelMessage', 'Trip cleared. No route history is retained by this feature.');
    render();
  }

  function build() {
    addStyle();

    var nav = document.querySelector('.leftRail .nav');
    if (nav && !document.getElementById('milanTravelBtn')) {
      var btn = document.createElement('button');
      btn.id = 'milanTravelBtn';
      btn.type = 'button';
      btn.className = 'mtravel-btn';
      btn.innerHTML = '✈️ Travel Agent';
      nav.appendChild(btn);
    }

    var panel = document.createElement('div');
    panel.id = 'milanTravelPanel';
    panel.className = 'mtravel-panel';
    panel.innerHTML = `
      <div class="mtravel-card" role="dialog" aria-modal="true" aria-labelledby="mtravelTitle">
        <div class="mtravel-head">
          <div class="mtravel-icon">✈️</div>
          <div>
            <div id="mtravelTitle" class="mtravel-title">MILAN Travel Agent</div>
            <div class="mtravel-sub">Privacy-first movement intelligence</div>
          </div>
          <button type="button" class="mtravel-close" id="mtravelClose" aria-label="Close">✕</button>
        </div>

        <div class="mtravel-privacy">
          <strong>🔒 Location stays local in this feature</strong>
          <span>Precise GPS coordinates are processed in your browser for this trip calculation. This tracker does not send your GPS coordinates to the MILAN server or a third-party location API.</span>
        </div>

        <div class="mtravel-status">
          <div class="mtravel-stat"><b id="mtravelState">READY</b><span>Tracking state</span></div>
          <div class="mtravel-stat"><b id="mtravelDistance">—</b><span>A → B distance</span></div>
          <div class="mtravel-stat"><b id="mtravelAccuracy">—</b><span>GPS accuracy</span></div>
          <div class="mtravel-stat"><b id="mtravelDirection">—</b><span>Direction</span></div>
        </div>

        <div class="mtravel-access">
          <div class="mtravel-access-head">
            <div class="mtravel-access-title">🛡 Location Access Rules</div>
            <div id="mtravelAccessState" class="mtravel-access-state">BLOCKED</div>
          </div>
          <div class="mtravel-access-copy">
            Choose what a future third-party integration may request. The default is blocked.
            Changing this setting does not share location data by itself.
          </div>
          <div class="mtravel-access-grid">
            <div>
              <label for="mtravelAccessScope">Allowed precision</label>
              <select id="mtravelAccessScope">
                <option value="blocked">Blocked</option>
                <option value="city">City / coarse</option>
                <option value="approximate">Approximate</option>
                <option value="precise">Precise</option>
              </select>
            </div>
            <div>
              <label for="mtravelAccessDuration">Access window</label>
              <select id="mtravelAccessDuration">
                <option value="15m">15 minutes</option>
                <option value="1h">1 hour</option>
                <option value="trip">Current trip</option>
              </select>
            </div>
          </div>
          <button type="button" id="mtravelAccessSave" class="mtravel-primary mtravel-access-save">Save location policy</button>
        </div>

        <div class="mtravel-route">
          <div class="mtravel-route-row">
            <span class="mtravel-dot"></span>
            <div><div class="mtravel-route-label">Point A</div><div id="mtravelA" class="mtravel-route-value">Not captured</div></div>
          </div>
          <div style="height:24px;border-left:1px dashed rgba(148,163,184,.28);margin-left:5px"></div>
          <div class="mtravel-route-row">
            <span class="mtravel-dot b"></span>
            <div><div class="mtravel-route-label">Point B / current</div><div id="mtravelB" class="mtravel-route-value">Waiting for movement</div></div>
          </div>
        </div>

        <div class="mtravel-actions">
          <button type="button" id="mtravelStart" class="mtravel-primary">📍 Start trip</button>
          <button type="button" id="mtravelStop" class="mtravel-secondary">⏸ Stop tracking</button>
          <button type="button" id="mtravelClear" class="mtravel-danger">Reset trip</button>
        </div>

        <div id="mtravelMessage" class="mtravel-note">Nothing is tracked until you explicitly start a trip.</div>
        <div class="mtravel-note">Third-party location sharing is a separate future consent layer. This first implementation only measures movement locally.</div>
      </div>
    `;
    document.body.appendChild(panel);

    function open() {
      panel.classList.add('open');
      render();
    }
    function close() {
      panel.classList.remove('open');
    }

    document.getElementById('milanTravelBtn')?.addEventListener('click', open);
    document.getElementById('mtravelClose')?.addEventListener('click', close);
    document.getElementById('mtravelStart')?.addEventListener('click', startTrip);
    document.getElementById('mtravelAccessSave')?.addEventListener('click', saveAccessPolicy);
    renderAccessPolicy();
    loadAccessPolicy();
    document.getElementById('mtravelStop')?.addEventListener('click', function () {
      stopWatch();
      setText('mtravelMessage', 'Tracking stopped. Your current trip remains only in this page session.');
    });
    document.getElementById('mtravelClear')?.addEventListener('click', clearTrip);

    panel.addEventListener('click', function (e) {
      if (e.target === panel) close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build, { once: true });
  } else {
    build();
  }
})();