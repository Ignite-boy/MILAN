!function(){if(window.__milanUniversalVideoV66)return;window.__milanUniversalVideoV66=!0;const originalMediaHtml=window.mediaHtml,healing={};try{const st=document.createElement("style");st.textContent=".milanUniversalPlayer{position:relative;background:#050915;overflow:hidden}.milanUniversalPlayer video{display:block;width:100%;max-height:72vh;min-height:220px;background:#020617;object-fit:contain}.milanVideoOverlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:18px;color:#e5e7eb;background:linear-gradient(180deg,rgba(2,6,23,.28),rgba(2,6,23,.70));pointer-events:none}.milanUniversalPlayer.loading .milanVideoOverlay{display:flex}.milanVideoOverlay .loader{width:42px;height:42px;border-radius:50%;border:4px solid rgba(255,255,255,.25);border-top-color:#fff;margin:0 auto 10px;animation:milanSpin .9s linear infinite}.milanVideoFallback{display:none;padding:10px 14px;border-top:1px solid var(--line);background:rgba(255,255,255,.035);color:var(--muted)}.milanUniversalPlayer.failed .milanVideoFallback{display:block}.milanVideoFallback a{display:inline-flex;margin:8px 8px 0 0;border:1px solid var(--line);border-radius:999px;padding:8px 12px;color:var(--text);text-decoration:none}.milanUniversalPlayer .fileCard{display:none!important}@keyframes milanSpin{to{transform:rotate(360deg)}}",document.head.appendChild(st)}catch(e){}function addParam(url,key,value){const u=String(url||"");return u?u+(u.includes("?")?"&":"?")+encodeURIComponent(key)+"="+encodeURIComponent(null==value?"":value):""}function playerBox(video){return video&&video.closest?video.closest(".milanUniversalPlayer"):null}function showLoading(video,yes){try{const box=playerBox(video);box&&box.classList.toggle("loading",!!yes)}catch(_){}}function markFailed(video,yes){try{const box=playerBox(video);box&&(box.classList.toggle("failed",!!yes),box.classList.toggle("loading",!1))}catch(_){}}function playable(video){try{const d=Number(video.duration);return video.readyState>=1&&Number.isFinite(d)&&d>0}catch(_){return!1}}function setVideoSrc(video,src){try{const source=video.querySelector("source"),next=addParam(src,"r",Date.now());source?source.setAttribute("src",next):video.setAttribute("src",next),video.load()}catch(_){}}function updateRecordFromResponse(id,res){try{if(!res||!res.record||typeof updateRecordLocal!=="function")return;const el=document.getElementById("post-"+id),video=el&&el.querySelector(".milanUniversalPlayer video"),box=video&&video.closest(".milanUniversalPlayer"),preserveVideo=!!(video&&(!video.paused||box&&box.classList.contains("loading")||video.dataset.watchdogStarted==="1"||video.dataset.healReloaded==="1"||video.dataset.errorCount));updateRecordLocal(id,res.record,{preserveVideo})}catch(_){}}const directPlaybackUrlCache = new Map();
const directPlaybackOriginCache = new Set();
const DIRECT_PLAYBACK_CACHE_TTL_MS = 50 * 60 * 1000;
const DIRECT_PLAYBACK_CACHE_MAX_ENTRIES = 250;
let videoPreloadBudgetFrame = 0;

function directPlaybackSessionScope(){
  let token = '';
  try { token = String(localStorage.getItem('milan_token') || ''); } catch (_) {}
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) hash = Math.imul(hash ^ token.charCodeAt(i), 16777619);
  return String(token.length) + ':' + (hash >>> 0).toString(36);
}
function directPlaybackCacheKey(video,id){
  const box = playerBox(video);
  const version = box ? String(box.getAttribute('data-media-version') || '') : '';
  return directPlaybackSessionScope() + '|' + String(id || '') + '|' + version;
}
function getDirectPlaybackCache(key){
  const item = directPlaybackUrlCache.get(key);
  if (!item) return '';
  if (item.expiresAt <= Date.now()) { directPlaybackUrlCache.delete(key); return ''; }
  directPlaybackUrlCache.delete(key);
  directPlaybackUrlCache.set(key,item);
  return item.url;
}
function setDirectPlaybackCache(key,url,expiresIn){
  const seconds = Number(expiresIn || 3600);
  const ttl = Math.min(DIRECT_PLAYBACK_CACHE_TTL_MS, seconds * 1000 - 60000);
  if (!key || !url || !Number.isFinite(ttl) || ttl < 5000) return;
  directPlaybackUrlCache.delete(key);
  directPlaybackUrlCache.set(key,{url:url,expiresAt:Date.now()+ttl});
  while (directPlaybackUrlCache.size > DIRECT_PLAYBACK_CACHE_MAX_ENTRIES) {
    const oldest = directPlaybackUrlCache.keys().next().value;
    if (oldest === undefined) break;
    directPlaybackUrlCache.delete(oldest);
  }
}
function warmDirectPlaybackOrigin(url){
  try {
    const parsed = new URL(String(url || ''), window.location.href);
    if (parsed.protocol !== 'https:' || parsed.origin === window.location.origin || directPlaybackOriginCache.has(parsed.origin)) return;
    directPlaybackOriginCache.add(parsed.origin);
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = parsed.origin;
    document.head.appendChild(link);
  } catch (_) {}
}
function videoVisibilityRatio(video){
  try {
    const r = video.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return 0;
    const width = Math.max(0,Math.min(r.right,window.innerWidth)-Math.max(r.left,0));
    const height = Math.max(0,Math.min(r.bottom,window.innerHeight)-Math.max(r.top,0));
    return width * height / Math.max(1,r.width*r.height);
  } catch (_) { return 0; }
}
function updateVideoPreloadBudget(){
  const videos = Array.from(document.querySelectorAll('.milanUniversalPlayer video'));
  if (!videos.length) return;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const effectiveType = String(connection && connection.effectiveType || '').toLowerCase();
  const constrained = !!(connection && (connection.saveData || effectiveType === 'slow-2g' || effectiveType === '2g'));
  if (constrained) { videos.forEach(v => { if (v.preload !== 'metadata') v.preload = 'metadata'; }); return; }
  const ordered = videos.map(v => ({video:v, top:v.getBoundingClientRect().top})).sort((a,b) => a.top-b.top);
  let active = null, bestRatio = 0;
  for (const item of ordered) { const ratio = videoVisibilityRatio(item.video); if (ratio > bestRatio) { bestRatio = ratio; active = item.video; } }
  if (!active) {
    const center = window.innerHeight / 2;
    active = ordered.reduce((best,item) => Math.abs(item.top + item.video.getBoundingClientRect().height/2 - center) < Math.abs(best.top + best.video.getBoundingClientRect().height/2 - center) ? item : best,ordered[0]).video;
  }
  const activeIndex = ordered.findIndex(item => item.video === active);
  const next = activeIndex >= 0 && activeIndex + 1 < ordered.length ? ordered[activeIndex+1].video : null;
  videos.forEach(video => {
    const desired = video === active || video === next ? 'auto' : 'metadata';
    if (video.preload !== desired) {
      video.preload = desired;
      const source = video.querySelector('source');
      if (desired === 'auto' && video.readyState === 0 && source && source.getAttribute('src')) video.load();
    }
  });
}
function scheduleVideoPreloadBudget(){
  if (videoPreloadBudgetFrame) return;
  videoPreloadBudgetFrame = requestAnimationFrame(() => { videoPreloadBudgetFrame = 0; updateVideoPreloadBudget(); });
}

async function loadDirectMedia(video,id,options={}){
  const forceRefresh = options.forceRefresh === true;
  const preserveTime = Number.isFinite(Number(options.preserveTime)) ? Math.max(0,Number(options.preserveTime)) : 0;
  if (!video || !id) return false;
  if (video.dataset.milanDirectLoading === '1') return false;
  if (!forceRefresh && (video.dataset.milanDirectReady === '1' || video.dataset.milanDirectFallback === '1')) return true;
  video.dataset.milanDirectLoading = '1';
  const source = video.querySelector('source[data-milan-direct-source],source');
  try {
    if (typeof api !== 'function') throw new Error('Playback API unavailable');
    const cacheKey = directPlaybackCacheKey(video,id);
    let direct = forceRefresh ? '' : getDirectPlaybackCache(cacheKey);
    if (!direct) {
      const suffix = forceRefresh ? '?refresh=1' : '';
      const result = await api('/records/' + encodeURIComponent(id) + '/media/playback-url' + suffix);
      direct = String(result && result.url || '');
      if (!/^https?:\/\/\S+$/i.test(direct)) throw new Error('Invalid playback URL');
      setDirectPlaybackCache(cacheKey,direct,result && result.expiresIn);
    }
    if (!/^https?:\/\/\S+$/i.test(direct)) throw new Error('Invalid playback URL');
    if (!source) throw new Error('Video source unavailable');
    if (preserveTime > 0) {
      video.addEventListener('loadedmetadata',function(){
        try { const duration = Number(video.duration); video.currentTime = Number.isFinite(duration) && duration > 0 ? Math.min(preserveTime,Math.max(0,duration-0.1)) : preserveTime; } catch (_) {}
      },{once:true});
    }
    warmDirectPlaybackOrigin(direct);
    source.setAttribute('src',direct);
    video.dataset.milanDirectReady = '1';
    delete video.dataset.milanDirectFallback;
    delete video.dataset.finalFailed;
    video.load();
    scheduleVideoPreloadBudget();
    return true;
  } catch (error) {
    if (forceRefresh) throw error;
    const base = video.getAttribute('data-base-src') || '';
    if (source && base) { video.dataset.milanDirectFallback = '1'; source.setAttribute('src',base); video.load(); }
    return false;
  } finally { delete video.dataset.milanDirectLoading; }
}
const directObserver=typeof IntersectionObserver==="function"?new IntersectionObserver(entries=>{
entries.forEach(entry=>{
if(!entry.isIntersecting)return;
directObserver.unobserve(entry.target);
const id=entry.target.closest(".milanUniversalPlayer")?.getAttribute("data-record-id")||"";
if(id)loadDirectMedia(entry.target,id);
});
},{rootMargin:"700px 0px"}):null;
window.milanEnsureDirectVideo=loadDirectMedia;
window.addEventListener('scroll',scheduleVideoPreloadBudget,{passive:true});
window.addEventListener('resize',scheduleVideoPreloadBudget,{passive:true});
document.addEventListener('play',scheduleVideoPreloadBudget,true);
document.addEventListener('pause',scheduleVideoPreloadBudget,true);
try { const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection; connection&&connection.addEventListener&&connection.addEventListener('change',scheduleVideoPreloadBudget); } catch (_) {}
window.milanVideoLoadedOk=function(id,video){try{playable(video)&&(video.dataset.milanPlayable="1",showLoading(video,!1),markFailed(video,!1),clearMediaError(video))}catch(_){}},window.milanRefreshVideoStatus=async function(id,quiet){try{const res=await api("/records/"+encodeURIComponent(id)+"/media/status?auto=1");return updateRecordFromResponse(id,res),!quiet&&res&&res.ready&&toast("Video ready"),res}catch(e){throw quiet||toast("Video is loading"),e}},window.milanPrepareVideoPreview=async function(id,btn){try{btn&&(btn.disabled=!0,btn.dataset.oldText=btn.textContent,btn.textContent="Loading...");const res=await api("/records/"+encodeURIComponent(id)+"/media/repair?async=1",{method:"POST",body:JSON.stringify({async:!0})});return updateRecordFromResponse(id,res),btn?(toast("Video is loading"),res):res}catch(e){btn&&toast("Video is loading")}finally{btn&&(btn.disabled=!1,btn.textContent=btn.dataset.oldText||"Load video")}},window.milanUniversalAutoHeal=async function(id,video){if(id&&video)return healing[id]||(showLoading(video,!0),markFailed(video,!1),healing[id]=(async()=>{try{const base=video.getAttribute("data-base-src")||"";if(base&&"1"!==video.dataset.healReloaded&&(video.dataset.healReloaded="1",setVideoSrc(video,base),await new Promise(r=>setTimeout(r,4200)),playable(video)))return!0;const res=await api("/records/"+encodeURIComponent(id)+"/media/repair?async=1",{method:"POST",body:JSON.stringify({async:!0})});if(updateRecordFromResponse(id,res),await new Promise(r=>setTimeout(r,6500)),base&&setVideoSrc(video,base),await new Promise(r=>setTimeout(r,4e3)),playable(video))return!0;throw new Error("not-started")}catch(e){return markFailed(video,!0),!1}finally{showLoading(video,!1),setTimeout(()=>{delete healing[id]},1500)}})()),healing[id]},window.milanUniversalVideoError=function(id,video){try{if(!video)return;if("1"===video.dataset.finalFailed)return void markFailed(video,!0);void 0===video.dataset.errorCount&&(video.dataset.errorCount="0");const count=Number(video.dataset.errorCount||0)+1;video.dataset.errorCount=String(count);if(count===1&&video.dataset.milanDirectReady==="1"&&video.dataset.milanSignedRefreshTried!=="1"){video.dataset.milanSignedRefreshTried="1";const resumeAt=Number(video.currentTime||0);showLoading(video,!0);return void loadDirectMedia(video,id,{forceRefresh:true,preserveTime:resumeAt}).then(ok=>{if(!ok)throw new Error("signed URL refresh failed")}).catch(()=>window.milanUniversalAutoHeal(id,video));}if(count<=2)return void window.milanUniversalAutoHeal(id,video);video.dataset.finalFailed="1",markFailed(video,!0)}catch(_){}},window.milanVideoWatchdog=function(id,video){try{if(!id||!video||"1"===video.dataset.watchdogStarted)return;video.dataset.watchdogStarted="1",showLoading(video,!0),setTimeout(()=>{try{if(playable(video))return void showLoading(video,!1);window.milanUniversalAutoHeal(id,video)}catch(_){}},9e3)}catch(_){}},window.milanMediaError=function(id,el){try{const node=mediaNode(el);if(node&&"VIDEO"===node.tagName)return window.milanUniversalVideoError(id,node);if(node&&"1"!==node.dataset.retryDone)return node.dataset.retryDone="1",void milanRetryMedia(node);const box=node?.closest(".media");box&&box.classList.add("previewFailed"),setMediaError(node,"Preview could not start. File is uploaded and download is available.")}catch(_){}},window.mediaHtml=function(r){try{const d=r.data||{},m=d.media||{},raw=r.mediaUrl||m.mediaUrl||d.mediaUrl||"",mt=(m.mimeType||r.dataFormat||"application/octet-stream").toLowerCase();if("video"!==(m.previewCategory||r.mediaCompatibility&&r.mediaCompatibility.previewCategory||(mt.startsWith("image/")?"image":mt.startsWith("video/")?"video":mt.startsWith("audio/")?"audio":"application/pdf"===mt?"pdf":mt.startsWith("text/")?"text":"file")).toLowerCase())return originalMediaHtml?originalMediaHtml(r):"";const id=esc(r.id||""),mediaVersion=esc(m.storageContentHash||m.storageObjectPath||""),rawUrl=raw||"/api/records/"+encodeURIComponent(r.id||"")+"/media";let vurl=videoMediaSrc(rawUrl);vurl=addParam(vurl,"universal","1"),vurl=addParam(vurl,"player","v98");const nativeUrl=addParam(videoMediaSrc(rawUrl),"native_direct","1"),open=esc(nativeUrl),down=esc(mediaDownloadSrc(rawUrl)),name=esc(m.fileName||r.title||"video"),size=m.sizeBytes?" • "+esc(formatBytes(m.sizeBytes)):"",fallback=`<div class="milanVideoFallback"><div>Video is loading. Open/Download is also available.</div><a href="${open}" target="_blank" rel="noopener">Open</a><a href="${down}" download>Download</a></div>`,overlay='<div class="milanVideoOverlay"><div><div class="loader"></div><b>Loading video...</b></div></div>',player=`<video controls playsinline webkit-playsinline x5-playsinline preload="metadata" data-milan-inline-only="1" data-v98-player="1" controlsList="nofullscreen" x-webkit-airplay="deny" data-native-audio="1" data-base-src="${esc(vurl)}" onpointerup="window.milanV98PlayVideo&&window.milanV98PlayVideo('${id}',this,event)" onclick="window.milanV98PlayVideo&&window.milanV98PlayVideo('${id}',this,event)" onplay="milanVideoSoundReady&&milanVideoSoundReady(this)" onloadstart="milanVideoWatchdog('${id}',this)" onloadedmetadata="milanVideoLoadedOk('${id}',this)" oncanplay="milanVideoLoadedOk('${id}',this)" onplaying="milanVideoLoadedOk('${id}',this);milanVideoSoundReady&&milanVideoSoundReady(this)" onerror="milanUniversalVideoError('${id}',this)"><source data-milan-direct-source="1" type="video/mp4"></video>`;return`<div class="media milanUniversalPlayer" data-record-id="${id}" data-media-version="${mediaVersion}">${player}${overlay}${fallback}${`<div class="mini" style="padding:8px 12px;color:var(--muted)">${name}${size}</div>`}${fileCardHtml(m,rawUrl,"hidden")}</div>`}catch(e){return originalMediaHtml?originalMediaHtml(r):'<div class="media"><div class="mini">Video could not load.</div></div>'}};const previousRenderFeed=window.renderFeed;window.renderFeed=function(){previousRenderFeed&&previousRenderFeed(),setTimeout(()=>{try{scheduleVideoPreloadBudget(),window.milanAttachMediaComfort&&window.milanAttachMediaComfort(),document.querySelectorAll(".milanUniversalPlayer video:not([data-milan-initial-scan])").forEach(v=>{v.dataset.milanInitialScan="1";const id=v.closest(".milanUniversalPlayer")?.getAttribute("data-record-id")||"";if(!id)return;if(directObserver)directObserver.observe(v);else loadDirectMedia(v,id)})}catch(e){}},120)}}();
