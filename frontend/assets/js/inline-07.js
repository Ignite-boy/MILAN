!function(){if(window.__milanUniversalVideoV66)return;window.__milanUniversalVideoV66=!0;const originalMediaHtml=window.mediaHtml,healing={};try{const st=document.createElement("style");st.textContent=".milanUniversalPlayer{position:relative;background:#050915;overflow:hidden}.milanUniversalPlayer video{display:block;width:100%;max-height:72vh;min-height:220px;background:#020617;object-fit:contain}.milanVideoOverlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:18px;color:#e5e7eb;background:linear-gradient(180deg,rgba(2,6,23,.28),rgba(2,6,23,.70));pointer-events:none}.milanUniversalPlayer.loading .milanVideoOverlay{display:flex}.milanVideoOverlay .loader{width:42px;height:42px;border-radius:50%;border:4px solid rgba(255,255,255,.25);border-top-color:#fff;margin:0 auto 10px;animation:milanSpin .9s linear infinite}.milanVideoFallback{display:none;padding:10px 14px;border-top:1px solid var(--line);background:rgba(255,255,255,.035);color:var(--muted)}.milanUniversalPlayer.failed .milanVideoFallback{display:block}.milanVideoFallback a{display:inline-flex;margin:8px 8px 0 0;border:1px solid var(--line);border-radius:999px;padding:8px 12px;color:var(--text);text-decoration:none}.milanUniversalPlayer .fileCard{display:none!important}@keyframes milanSpin{to{transform:rotate(360deg)}}",document.head.appendChild(st)}catch(e){}function addParam(url,key,value){const u=String(url||"");return u?u+(u.includes("?")?"&":"?")+encodeURIComponent(key)+"="+encodeURIComponent(null==value?"":value):""}function playerBox(video){return video&&video.closest?video.closest(".milanUniversalPlayer"):null}function showLoading(video,yes){try{const box=playerBox(video);box&&box.classList.toggle("loading",!!yes)}catch(_){}}function markFailed(video,yes){try{const box=playerBox(video);box&&(box.classList.toggle("failed",!!yes),box.classList.toggle("loading",!1))}catch(_){}}function playable(video){try{const d=Number(video.duration);return video.readyState>=1&&Number.isFinite(d)&&d>0}catch(_){return!1}}function setVideoSrc(video,src){try{const source=video.querySelector("source"),next=addParam(src,"r",Date.now());source?source.setAttribute("src",next):video.setAttribute("src",next),video.load()}catch(_){}}function updateRecordFromResponse(id,res){try{if(!res||!res.record||typeof updateRecordLocal!=="function")return;const el=document.getElementById("post-"+id),video=el&&el.querySelector(".milanUniversalPlayer video"),box=video&&video.closest(".milanUniversalPlayer"),preserveVideo=!!(video&&(!video.paused||box&&box.classList.contains("loading")||video.dataset.watchdogStarted==="1"||video.dataset.healReloaded==="1"||video.dataset.errorCount));updateRecordLocal(id,res.record,{preserveVideo})}catch(_){}}async function loadDirectMedia(video,id,attempt){
attempt=Number(attempt||0);
if(!video||!id||video.dataset.milanDirectLoading==="1"||video.dataset.milanDirectReady==="1"||video.dataset.milanDirectFallback==="1")return;
video.dataset.milanDirectLoading="1";
showLoading(video,true);
try{
if(typeof api!=="function")throw new Error("Playback API unavailable");
const result=await api("/records/"+encodeURIComponent(id)+"/media/playback-url");
if(result&&result.ready===false&&result.processing===true){
 if(attempt<60){
  setTimeout(()=>loadDirectMedia(video,id,attempt+1),Number(result.retryAfterMs)||2500);
  return;
 }
 throw new Error("Video conversion is taking too long");
}
const direct=String(result&&result.url||"");
if(result&&result.ready===false&&result.processing===false){
 const terminalError=new Error("Browser-safe video is unavailable");
 terminalError.milanTerminal=true;
 throw terminalError;
}
if(!result||result.ready!==true||!/^https?:\/\/\S+$/i.test(direct))throw new Error("Browser-safe video is not ready");
if(video.dataset.milanDirectFallback==="1")return;
const source=video.querySelector("source[data-milan-direct-source],source");
if(!source)throw new Error("Video source unavailable");
const proxy=String(video.getAttribute("data-base-src")||"");
source.setAttribute("src",direct);
video.dataset.milanDirectReady="1";
video.dataset.milanDirectStorageReady="1";
video.dataset.milanVercelFallback=proxy;
showLoading(video,false);
video.load();
}catch(err){
if(!(err&&err.milanTerminal)&&attempt<10){
 setTimeout(()=>loadDirectMedia(video,id,attempt+1),Number(err&&err.retryAfterMs)||2500);
 return;
}
const source=video.querySelector("source[data-milan-direct-source],source");
const proxy=video.getAttribute("data-base-src")||"";
if(source&&proxy){
 video.dataset.milanDirectFallback="1";
 video.dataset.milanDirectReady="";
 source.setAttribute("src",proxy);
 showLoading(video,false);
 video.load();
}else{
 showLoading(video,false);
 markFailed(video,true);
}
}finally{delete video.dataset.milanDirectLoading}
}
const directObserver=const directObserver=typeof IntersectionObserver==="function"?new IntersectionObserver(entries=>{
entries.forEach(entry=>{
if(!entry.isIntersecting)return;
directObserver.unobserve(entry.target);
const id=entry.target.closest(".milanUniversalPlayer")?.getAttribute("data-record-id")||"";
if(id)loadDirectMedia(entry.target,id);
});
},{rootMargin:"700px 0px"}):null;
window.milanEnsureDirectVideo=loadDirectMedia;
window.milanV98PlayVideo=function(id,video){try{if(!video)return;const source=video.querySelector("source[data-milan-direct-source],source");if(!source||source.getAttribute("src"))return;const base=video.getAttribute("data-base-src")||"";if(!base)return;video.dataset.milanDirectFallback="1";source.setAttribute("src",base);video.load();const pending=video.play();if(pending&&typeof pending.catch==="function")pending.catch(()=>{})}catch(_){} };
function attachVideoStallRecovery(video,id){
if(!video||video.dataset.milanStallRecoveryAttached==="1")return;
video.dataset.milanStallRecoveryAttached="1";
const clearTimer=()=>{if(video.__milanStallTimer){clearTimeout(video.__milanStallTimer);video.__milanStallTimer=null}};
const recovered=()=>{clearTimer();if(!video.paused){showLoading(video,false);markFailed(video,false)}};
video.addEventListener("playing",recovered);
video.addEventListener("canplay",()=>{if(video.readyState>=3)recovered()});
const onStall=()=>{
if(video.paused)return;
showLoading(video,true);
clearTimer();
video.__milanStallTimer=setTimeout(()=>{
video.__milanStallTimer=null;
if(video.paused)return;
if(video.dataset.milanStallFallbackTried==="1")return;
const base=video.getAttribute("data-base-src")||"";
if(!base)return;
video.dataset.milanStallFallbackTried="1";
video.dataset.milanDirectFallback="1";
const position=Number.isFinite(video.currentTime)?video.currentTime:0;
const shouldResume=!video.paused;
let fallbackSettled=false;
const fallbackTimer=setTimeout(()=>{
if(fallbackSettled)return;
fallbackSettled=true;
video.removeEventListener("loadedmetadata",restorePlayback);
markFailed(video,true);
},8000);
function restorePlayback(){
if(fallbackSettled)return;
fallbackSettled=true;
clearTimeout(fallbackTimer);
try{
if(Number.isFinite(position)&&position>0&&Number.isFinite(video.duration)&&position<video.duration)video.currentTime=position;
}catch(_){}
if(shouldResume){const p=video.play();if(p&&typeof p.catch==="function")p.catch(()=>{})}
}
video.addEventListener("loadedmetadata",restorePlayback,{once:true});
setVideoSrc(video,base);
},12000);
};
video.addEventListener("waiting",onStall);
video.addEventListener("stalled",onStall);
}
window.milanVideoLoadedOk=function(id,video){try{playable(video)&&(video.dataset.milanPlayable="1",showLoading(video,!1),markFailed(video,!1),clearMediaError(video))}catch(_){}},window.milanRefreshVideoStatus=async function(id,quiet){try{const res=await api("/records/"+encodeURIComponent(id)+"/media/status?auto=1");return updateRecordFromResponse(id,res),!quiet&&res&&res.ready&&toast("Video ready"),res}catch(e){throw quiet||toast("Video is loading"),e}},window.milanPrepareVideoPreview=async function(id,btn){try{btn&&(btn.disabled=!0,btn.dataset.oldText=btn.textContent,btn.textContent="Loading...");const res=await api("/records/"+encodeURIComponent(id)+"/media/repair?async=1",{method:"POST",body:JSON.stringify({async:!0})});return updateRecordFromResponse(id,res),btn?(toast("Video is loading"),res):res}catch(e){btn&&toast("Video is loading")}finally{btn&&(btn.disabled=!1,btn.textContent=btn.dataset.oldText||"Load video")}},window.milanUniversalAutoHeal=async function(id,video){if(id&&video)return healing[id]||(showLoading(video,!0),markFailed(video,!1),healing[id]=(async()=>{try{const base=video.getAttribute("data-base-src")||"";if(base&&"1"!==video.dataset.healReloaded&&(video.dataset.healReloaded="1",setVideoSrc(video,base),await new Promise(r=>setTimeout(r,4200)),playable(video)))return!0;const res=await api("/records/"+encodeURIComponent(id)+"/media/repair?async=1",{method:"POST",body:JSON.stringify({async:!0})});if(updateRecordFromResponse(id,res),await new Promise(r=>setTimeout(r,6500)),base&&setVideoSrc(video,base),await new Promise(r=>setTimeout(r,4e3)),playable(video))return!0;throw new Error("not-started")}catch(e){return markFailed(video,!0),!1}finally{showLoading(video,!1),setTimeout(()=>{delete healing[id]},1500)}})()),healing[id]},window.milanUniversalVideoError=function(id,video){try{if(!video)return;if("1"===video.dataset.finalFailed)return void markFailed(video,!0);void 0===video.dataset.errorCount&&(video.dataset.errorCount="0");const count=Number(video.dataset.errorCount||0)+1;if(video.dataset.errorCount=String(count),count<=2)return void window.milanUniversalAutoHeal(id,video);video.dataset.finalFailed="1",markFailed(video,!0)}catch(_){}},window.milanVideoWatchdog=function(id,video){try{if(!id||!video||"1"===video.dataset.watchdogStarted)return;video.dataset.watchdogStarted="1",showLoading(video,!0),setTimeout(()=>{try{if(playable(video))return void showLoading(video,!1);if(video.error||video.networkState===3)window.milanUniversalAutoHeal(id,video)}catch(_){}},30e3)}catch(_){}},window.milanMediaError=function(id,el){try{const node=mediaNode(el);if(node&&"VIDEO"===node.tagName)return window.milanUniversalVideoError(id,node);if(node&&"1"!==node.dataset.retryDone)return node.dataset.retryDone="1",void milanRetryMedia(node);const box=node?.closest(".media");box&&box.classList.add("previewFailed"),setMediaError(node,"Preview could not start. File is uploaded and download is available.")}catch(_){}},window.mediaHtml=function(r){try{const d=r.data||{},m=d.media||{},raw=r.mediaUrl||m.mediaUrl||d.mediaUrl||"",mt=(m.mimeType||r.dataFormat||"application/octet-stream").toLowerCase();if("video"!==(m.previewCategory||r.mediaCompatibility&&r.mediaCompatibility.previewCategory||(mt.startsWith("image/")?"image":mt.startsWith("video/")?"video":mt.startsWith("audio/")?"audio":"application/pdf"===mt?"pdf":mt.startsWith("text/")?"text":"file")).toLowerCase())return originalMediaHtml?originalMediaHtml(r):"";const id=esc(r.id||""),rawUrl=raw||"/api/records/"+encodeURIComponent(r.id||"")+"/media";let vurl=videoMediaSrc(rawUrl);vurl=addParam(vurl,"universal","1"),vurl=addParam(vurl,"player","v98");const nativeUrl=addParam(videoMediaSrc(rawUrl),"native_direct","1"),open=esc(nativeUrl),down=esc(mediaDownloadSrc(rawUrl)),name=esc(m.fileName||r.title||"video"),size=m.sizeBytes?" • "+esc(formatBytes(m.sizeBytes)):"",fallback=`<div class="milanVideoFallback"><div>Video is loading. Open/Download is also available.</div><a href="${open}" target="_blank" rel="noopener">Open</a><a href="${down}" download>Download</a></div>`,overlay='<div class="milanVideoOverlay"><div><div class="loader"></div><b>Loading video...</b></div></div>',player=`<video controls playsinline webkit-playsinline x5-playsinline preload="metadata" data-milan-inline-only="1" data-v98-player="1" controlsList="nofullscreen" x-webkit-airplay="deny" data-native-audio="1" data-base-src="${esc(vurl)}"  onplay="milanVideoSoundReady&&milanVideoSoundReady(this)" onloadstart="milanVideoWatchdog('${id}',this)" onloadedmetadata="milanVideoLoadedOk('${id}',this)" oncanplay="milanVideoLoadedOk('${id}',this)" onplaying="milanVideoLoadedOk('${id}',this);milanVideoSoundReady&&milanVideoSoundReady(this)" onerror="milanUniversalVideoError('${id}',this)"><source data-milan-direct-source="1" type="video/mp4"></video>`;return`<div class="media milanUniversalPlayer" data-record-id="${id}">${player}${overlay}${fallback}${`<div class="mini" style="padding:8px 12px;color:var(--muted)">${name}${size}</div>`}${fileCardHtml(m,rawUrl,"hidden")}</div>`}catch(e){return originalMediaHtml?originalMediaHtml(r):'<div class="media"><div class="mini">Video could not load.</div></div>'}};const previousRenderFeed=window.renderFeed;window.renderFeed=function(){previousRenderFeed&&previousRenderFeed(),setTimeout(()=>{try{window.milanAttachMediaComfort&&window.milanAttachMediaComfort(),document.querySelectorAll(".milanUniversalPlayer video:not([data-milan-initial-scan])").forEach(v=>{v.dataset.milanInitialScan="1";attachVideoStallRecovery(v,v.closest(".milanUniversalPlayer")?.getAttribute("data-record-id")||"");const id=v.closest(".milanUniversalPlayer")?.getAttribute("data-record-id")||"";if(!id)return;if(directObserver)directObserver.observe(v);else loadDirectMedia(v,id)})}catch(e){}},120)}}();
