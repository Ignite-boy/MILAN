const $=id=>document.getElementById(id),API="/api",MILAN_NATIVE=/MilanNativeAudio/i.test(navigator.userAgent);MILAN_NATIVE&&(document.documentElement.classList.add("native-apk","milan-v91"),document.body&&document.body.classList.add("native-apk","milan-v91","milan-v91-native"),window.addEventListener("DOMContentLoaded",()=>document.body.classList.add("native-apk","milan-v91","milan-v91-native")));let token="";try{token=localStorage.getItem("milan_token")||""}catch(_){token=""}MILAN_NATIVE&&token&&(document.documentElement.classList.add("milan-token-present","milan-v91-fast-open"),document.body&&document.body.classList.add("milan-token-present","app-ready","milan-app-visible","milan-v91-app-opening"));let me=null,currentFeed=[],people=[],lastNotifications=[],currentScope="all";function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}function initials(s="MILAN"){return String(s||"M").trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase()||"M"}function toast(t){var container=document.getElementById("milanToastContainer");container||((container=document.createElement("div")).id="milanToastContainer",container.style.cssText="position:fixed;top:18px;right:18px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;",document.body.appendChild(container));var el=document.createElement("div");el.textContent=t,el.style.cssText="background:rgba(15,23,42,.92);color:#fff;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.22);opacity:0;transform:translateY(-8px);transition:opacity .22s,transform .22s;pointer-events:none;max-width:320px;word-break:break-word;",container.appendChild(el),requestAnimationFrame(function(){el.style.opacity="1",el.style.transform="translateY(0)"}),setTimeout(function(){el.style.opacity="0",el.style.transform="translateY(-8px)",setTimeout(function(){el.parentNode&&el.parentNode.removeChild(el)},250)},2600)}function avatarHtml(p={},cls="avatar"){const av=p.avatar||"";return/^data:image\//.test(av)||/^https?:\/\//.test(av)?`<div class="${cls}"><img src="${esc(av)}" alt="profile"></div>`:`<div class="${cls}">${esc(av||initials(p.name||p.display_name||p.email||"M"))}</div>`}function mediaSrc(url){if(!url)return"";if(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url))return"";if(/^data:|^blob:/.test(url))return url;const sep=url.includes("?")?"&":"?";return/^https?:\/\//.test(url)?url:token?url+sep+"token="+encodeURIComponent(token)+"&mv=59":url+sep+"mv=49"}function mediaDownloadSrc(url){const base=mediaSrc(url);return base?base+(base.includes("?")?"&":"?")+"download=1":""}function videoMediaSrc(raw){let u=String(raw||"");return/^\/api\/records\/[^/]+\/media$/.test(u)&&(u+="/play.mp4"),mediaSrc(u)}function mediaNode(el){return el&&"SOURCE"===el.tagName?el.parentElement:el}function setMediaError(el,msg,repairing=!1){try{const node=mediaNode(el),box=node?.closest(".media"),err=box?.querySelector(".mediaLoadError");box&&box.classList.toggle("repairing",!!repairing),err&&(err.textContent=msg,err.classList.remove("hidden"))}catch(_){}}function clearMediaError(el){try{const node=mediaNode(el),box=node?.closest(".media");box?.querySelector(".mediaLoadError")?.classList.add("hidden"),box?.classList.remove("repairing"),box?.classList.remove("previewFailed")}catch(_){}}function milanSetVideoSource(video,next){try{if(!video)return;const source=video.querySelector?.("source");source?source.setAttribute("src",next):video.setAttribute("src",next),video.load&&video.load()}catch(_){}}function milanRetryMedia(el){try{const node=mediaNode(el);if(!node||"1"===node.dataset.retrying)return;node.dataset.retrying="1";const source=node.querySelector?.("source"),src=source&&source.getAttribute("src")||node.getAttribute("src")||el.getAttribute?.("src")||"";if(!src)return;setTimeout(()=>{const next=src+(src.includes("?")?"&":"?")+"retry="+Date.now();"VIDEO"===node.tagName?milanSetVideoSource(node,next):node.setAttribute("src",next),node.dataset.retrying="0"},80)}catch(_){}}async function milanRepairVideo(id,el){const video=mediaNode(el);if(video&&"1"!==video.dataset.repairing){video.dataset.repairing="1";try{setMediaError(video,"Loading video...",!0);const result=await api("/records/"+encodeURIComponent(id)+"/media/repair?async=1",{method:"POST",body:JSON.stringify({async:!0})}),rec=result&&result.record?result.record:null;let next=videoMediaSrc(rec&&(rec.mediaUrl||rec.data?.media?.mediaUrl)||"/api/records/"+encodeURIComponent(id)+"/media");next+=(next.includes("?")?"&":"?")+"fixed="+Date.now(),milanSetVideoSource(video,next);try{video.load(),video.play?.().catch(()=>{})}catch(_){}setTimeout(()=>clearMediaError(video),400),toast(result&&result.repaired?"Video ready":"Video checked")}catch(e){const box=video.closest(".media"),card=box?.querySelector(".fileCard");card&&card.classList.remove("hidden"),setMediaError(video,"Video is uploaded safely. Preview is still preparing; refresh once or tap Open/Download.",!0)}finally{setTimeout(()=>{try{video.dataset.repairing="0"}catch(_){}},1200)}}}async function milanMediaError(id,el){try{if(!el)return;const node=mediaNode(el),box=node?.closest(".media");if("VIDEO"===node?.tagName){if("1"!==node.dataset.repairStarted)return node.dataset.repairStarted="1",void await milanRepairVideo(id,node);if("1"!==node.dataset.retryDone)return node.dataset.retryDone="1",setMediaError(node,"Retrying video stream...",!0),void milanRetryMedia(node);if(box){const card=box.querySelector(".fileCard");card&&card.classList.remove("hidden")}return void setMediaError(node,"Tap Open or Download to watch this video.",!1)}if(node&&"1"!==node.dataset.retryDone)return node.dataset.retryDone="1",void milanRetryMedia(node);if(box){box.classList.add("previewFailed");const card=box.querySelector(".fileCard");card&&card.classList.remove("hidden")}setMediaError(node,"Preview could not start. File is uploaded safely and download is available.")}catch(_){}}function setBootStatus(msg){try{let el=document.getElementById("nativeBootStatus");!el&&document.body.classList.contains("native-apk")&&(el=document.createElement("div"),el.id="nativeBootStatus",el.className="boot-status",document.body.appendChild(el)),el&&(el.textContent=msg||"",el.classList.toggle("hidden",!msg))}catch(_){}}async function fetchWithTimeout(url,opt={},ms){const controller=new AbortController,timeout=setTimeout(()=>controller.abort(),ms||2e4);try{return await fetch(url,{...opt,signal:controller.signal})}finally{clearTimeout(timeout)}}async function api(path,opt={}){const h={"Content-Type":"application/json",...opt.headers||{}};let r;token&&(h.Authorization="Bearer "+token);try{r=await fetchWithTimeout(API+path,{...opt,headers:h},Number(opt.timeoutMs||22e3))}catch(e){if(e&&"AbortError"===e.name){const er=new Error("Network timeout. Please refresh once.");throw er.status=0,er}throw e}const d=await r.json().catch(()=>({}));if(!r.ok){const er=new Error(d.error||"Request failed "+r.status);throw er.status=r.status,er}return d}function b64Header(value){try{return btoa(unescape(encodeURIComponent(String(value||""))))}catch(e){return btoa(String(value||""))}}async function apiUploadRaw(path,file,meta,onProgress){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest;let done=!1;const fail=msg=>{done||(done=!0,reject(new Error(msg||"Upload failed")))};xhr.open("POST",API+path,!0),xhr.timeout=Number(window.MILAN_UPLOAD_TIMEOUT_MS||18e5),token&&xhr.setRequestHeader("Authorization","Bearer "+token),xhr.setRequestHeader("Content-Type",file.type||"application/octet-stream"),xhr.setRequestHeader("X-File-Name",b64Header(file.name)),xhr.setRequestHeader("X-Record-Title",b64Header(meta.title||file.name)),xhr.setRequestHeader("X-Record-Caption",b64Header(meta.caption||"")),xhr.setRequestHeader("X-Access-Mode",meta.accessMode||"private"),xhr.setRequestHeader("X-Record-Tags",b64Header(JSON.stringify(meta.tags||[]))),xhr.setRequestHeader("X-Shared-With-Dids",b64Header(JSON.stringify(meta.sharedWithDids||[]))),xhr.upload.onprogress=e=>{e.lengthComputable&&onProgress&&onProgress(Math.max(1,Math.min(98,e.loaded/e.total*100)))},xhr.onload=()=>{let d={};try{d=JSON.parse(xhr.responseText||"{}")}catch(e){}xhr.status>=200&&xhr.status<300?(done=!0,onProgress&&onProgress(100),resolve(d)):fail(d.error||"Upload failed "+xhr.status)},xhr.onerror=()=>fail("Network error during upload. Keep the browser open and try again."),xhr.ontimeout=()=>fail("Upload is taking too long. Try a smaller video or better network."),xhr.onabort=()=>fail("Upload cancelled."),xhr.send(file)})}function xhrUploadBlob(url,blob,headers,onProgress){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest;let done=!1;const fail=msg=>{done||(done=!0,reject(new Error(msg||"Upload chunk failed")))};xhr.open("POST",url,!0),xhr.timeout=Number(window.MILAN_CHUNK_UPLOAD_TIMEOUT_MS||24e4),token&&xhr.setRequestHeader("Authorization","Bearer "+token),xhr.setRequestHeader("Content-Type","application/octet-stream"),Object.entries(headers||{}).forEach(([k,v])=>xhr.setRequestHeader(k,String(v))),xhr.upload.onprogress=e=>{e.lengthComputable&&onProgress&&onProgress(e.loaded,e.total)},xhr.onload=()=>{let d={};try{d=JSON.parse(xhr.responseText||"{}")}catch(e){}xhr.status>=200&&xhr.status<300?(done=!0,resolve(d)):fail(d.error||"Chunk upload failed "+xhr.status)},xhr.onerror=()=>fail("Network issue while uploading chunk. Retrying..."),xhr.ontimeout=()=>fail("Chunk upload timed out. Retrying..."),xhr.onabort=()=>fail("Chunk upload cancelled."),xhr.send(blob)})}async function withRetry(fn,retries=3){let last;for(let i=0;i<retries;i++)try{return await fn(i)}catch(e){last=e,await new Promise(r=>setTimeout(r,700+900*i))}throw last}async function apiUploadChunked(path,file,meta,onProgress){const requestedChunk=Number(window.MILAN_UPLOAD_CHUNK_BYTES||6291456),init=await api("/records/media/chunk/init",{method:"POST",body:JSON.stringify({fileName:file.name,mimeType:file.type||"application/octet-stream",sizeBytes:file.size,chunkBytes:requestedChunk,title:meta.title||file.name,caption:meta.caption||"",accessMode:meta.accessMode||"private",sharedWithDids:meta.sharedWithDids||[],tags:meta.tags||[]})}),uploadId=init.uploadId,chunkBytes=Number(init.chunkBytes||requestedChunk),totalChunks=Number(init.totalChunks||Math.ceil(file.size/chunkBytes));let uploadedBase=0;try{for(let i=0;i<totalChunks;i++){const start=i*chunkBytes,end=Math.min(file.size,start+chunkBytes),blob=file.slice(start,end);await withRetry(async()=>xhrUploadBlob("/api/records/media/chunk/"+encodeURIComponent(uploadId),blob,{"X-Chunk-Index":i,"X-Total-Chunks":totalChunks,"X-Chunk-Bytes":blob.size},loaded=>{if(onProgress){const pct=(uploadedBase+loaded)/file.size*96;onProgress(Math.max(1,Math.min(96,pct)))}}),4),uploadedBase=end,onProgress&&onProgress(Math.max(1,Math.min(96,uploadedBase/file.size*96)))}onProgress&&onProgress(98);const record=await api("/records/media/chunk/"+encodeURIComponent(uploadId)+"/complete",{method:"POST",body:JSON.stringify({}),timeoutMs:Number(window.MILAN_UPLOAD_COMPLETE_TIMEOUT_MS||9e5)});return onProgress&&onProgress(100),record}catch(e){try{await api("/records/media/chunk/"+encodeURIComponent(uploadId),{method:"DELETE"})}catch(_){}throw e}}async function apiUpload(path,file,meta,onProgress){return file&&((file.type||"").startsWith("video/")||file.size>Number(window.MILAN_CHUNK_UPLOAD_THRESHOLD_BYTES||8388608))?apiUploadChunked(path,file,meta,onProgress):apiUploadRaw(path,file,meta,onProgress)}function applyTheme(theme){const t="light"===theme?"light":"dark";document.body.classList.toggle("dark","dark"===t);const btn=$("themeBtn");btn&&(btn.textContent="dark"===t?"☀️ Light":"🌙 Dark")}function toggleTheme(){const next=document.body.classList.contains("dark")?"light":"dark";localStorage.setItem("milanTheme",next),applyTheme(next),toast("dark"===next?"Dark mode enabled":"Light mode enabled")}async function health(){try{const h=await fetchWithTimeout("/api/cloud-dwn/status",{},8e3).then(r=>r.json()),mode=(h.cloudDwn?.mode||"cloud").replace(/-/g," ");$("health").textContent=h.ok?"Cloud DWN online":"API issue",$("health").title=mode+" • "+(h.cloudDwn?.root||"")}catch{$("health").textContent="API offline"}}function isNativeMilan(){return MILAN_NATIVE||document.body.classList.contains("native-apk")}function safeLocalGet(k,fallback=""){try{return localStorage.getItem(k)||fallback}catch(_){return fallback}}function safeLocalRemove(k){try{localStorage.removeItem(k)}catch(_){}}function showAuth(){document.documentElement.classList.remove("milan-has-token","milan-shell-ready");applyTheme(safeLocalGet("milanTheme","dark")),document.documentElement.classList.remove("milan-token-present","milan-v91-fast-open","milan-instant-app"),document.body&&document.body.classList.remove("milan-token-present");const auth=$("authView"),app=$("appView");auth&&(auth.classList.remove("hidden","milan-v88-hidden","milan-v89-hidden","milan-v91-hidden"),auth.style.removeProperty("display"),auth.style.removeProperty("visibility"),auth.style.removeProperty("opacity"),auth.style.removeProperty("pointer-events")),app&&(app.classList.add("hidden"),app.classList.remove("milan-v88-visible","milan-v89-visible","milan-v91-visible"),app.style.removeProperty("display"),app.style.removeProperty("visibility"),app.style.removeProperty("opacity"),app.style.removeProperty("min-height")),document.body.classList.remove("app-ready","milan-app-visible","milan-v88-app-opening","milan-v89-app-opening","milan-v91-app-opening")}function showAppShellSafe(msg="Opening MILAN..."){document.documentElement.classList.add("milan-shell-ready");const auth=$("authView"),app=$("appView"),feed=$("feed");auth&&(auth.classList.add("hidden","milan-v91-hidden"),auth.style.setProperty("display","none","important"),auth.style.setProperty("visibility","hidden","important"),auth.style.setProperty("opacity","0","important"),auth.style.setProperty("pointer-events","none","important")),app&&(app.classList.remove("hidden"),app.classList.add("milan-v91-visible"),app.removeAttribute("aria-hidden"),app.style.setProperty("display","block","important"),app.style.setProperty("visibility","visible","important"),app.style.setProperty("opacity","1","important")),feed&&!String(feed.innerHTML||"").trim()&&(feed.innerHTML='<div class="empty">Opening your MILAN space...</div>'),document.body.classList.add("app-ready","milan-app-visible","milan-token-present","milan-v91-app-opening"),document.documentElement.classList.add("milan-token-present","milan-v91-fast-open"),setBootStatus(msg)}function milanHW(){if(window.__milanHWDead)return null;try{if(!window.__milanHW){const w=new Worker("/milan-heavy-worker.js?v=20260710");w.__cbs={},w.onmessage=e=>{const cb=w.__cbs[e.data.id];cb&&(delete w.__cbs[e.data.id],cb(e.data))},w.onerror=()=>{window.__milanHWDead=1;try{w.terminate()}catch(_){}window.__milanHW=null},window.__milanHW=w}return window.__milanHW}catch(_){return window.__milanHWDead=1,null}}
function milanOffload(task,syncFn,cb){const w=milanHW();if(!w)return void cb(syncFn());let done=!1;const id="t"+Date.now()+Math.random(),t=setTimeout(()=>{done||(done=!0,delete w.__cbs[id],cb(syncFn()))},600);w.__cbs[id]=m=>{done||(done=!0,clearTimeout(t),cb(m.error?syncFn():m))};try{w.postMessage({id:id,...task})}catch(_){done||(done=!0,clearTimeout(t),delete w.__cbs[id],cb(syncFn()))}}
function applyFeed(fresh){const prev=currentFeed;currentFeed=fresh,milanOffload({type:"feedDiff",prev:prev,fresh:fresh},()=>({changed:JSON.stringify(fresh)!==JSON.stringify(prev)}),r=>{(r.changed||!$("feed").childElementCount)&&(me||(window.__milanFeedNoMe=!0),renderFeed(),requestAnimationFrame(()=>initMilanMediaObserver()))})}
function readBootCache(){try{const bc=JSON.parse(localStorage.getItem("milanBootCache")||"null");return bc&&bc.me&&bc.tokenTail===String(token||"").slice(-12)?bc:null}catch(_){return null}}
function saveBootCache(){if(me)try{const v={tokenTail:String(token||"").slice(-12),at:Date.now(),me:me,feed:(currentFeed||[]).slice(0,12),summary:window.__milanLastSummary||null};milanOffload({type:"pack",value:v},()=>({json:JSON.stringify(v)}),r=>{try{r.json&&localStorage.setItem("milanBootCache",r.json)}catch(_){}})}catch(_){}}
function renderSummaryCounts(c){if(c)try{$("peopleCount").textContent=c.people,$("postCount").textContent=c.visiblePosts,$("requestCount").textContent=c.requests,$("notifCount").textContent=c.unreadNotifications}catch(_){}}
async function boot(){return window.__milanBootPromise||(window.__milanBootPromise=(async()=>{if(health().catch(()=>{}),token=token||safeLocalGet("milan_token",""),!token)return void showAuth();const native=isNativeMilan();showAppShellSafe("Opening MILAN...");if(!native){const bc=readBootCache();bc&&(me=bc.me,renderMe(),bc.feed&&bc.feed.length&&(currentFeed=bc.feed,renderFeed()),renderSummaryCounts(bc.summary))}try{me=await api("/auth/me",{timeoutMs:native?9e3:15e3});
try{
  const savedProfile=await api("/profile",{timeoutMs:15e3});
  me.profile={...(me.profile||{}),...(savedProfile||{})};
}catch(profileErr){
  console.warn("Profile restore failed:",profileErr.message);
}
showAppShellSafe("Loading your MILAN space...");
renderMe();
if(native)window.__milanFeedLimit=5;

/* Fast-first-paint: primary feed first, secondary panels in background. */
await loadFeed();

renderSaved();

document.body.classList.remove(
  "milan-v88-app-opening",
  "milan-v89-app-opening",
  "milan-v91-app-opening"
);

window.__milanAppReady=!0;
window.dispatchEvent(new CustomEvent("milan:app-ready"));
setBootStatus("");
saveBootCache();
startBackgroundUpdates();

/* Secondary data never blocks the first usable app state. */
Promise.allSettled([
  loadSummary(),
  loadPeople(),
  loadNotifications()
]).catch(()=>{});}catch(e){console.warn("MILAN session restore failed:",e.message);if(e&&(401===e.status||403===e.status||/expired|invalid|unauthori[sz]ed|jwt/i.test(String(e.message||"")))){safeLocalRemove("milan_token"),safeLocalRemove("milanBootCache"),token="",window.location.href="/";const msg=$("authMsg");return void(msg&&(msg.textContent="Session expired. Please login again."))}if(native){showAppShellSafe("Network is slow. App is still open. Tap Refresh once.");const feed=$("feed");return feed&&(feed.innerHTML='<div class="empty">Network is slow while restoring login. Tap Refresh once, or close/open the app. Your saved login was not removed.</div>'),void setTimeout(()=>setBootStatus(""),7e3)}showAppShellSafe("Reconnecting to MILAN...");const feed=$("feed");feed&&(feed.innerHTML='<div class="empty">Could not refresh live data right now. Your login is still active. Tap Refresh to retry.</div>');setTimeout(()=>setBootStatus(""),7000);}finally{window.__milanBootPromise=null}})()),window.__milanBootPromise}function renderMe(){const p=me.profile||{},name=p.display_name||me.email.split("@")[0];$("myName").textContent=name,$("myEmail").textContent=me.email,$("myAvatar").outerHTML=avatarHtml({avatar:p.avatar,name:name},"avatar lg"),$("composerAvatar").outerHTML=avatarHtml({avatar:p.avatar,name:name},"avatar"),$("myDid").textContent=me.did,$("myDwn").textContent="Cloud DWN: "+(me.dwn?.spaceId||"isolated")}async function loadSummary(){try{const s=await api("/social/summary");window.__milanLastSummary=s.counts,$("peopleCount").textContent=s.counts.people,$("postCount").textContent=s.counts.visiblePosts,$("requestCount").textContent=s.counts.requests,$("notifCount").textContent=s.counts.unreadNotifications,updatePrivacyScore()}catch(e){}}function updatePrivacyScore(){let score=100;currentFeed.some(r=>"public"===r.accessMode)&&(score-=10),currentFeed.some(r=>"shared_did"===r.accessMode)&&(score-=5),score=Math.max(70,score),$("privacyScore").textContent=score+"%",$("privacyBar").style.width=score+"%"}function mediaPlaying(){return[...document.querySelectorAll("video,audio")].some(m=>!m.paused&&!m.ended)}async function loadFeed(){try{window.__milanPendingPosts=window.__milanPendingPosts||[];const __seq=window.__feedSeq=(window.__feedSeq||0)+1,q=$("globalSearch").value.trim(),access=$("filterAccess").value,type=$("filterType").value,native=document.body.classList.contains("native-apk")||/MilanNativeAudio/i.test(navigator.userAgent),qs=new URLSearchParams({scope:currentScope});native&&qs.set("limit",String(Number(window.__milanFeedLimit||5))),q&&qs.set("q",q),access&&qs.set("access",access),type&&qs.set("type",type),window.__feedTmp=await api("/social/feed?"+qs),__seq===window.__feedSeq&&(()=>{

  const fresh=Array.isArray(window.__feedTmp)
    ? window.__feedTmp
    : [];

  const serverIds=new Set(
    fresh.map(r=>String(r?.id||""))
  );

  const pending=(
    window.__milanPendingPosts||[]
  ).filter(r=>{
    const id=String(r?.id||"");

    if(serverIds.has(id)){
      return false;
    }

    const age=
      Date.now()-
      Number(r.__milanPendingAt||Date.now());

    return age < 120000;
  });

  window.__milanPendingPosts=pending;

  applyFeed(
    [...pending,...fresh]
  );

  updatePrivacyScore();
  renderSaved();

})()}catch(e){$("feed").innerHTML='<div class="empty">'+esc(e.message)+"</div>"}}function formatBytes(n){if(!(n=Number(n||0)))return"";const u=["B","KB","MB","GB"];let i=0;for(;n>=1024&&i<u.length-1;)n/=1024,i++;return n.toFixed(i?1:0)+" "+u[i]}function fileIcon(cat,mime){return"image"===cat?"🖼️":"video"===cat?"🎬":"audio"===cat?"🎧":"pdf"===cat?"📄":(mime||"").includes("zip")?"🗜️":"📎"}function fileCardHtml(m,url,extra=""){const name=esc(m.fileName||"MILAN file"),mime=esc(m.mimeType||"file"),size=formatBytes(m.sizeBytes),open=esc(mediaSrc(url)),down=esc(mediaDownloadSrc(url));return`<div class="fileCard ${extra}"><div class="fileIcon">${fileIcon(m.previewCategory||"",m.mimeType)}</div><div class="fileMeta"><b>${name}</b><div class="mini">${mime}${size?" • "+esc(size):""}</div>${m.compatibilityWarning?`<div class="mini">${esc(m.compatibilityWarning)}</div>`:""}</div><div class="fileActions"><a href="${open}" target="_blank" rel="noopener">Open</a><a href="${down}" download>Download</a></div></div>`}function mediaHtml(r){const d=r.data||{},m=d.media||{},raw=r.mediaUrl||m.mediaUrl||d.mediaUrl||"",url=mediaSrc(raw);if(!url)return'';const mt=(m.mimeType||r.dataFormat||"application/octet-stream").toLowerCase(),cat=(m.previewCategory||r.mediaCompatibility?.previewCategory||(mt.startsWith("image/")?"image":mt.startsWith("video/")?"video":mt.startsWith("audio/")?"audio":"application/pdf"===mt?"pdf":mt.startsWith("text/")?"text":"file")).toLowerCase(),id=esc(r.id||""),err='<div class="mini mediaLoadError hidden">Preview is loading...</div>',onErr=`milanMediaError('${id}',this)`,onLoaded="clearMediaError(this)";if("image"===cat)return`<div class="media" data-record-id="${id}"><img loading="lazy" decoding="async" data-milan-observe="1" src="${esc(url)}" alt="${esc(r.title||"media")}" onload="${onLoaded}" onerror="${onErr}">${err}${fileCardHtml(m,raw,"hidden")}</div>`;if("video"===cat){const vurl=videoMediaSrc(raw),mime=!1===m.browserPlayable?"video/mp4":mt||"video/mp4";return`<div class="media" data-record-id="${id}"><video controls preload="none" data-milan-observe="1" playsinline webkit-playsinline x5-playsinline data-milan-inline-only="1" controlsList="nofullscreen nodownload noremoteplayback" onloadedmetadata="${onLoaded}" oncanplay="${onLoaded}" onplaying="${onLoaded}" onerror="${onErr}"><source src="${esc(vurl)}" type="${esc("video/quicktime"===mime?"video/mp4":mime)}"></video>${err}${fileCardHtml(m,raw,"hidden")}</div>`}return"audio"===cat?`<div class="media audioBox" data-record-id="${id}"><audio controls preload="metadata" src="${esc(url)}" type="${esc(mt||"audio/mpeg")}" onloadedmetadata="${onLoaded}" oncanplay="${onLoaded}" onplaying="${onLoaded}" onerror="${onErr}"></audio>${err}${fileCardHtml(m,raw,"hidden")}</div>`:"pdf"===cat?`<div class="media" data-record-id="${id}"><iframe loading="lazy" data-milan-observe="1" data-milan-src="${esc(url)}" title="${esc(m.fileName||r.title||"PDF")}" onload="${onLoaded}"></iframe>${err}${fileCardHtml(m,raw)}</div>`:`<div class="media" data-record-id="${id}">${fileCardHtml(m,raw)}${"video"===cat?'<div class="mini" style="padding:0 16px 14px">Video uploaded safely. Preview is still preparing or conversion is unavailable; use Open/Download and refresh after a few seconds.</div>':""}</div>`}function postText(r){const d=r.data||{};return"string"==typeof d?d:"media"===d.kind?d.caption||"":d.text||d.note||d.caption||""}function renderFeed(){
  const feedEl=$("feed");
  if(!feedEl)return;

  if(!currentFeed.length){
    feedEl.innerHTML='<div class="empty">No posts found. Try creating one or changing filters.</div>';
    return;
  }

  const native=document.body.classList.contains("native-apk")||/MilanNativeAudio/i.test(navigator.userAgent);
  const rows=native
    ? currentFeed.slice(0,Number(window.__milanFeedLimit||10))
    : currentFeed;

  const wantedIds=new Set(rows.map(r=>String(r.id||"")));

  /* Reuse existing post nodes whenever possible. */
  const existing=new Map(
    Array.from(feedEl.querySelectorAll("article.post"))
      .map(el=>[String(el.id||"").replace(/^post-/,""),el])
  );

  rows.forEach((record,index)=>{
    const id=String(record.id||"");
    const html=postHtml(record);
    const current=existing.get(id);

    if(current){
      const wrapper=document.createElement("div");
      wrapper.innerHTML=html;
      const fresh=wrapper.firstElementChild;
      if(fresh && current.outerHTML!==fresh.outerHTML){
        current.replaceWith(fresh);
      }
      existing.delete(id);
    }else{
      const wrapper=document.createElement("div");
      wrapper.innerHTML=html;
      const fresh=wrapper.firstElementChild;
      if(fresh)feedEl.appendChild(fresh);
    }
  });

  /* Remove posts no longer present. */
  existing.forEach(el=>el.remove());

  /* Keep server order without rebuilding the whole feed. */
  rows.forEach(record=>{
    const el=document.getElementById("post-"+String(record.id||""));
    el&&feedEl.appendChild(el);
  });

  let more=document.getElementById("nativeLoadMoreBtn");
  if(more)more.remove();

  if(native && currentFeed.length>rows.length){
    more=document.createElement("button");
    more.className="nativeLoadMore ghost";
    more.id="nativeLoadMoreBtn";
    more.textContent="Load more posts";
    more.onclick=()=>{
      window.__milanFeedLimit+=10;
      renderFeed();
    };
    feedEl.appendChild(more);
  }
}
function initMilanMediaObserver(){
  if(window.__milanMediaObserver)return;

  const feed=document.getElementById("feed");
  if(!feed || !("IntersectionObserver" in window))return;

  window.__milanMediaObserver=new IntersectionObserver((entries,observer)=>{
    for(const entry of entries){
      if(!entry.isIntersecting)continue;

      const el=entry.target;

      if(el.tagName==="VIDEO"){
        try{el.load()}catch(_){}
      }

      if(el.tagName==="IFRAME"){
        const src=el.getAttribute("data-milan-src");
        if(src && !el.getAttribute("src")){
          el.setAttribute("src",src);
        }
        el.removeAttribute("data-milan-src");
      }

      el.removeAttribute("data-milan-observe");
      observer.unobserve(el);
    }
  },{
    root:null,
    rootMargin:"700px 0px",
    threshold:0.01
  });

  feed.querySelectorAll(
    "img[data-milan-observe],video[data-milan-observe],iframe[data-milan-observe]"
  ).forEach(el=>window.__milanMediaObserver.observe(el));
}

function postHtml(r){
  const p={
    ...(r.ownerProfile||{})
  };

  const currentDid=String(
    me?.did ||
    me?.user?.did ||
    me?.data?.user?.did ||
    ""
  ).trim();

  const recordOwner=String(
    r.owner ||
    r.ownerDid ||
    r.creatorDid ||
    r.authorDid ||
    r.ownerProfile?.did ||
    r.authorProfile?.did ||
    ""
  ).trim();

  const currentEmail=String(
    me?.email ||
    me?.user?.email ||
    me?.profile?.email ||
    ""
  ).trim().toLowerCase();

  const ownerEmail=String(
    p.email ||
    r.ownerProfile?.email ||
    ""
  ).trim().toLowerCase();

  const currentName=String(
    me?.profile?.display_name ||
    me?.profile?.name ||
    me?.name ||
    me?.display_name ||
    ""
  ).trim().toLowerCase();

  const ownerName=String(
    p.display_name ||
    p.name ||
    ""
  ).trim().toLowerCase();

  const owner=
    Boolean(
      (currentDid && recordOwner &&
       currentDid===recordOwner) ||

      (currentEmail && ownerEmail &&
       currentEmail===ownerEmail) ||

      (currentName && ownerName &&
       currentName===ownerName)
    );

  if(owner){
    p.name=
      p.display_name ||
      p.name ||
      me?.profile?.display_name ||
      me?.profile?.name ||
      me?.name ||
      me?.email?.split("@")[0] ||
      "MILAN User";

    p.avatar=
      me?.profile?.avatar ||
      p.avatar ||
      "";

    p.did=
      currentDid ||
      p.did ||
      recordOwner;
  }

  const mine=
    r.social?.reactions?.mine;

  const saved=
    savedIds().includes(r.id);

  const ownerControls=owner
    ? `
      <button type="button"
        onclick="editPost('${r.id}')">
        ✏️ Edit
      </button>

      <button type="button"
        onclick="accessPanel('${r.id}')">
        🔐 Access
      </button>

      <button type="button"
        class="milan-delete-post"
        title="Delete this post"
        aria-label="Delete this post"
        onclick="deletePost('${r.id}')">
        🗑 Delete
      </button>
    `
    : `
      <button type="button"
        onclick="requestAccess('${esc(r.owner||"")}','${r.id}')">
        🔑 Request
      </button>
    `;

  return `<article class="card post" id="post-${esc(r.id)}">
    <div class="postHead">
      <div class="postUser">
        ${avatarHtml(p)}
        <div>
          <b>${esc(p.name||"MILAN User")}</b>
          <div class="mini">
            ${esc(r.accessMode||"private")}
            •
            ${new Date(
              r.dateModified ||
              r.dateCreated ||
              Date.now()
            ).toLocaleString()}
            <br>
            <span>
              ${esc(
                (p.did||r.owner||"").slice(0,44)
              )}${p.did||r.owner?"...":""}
            </span>
            ${
              (p.did||r.owner)
                ? `<button type="button"
                    class="ghost"
                    onclick="copyText('${esc(p.did||r.owner)}')">
                    Copy DID
                   </button>`
                : ""
            }
          </div>
        </div>
      </div>

      <div>
        ${
          owner
            ? '<span class="badge">Owner</span>'
            : '<span class="badge">Visible by permission</span>'
        }
      </div>
    </div>

    ${mediaHtml(r)}

    <div class="postBody">
      <div class="postTitle">
        ${esc(r.title||"Untitled")}
      </div>

      <div class="postText">
        ${esc(postText(r))}
      </div>

      <div style="margin-top:8px">
        ${(r.tags||[])
          .map(t =>
            `<span class="badge">#${esc(t)}</span>`
          )
          .join(" ")}
      </div>
    </div>

    <div class="postMetrics">
      <span class="reactionTotal">
        ${r.social?.reactions?.total||0} reactions
      </span>

      <span class="commentTotal">
        ${r.social?.commentsCount||0} comments
      </span>
    </div>

    <div class="reactionBar">
      <button
        class="${"like"===mine?"active":""}"
        onclick="react('${r.id}','like',this)">
        👍 Like
      </button>

      <button
        class="${"love"===mine?"active":""}"
        onclick="react('${r.id}','love',this)">
        💙 Love
      </button>

      <button
        onclick="openComments('${r.id}')">
        💬 Comment
      </button>

      <button
        onclick="toggleSave('${r.id}',this)">
        ${saved?"🔖 Saved":"🔖 Save"}
      </button>

      ${ownerControls}
    </div>
  </article>`;
}
function updateRecordLocal(id,patch){const i=currentFeed.findIndex(r=>r.id===id);if(i>=0){currentFeed[i]={...currentFeed[i],...patch};const el=$("post-"+id);el&&(el.outerHTML=postHtml(currentFeed[i]))}}async function react(id,type,btn){try{const summary=await api("/social/records/"+id+"/reactions",{method:"POST",body:JSON.stringify({type:type})}),r=currentFeed.find(x=>x.id===id);r&&(r.social=r.social||{},r.social.reactions=summary);const card=btn.closest(".post");card.querySelector(".reactionTotal").textContent=(summary.total||0)+" reactions",card.querySelectorAll(".reactionBar button").forEach(b=>b.classList.remove("active")),summary.mine===type&&btn.classList.add("active"),loadNotifications(),loadSummary()}catch(e){toast(e.message)}}async function openComments(id){try{const rows=await api("/social/records/"+id+"/comments");$("modalBody").innerHTML=`<h2>Comments</h2><div class="comments">${rows.map(c=>`<div class="comment">${avatarHtml(c.authorProfile||{})}<div class="bubble"><b>${esc(c.authorProfile?.name||"User")}</b><div>${esc(c.text)}</div><div class="mini">${new Date(c.createdAt).toLocaleString()}</div></div></div>`).join("")||'<div class="empty">No comments yet.</div>'}</div><textarea id="newComment" placeholder="Write a comment"></textarea><br><button onclick="addComment('${id}')">Post comment</button>`,$("modalBack").classList.remove("hidden")}catch(e){toast(e.message)}}async function addComment(id){try{const text=$("newComment").value.trim();if(!text)return toast("Write a comment first");await api("/social/records/"+id+"/comments",{method:"POST",body:JSON.stringify({text:text})}),closeModal();const r=currentFeed.find(x=>x.id===id);if(r){r.social=r.social||{},r.social.commentsCount=Number(r.social.commentsCount||0)+1;const card=$("post-"+id);card&&(card.querySelector(".commentTotal").textContent=r.social.commentsCount+" comments")}toast("Comment posted"),loadNotifications()}catch(e){toast(e.message)}}function accessPanel(id){$("modalBody").innerHTML=`<h2>Update access</h2><p class="mini">The DID box is blank every time. Paste only the DIDs you want to allow now.</p><label>Access mode</label><select id="accessMode"><option value="private">Private</option><option value="public">Public</option><option value="shared_did">Share with DID</option></select><label>Share DIDs</label><textarea id="accessDids" placeholder="Paste DIDs comma separated"></textarea><button onclick="updateAccess('${id}')">Update access</button>`,$("modalBack").classList.remove("hidden")}async function updateAccess(id){try{const mode=$("accessMode").value,dids=$("accessDids").value.split(",").map(x=>x.trim()).filter(x=>x.startsWith("did:"));await api("/records/"+id+"/permissions",{method:"PATCH",body:JSON.stringify({accessMode:mode,sharedWithDids:dids})}),closeModal(),toast("Access updated"),mediaPlaying()?loadSummary():await loadFeed()}catch(e){toast(e.message)}}function editPost(id){const r=currentFeed.find(x=>x.id===id);if(!r)return;const tags=(r.tags||[]).join(", ");$("modalBody").innerHTML=`<h2>Edit post</h2><label>Title</label><input id="editTitle" value="${esc(r.title||"")}"><label>Caption / Text</label><textarea id="editText">${esc(postText(r))}</textarea><label>Tags</label><input id="editTags" value="${esc(tags)}"><p class="mini">Media file is preserved while editing title, text or tags.</p><button onclick="saveEdit('${id}')">Save changes</button>`,$("modalBack").classList.remove("hidden")}async function saveEdit(id){try{const r=currentFeed.find(x=>x.id===id),text=$("editText").value,tags=$("editTags").value.split(",").map(x=>x.trim()).filter(Boolean);let data=r.data;data=data&&"media"===data.kind?{...data,caption:text}:{..."object"==typeof data?data:{},text:text,tags:tags};const updated=await api("/records/"+id,{method:"PUT",body:JSON.stringify({title:$("editTitle").value,data:data,tags:tags})});closeModal(),updateRecordLocal(id,updated),toast("Post updated")}catch(e){toast(e.message)}}async function deletePost(id){
  if(!confirm("Delete this post permanently from DWN?")) return;

  try{
    await api("/records/"+encodeURIComponent(id),{
      method:"DELETE"
    });

    currentFeed=currentFeed.filter(
      r=>r.id!==id
    );

    const card=$("post-"+id);
    if(card) card.remove();

    renderFeed();
    toast("Post deleted from DWN");
    await loadSummary();
  }catch(e){
    toast(e.message||"Could not delete post");
  }
}function sharePanel(id){accessPanel(id)}async function requestAccess(did,id){try{await api("/requests",{method:"POST",body:JSON.stringify({toDid:did,recordId:id,message:"Please allow access to this MILAN record."})}),toast("Access request sent")}catch(e){toast(e.message)}}async function publish(){
  try{
    const file = $("mediaFile").files[0];
    const accessMode = $("privacy").value;

    const sharedWithDids =
      $("shareDids").value
        .split(",")
        .map(x => x.trim())
        .filter(x => x.startsWith("did:"));

    const tags =
      $("tagsInput").value
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);

    if(
      accessMode === "shared_did" &&
      !sharedWithDids.length
    ){
      throw new Error(
        "Paste at least one DID for shared post"
      );
    }

    let createdRecord;

    if(file){
      createdRecord = await apiUpload(
        "/records/media",
        file,
        {
          title:
            $("postTitle").value ||
            file.name,
          caption:
            $("postText").value,
          accessMode,
          sharedWithDids,
          tags
        }
      );
    }else{
      createdRecord = await api(
        "/records",
        {
          method: "POST",
          body: JSON.stringify({
            title:
              $("postTitle").value ||
              "MILAN Post",
            data: {
              text:
                $("postText").value,
              tags
            },
            dataFormat:
              "application/json",
            accessMode,
            sharedWithDids,
            tags
          })
        }
      );
    }

    /*
     * The server has already persisted the record.
     * Put the returned record directly into the current feed.
     * Do NOT call loadFeed() immediately after publish.
     */
    if(
      createdRecord &&
      createdRecord.id
    ){
      currentFeed = [
        createdRecord,
        ...currentFeed.filter(
          r => r.id !== createdRecord.id
        )
      ];

      renderFeed();
    }

    $("postTitle").value = "";
    $("postText").value = "";
    $("mediaFile").value = "";
    $("tagsInput").value = "";
    $("shareDids").value = "";
    $("privacy").value = "private";
    $("shareBox").classList.add("hidden");

    toast("Post published");
    await loadSummary();

  }catch(e){
    console.error(
      "[MILAN] Publish failed:",
      e
    );

    toast(
      e?.message ||
      "Post could not be published"
    );
  }
}

function peopleActions(p){const did=esc(p.did||""),id=esc(p.connectionId||"");let primary="";return"none"===p.connectionStatus||"rejected"===p.connectionStatus?primary=`<button onclick="sendConnect('${did}')">➕ Connect</button>`:"sent"===p.connectionStatus?primary='<button class="ghost" disabled>⏳ Sent</button>':"received"===p.connectionStatus?primary=`<div class="actionRow"><button class="ok" onclick="approveConnect('${id}')">✓ Accept</button><button class="danger" onclick="rejectConnect('${id}')">✕ Reject</button></div>`:"friends"===p.connectionStatus&&(primary='<button class="ok" disabled>✓ Connected</button>'),`<div class="personActions">${primary}<div class="actionRow"><button class="ghost" onclick="copyText('${did}')">📋 DID</button><button class="soft" onclick="requestData('${did}')">🔐 Request</button></div></div>`}async function sendConnect(did){try{await api("/connections",{method:"POST",body:JSON.stringify({toDid:did,message:"I would like to connect with you on MILAN."})}),toast("Connection request sent"),await loadPeople(),await loadSummary(),await loadNotifications()}catch(e){toast(e.message)}}async function approveConnect(id){try{await api("/connections/"+id+"/approve",{method:"PATCH"}),toast("Connection accepted"),await loadPeople(),await loadFeed(),await loadSummary(),await loadNotifications()}catch(e){toast(e.message)}}async function rejectConnect(id){try{await api("/connections/"+id+"/reject",{method:"PATCH"}),toast("Connection rejected"),await loadPeople(),await loadSummary(),await loadNotifications()}catch(e){toast(e.message)}}async function requestData(did){try{const message=prompt("What data do you want to request?","Please share selected MILAN data with me.");if(null===message)return;await api("/requests",{method:"POST",body:JSON.stringify({toDid:did,scope:"profile_or_record",message:message})}),toast("Data access request sent"),await loadNotifications(),await loadSummary()}catch(e){toast(e.message)}}async function loadPeople(){try{const q=($("peopleSearch")?.value||$("globalSearch").value||"").trim();people=await api("/social/people?q="+encodeURIComponent(q)),$("peopleList").innerHTML=people.length?people.map(p=>`<div class="person"><div class="personMain">${avatarHtml(p)}<div class="personInfo"><b>${esc(p.name||"MILAN User")}</b><div class="mini"><span class="personDid" title="${esc(p.did||"")}">${esc(p.did||"")}</span><div class="personMeta"><span class="badge">${esc(p.connectionStatus||"none")}</span></div></div></div></div>${peopleActions(p)}</div>`).join(""):'<div class="empty">No people found.</div>'}catch(e){$("peopleList").innerHTML='<div class="empty">'+esc(e.message)+"</div>"}}async function loadNotifications(){try{lastNotifications=await api("/social/notifications"),$("notifList").innerHTML=lastNotifications.slice(0,8).map(n=>`<div class="bubble"><b>${esc(n.type)}</b><div class="mini">${new Date(n.createdAt).toLocaleString()} • ${esc((n.actorDid||"").slice(0,35))}</div></div>`).join("")||'<div class="mini">No notifications.</div>'}catch(e){}}function savedIds(){try{return JSON.parse(localStorage.getItem("milanSavedIds")||"[]")}catch{return[]}}function setSavedIds(ids){localStorage.setItem("milanSavedIds",JSON.stringify(ids.slice(0,200)))}function toggleSave(id,btn){let ids=savedIds();ids=ids.includes(id)?ids.filter(x=>x!==id):[id,...ids],setSavedIds(ids),btn.textContent=ids.includes(id)?"🔖 Saved":"🔖 Save",renderSaved(),toast(ids.includes(id)?"Saved":"Removed from saved")}function renderSaved(){const ids=savedIds(),rows=currentFeed.filter(r=>ids.includes(r.id)).slice(0,6);$("savedList").innerHTML=rows.length?rows.map(r=>`<div class="bubble"><b>${esc(r.title||"Saved post")}</b><div class="mini">${esc(r.accessMode)}</div></div>`).join(""):'<div class="mini">Save posts to see them here.</div>'}function openProfile(){const p=me.profile||{};$("modalBody").innerHTML=`<h2>Edit Profile</h2><label>Name</label><input id="editName" value="${esc(p.display_name||"")}"><label>Bio</label><textarea id="editBio">${esc(p.bio||"")}</textarea><label>Website</label><input id="editWebsite" value="${esc(p.website||"")}"><label>Profile picture</label><input id="profilePicFile" type="file" accept="image/*"><div class="mini">Upload a small profile picture. It is stored in your profile for this demo.</div><br><button onclick="saveProfile()">Save profile</button>`,$("modalBack").classList.remove("hidden")}function fileToDataUrl(file){return new Promise((res,rej)=>{const r=new FileReader;r.onload=()=>res(r.result),r.onerror=rej,r.readAsDataURL(file)})}async function saveProfile(){try{let avatar=me.profile?.avatar||"";const f=$("profilePicFile").files[0];if(f){if(f.size>9e5)throw new Error("Use profile picture under 900 KB for this free demo.");avatar=await fileToDataUrl(f)}const profile=await api("/profile",{method:"PUT",body:JSON.stringify({display_name:$("editName").value,bio:$("editBio").value,website:$("editWebsite").value,avatar:avatar})});me.profile=profile,closeModal(),renderMe(),loadFeed(),toast("Profile updated")}catch(e){toast(e.message)}}function openPrivacyCenter(){$("modalBody").innerHTML="<h2>Privacy Center</h2><p>MILAN keeps posts private by default. Use Public or Share with DID only when you choose.</p><ul><li>Private: only you</li><li>Public: visible in public feed</li><li>Share with DID: selected people only</li></ul>",$("modalBack").classList.remove("hidden")}function closeModal(){$("modalBack").classList.add("hidden")}function copyText(t){navigator.clipboard.writeText(t||""),toast("Copied")}function startBackgroundUpdates(){
  if(window.__milanTick)return;

  const native=document.body.classList.contains("native-apk")||/MilanNativeAudio/i.test(navigator.userAgent);
  const interval=native?120000:30000;

  const refresh=()=>{
    if(!token || document.hidden || mediaPlaying())return;
    loadNotifications();
    loadSummary();
  };

  window.__milanTick=setInterval(refresh,interval);

  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden){
      requestAnimationFrame(refresh);
    }
  },{passive:true});

  requestAnimationFrame(refresh);
}applyTheme(localStorage.getItem("milanTheme")||"dark"),window.showAppShellSafe=showAppShellSafe,window.showAuth=showAuth,window.addEventListener("error",()=>{const av=document.getElementById("authView"),ap=document.getElementById("appView");av&&ap&&av.classList.contains("hidden")&&ap.classList.contains("hidden")&&av.classList.remove("hidden")}),window.boot=boot,document.querySelectorAll("[data-auth]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-auth]").forEach(x=>x.classList.remove("active")),b.classList.add("active"),$("loginBox").classList.toggle("hidden","login"!==b.dataset.auth),$("registerBox").classList.toggle("hidden","register"!==b.dataset.auth)}),$("loginBtn").onclick=async()=>{const btn=$("loginBtn");try{btn.disabled=!0,btn.textContent="Logging in...",$("authMsg").textContent="Checking account...";const r=await api("/auth/login",{method:"POST",timeoutMs:2e4,body:JSON.stringify({email:$("loginEmail").value,password:$("loginPass").value})});token=r.token,localStorage.setItem("milan_token",token),$("authMsg").textContent="Opening app...",isNativeMilan()&&showAppShellSafe("Opening MILAN..."),window.__milanBootPromise=null,await boot()}catch(e){$("authMsg").textContent=e.message,isNativeMilan()&&!token&&showAuth()}finally{btn.disabled=!1,btn.textContent="Login"}},$("registerBtn").onclick=async()=>{try{await api("/auth/register",{method:"POST",body:JSON.stringify({name:$("regName").value,email:$("regEmail").value,password:$("regPass").value})}),$("loginEmail").value=$("regEmail").value,$("loginPass").value="",document.querySelector('[data-auth="login"]').click(),$("authMsg").textContent="Registered. Please login."}catch(e){$("authMsg").textContent=e.message}},$("logoutBtn").onclick=()=>{localStorage.removeItem("milan_token"),localStorage.removeItem("milanBootCache"),document.documentElement.classList.remove("milan-token-present","milan-v91-fast-open","milan-instant-app"),window.location.href="/"},$("publishBtn").onclick=publish,$("refreshBtn").onclick=()=>{loadFeed(),loadSummary(),loadPeople(),loadNotifications()},$("privacy").onchange=()=>{$("shareBox").classList.toggle("hidden","shared_did"!==$("privacy").value),"shared_did"!==$("privacy").value&&($("shareDids").value="")};const milanDebounce=(fn,ms=450)=>{let t;return function(){clearTimeout(t),t=setTimeout(fn,ms)}};$("peopleSearch").oninput=milanDebounce(()=>loadPeople(),500),$("globalSearch").oninput=milanDebounce(()=>{window.__milanFeedLimit=10,loadFeed(),setTimeout(()=>loadPeople(),300)},550),$("filterAccess").onchange=()=>{window.__milanFeedLimit=10,loadFeed()},$("filterType").onchange=()=>{window.__milanFeedLimit=10,loadFeed()},document.querySelectorAll("[data-scope]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-scope]").forEach(x=>x.classList.remove("active")),b.classList.add("active"),currentScope=b.dataset.scope,loadFeed()}),$("profileBtn").onclick=openProfile,$("copyDidBtn").onclick=()=>copyText(me?.did),$("themeBtn").onclick=toggleTheme,$("markReadBtn").onclick=async()=>{for(const n of lastNotifications.slice(0,8))n.read||await api("/social/notifications/"+n.id+"/read",{method:"PATCH"});toast("Notifications marked"),loadNotifications(),loadSummary()},window.addEventListener("DOMContentLoaded",()=>{requestAnimationFrame(()=>boot())},{once:true});