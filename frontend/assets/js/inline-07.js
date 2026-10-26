!function(){if(window.__milanUniversalVideoV66)return;window.__milanUniversalVideoV66=!0;const originalMediaHtml=window.mediaHtml,healing={};try{const st=document.createElement("style");st.textContent=".milanUniversalPlayer{position:relative;background:#050915;overflow:hidden}.milanUniversalPlayer video{display:block;width:100%;max-height:72vh;min-height:220px;background:#020617;object-fit:contain}.milanVideoOverlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:18px;color:#e5e7eb;background:linear-gradient(180deg,rgba(2,6,23,.28),rgba(2,6,23,.70));pointer-events:none}.milanUniversalPlayer.loading .milanVideoOverlay{display:flex}.milanVideoOverlay .loader{width:42px;height:42px;border-radius:50%;border:4px solid rgba(255,255,255,.25);border-top-color:#fff;margin:0 auto 10px;animation:milanSpin .9s linear infinite}.milanVideoFallback{display:none;padding:10px 14px;border-top:1px solid var(--line);background:rgba(255,255,255,.035);color:var(--muted)}.milanUniversalPlayer.failed .milanVideoFallback{display:block}.milanVideoFallback a{display:inline-flex;margin:8px 8px 0 0;border:1px solid var(--line);border-radius:999px;padding:8px 12px;color:var(--text);text-decoration:none}.milanUniversalPlayer .fileCard{display:none!important}.milanUniversalPlayer.loading .milanVideoOverlay[data-milan-loading-message]::after{content:attr(data-milan-loading-message);position:absolute;left:5%;right:5%;bottom:13%;font-size:14px;font-weight:600;line-height:1.35;text-shadow:0 1px 5px #000}@keyframes milanSpin{to{transform:rotate(360deg)}}",document.head.appendChild(st)}catch(e){}function addParam(url,key,value){const u=String(url||"");return u?u+(u.includes("?")?"&":"?")+encodeURIComponent(key)+"="+encodeURIComponent(null==value?"":value):""}function playerBox(video){return video&&video.closest?video.closest(".milanUniversalPlayer"):null}function showLoading(video,yes){try{const box=playerBox(video);box&&box.classList.toggle("loading",!!yes)}catch(_){}}function markFailed(video,yes){try{const box=playerBox(video);box&&(box.classList.toggle("failed",!!yes),box.classList.toggle("loading",!1))}catch(_){}}function playable(video){try{const d=Number(video.duration);return video.readyState>=1&&Number.isFinite(d)&&d>0}catch(_){return!1}}const temporaryPlaybackUrls=new Map();const observedVideos=new Set();
function releaseTemporaryPlayback(video){try{const old=video&&video.dataset&&video.dataset.milanTempBlobUrl;if(old){URL.revokeObjectURL(old);temporaryPlaybackUrls.delete(old);delete video.dataset.milanTempBlobUrl}}catch(_){}}
function setTemporaryDownloadMessage(video,message){try{const box=playerBox(video);if(!box)return;const target=box.querySelector(".milanVideoOverlay")||box;if(message)target.setAttribute("data-milan-loading-message",message);else target.removeAttribute("data-milan-loading-message")}catch(_){}}
function cleanupTemporaryPlayback(){try{for(const video of observedVideos){if(video&&video.isConnected)continue;try{directObserver&&directObserver.unobserve(video)}catch(_){}try{visibilityObserver&&visibilityObserver.unobserve(video)}catch(_){}observedVideos.delete(video)}for(const [url,video] of temporaryPlaybackUrls){if(!video||!video.isConnected){try{URL.revokeObjectURL(url)}catch(_){}temporaryPlaybackUrls.delete(url);if(video&&video.dataset)delete video.dataset.milanTempBlobUrl}}}catch(_){}}
async function readBoundedVideoBlob(response,maxBytes){const reader=response&&response.body&&typeof response.body.getReader==="function"?response.body.getReader():null;if(!reader)throw new Error("Streaming video download unavailable");const chunks=[];let total=0;try{for(;;){const item=await reader.read();if(item.done)break;const chunk=item.value;const size=Number(chunk&&(chunk.byteLength??chunk.length));if(!Number.isSafeInteger(size)||size<0){try{await reader.cancel("Invalid video chunk")}catch(_){}throw new Error("Invalid video chunk")}total+=size;if(total>maxBytes){try{await reader.cancel("Temporary video buffer limit exceeded")}catch(_){}throw new Error("Temporary video exceeds playback buffer limit")}chunks.push(chunk)}}finally{try{reader.releaseLock()}catch(_){}}const type=String(response.headers&&typeof response.headers.get==="function"&&response.headers.get("content-type")||"video/mp4");return new Blob(chunks,{type})}

async function loadStallBlobFallback(video,src,position,shouldResume){
if(!video||!src||video.dataset.milanStallBlobAttempted!=="1")return!1;
let blobUrl="";
let controller=null;
let downloadTimer=null;
const source=video.querySelector("source[data-milan-direct-source],source");
if(!source||typeof fetch!=="function"||typeof URL.createObjectURL!=="function")return!1;
try{
const url=new URL(src,window.location.href);
if(url.origin!==window.location.origin)return!1;
const configured=Number(window.MILAN_TEMP_PLAYBACK_MAX_BYTES)||48*1024*1024;
const lowMemory=Number(navigator.deviceMemory||0)>0&&Number(navigator.deviceMemory)<=4;
const limit=Math.min(configured,lowMemory?24*1024*1024:48*1024*1024);
controller=typeof AbortController==="function"?new AbortController():null;
if(controller)downloadTimer=setTimeout(()=>controller.abort(),30000);
video.dataset.milanTempDownloadInProgress="1";
showLoading(video,!0);
setTemporaryDownloadMessage(video,"Preparing video for smoother playback…");
const response=await fetch(url.toString(),{
method:"GET",cache:"no-store",credentials:"same-origin",
...(controller?{signal:controller.signal}:{})
});
if(!response.ok||!response.body)throw new Error("Video download failed");
const declared=Number(response.headers.get("content-length")||0);
if(declared>limit){
try{await response.body.cancel()}catch(_){}
throw new Error("Video exceeds temporary playback limit");
}
const blob=await readBoundedVideoBlob(response,limit);
if(!blob.size||blob.size>limit||!video.isConnected)throw new Error("Video buffer unavailable");
releaseTemporaryPlayback(video);
blobUrl=URL.createObjectURL(blob);
temporaryPlaybackUrls.set(blobUrl,video);
video.dataset.milanTempBlobUrl=blobUrl;
video.dataset.milanTempDownloadComplete="1";
source.setAttribute("src",blobUrl);
setTemporaryDownloadMessage(video,"");
const metadataReady=await new Promise(resolve=>{
let settled=false;
const finish=value=>{
if(settled)return;
settled=true;
clearTimeout(timeout);
video.removeEventListener("loadedmetadata",onMetadata);
resolve(value);
};
const onMetadata=()=>finish(true);
const timeout=setTimeout(()=>finish(false),8000);
video.addEventListener("loadedmetadata",onMetadata,{once:true});
video.load();
});
if(!metadataReady)throw new Error("Buffered video metadata unavailable");
try{
if(Number.isFinite(position)&&position>0&&Number.isFinite(video.duration)&&position<video.duration)video.currentTime=position;
}catch(_){}
showLoading(video,!1);
markFailed(video,!1);
if(video.dataset.milanOffscreen==="1"){
video.dataset.milanPausedOffscreen="1";
}else if(shouldResume){
try{const pending=video.play();if(pending&&typeof pending.catch==="function")await pending}catch(_){}
}
return!0;
}catch(_){
if(blobUrl){
if(video.dataset.milanTempBlobUrl===blobUrl)releaseTemporaryPlayback(video);
else try{URL.revokeObjectURL(blobUrl)}catch(_){}
}
return!1;
}finally{
if(downloadTimer)clearTimeout(downloadTimer);
delete video.dataset.milanTempDownloadInProgress;
setTemporaryDownloadMessage(video,"");
}
}
try{if(typeof MutationObserver==="function"&&document.documentElement)new MutationObserver(cleanupTemporaryPlayback).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener("pagehide",event=>{if(event&&event.persisted)return;for(const [url] of temporaryPlaybackUrls){try{URL.revokeObjectURL(url)}catch(_){}}temporaryPlaybackUrls.clear()})}catch(_){}
function setVideoSrc(video,src){try{releaseTemporaryPlayback(video);const source=video.querySelector("source"),next=addParam(src,"r",Date.now());source?source.setAttribute("src",next):video.setAttribute("src",next),video.load()}catch(_){}}function updateRecordFromResponse(id,res){try{if(!res||!res.record||typeof updateRecordLocal!=="function")return;const el=document.getElementById("post-"+id),video=el&&el.querySelector(".milanUniversalPlayer video"),box=video&&video.closest(".milanUniversalPlayer"),preserveVideo=!!(video&&(!video.paused||box&&box.classList.contains("loading")||video.dataset.watchdogStarted==="1"||video.dataset.healReloaded==="1"||video.dataset.errorCount));updateRecordLocal(id,res.record,{preserveVideo})}catch(_){}}async function loadDirectMedia(video,id,attempt){
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
 const readyStatus=String(result.processingStatus||"").toLowerCase();
 const source=video.querySelector("source[data-milan-direct-source],source");
 const proxy=String(video.getAttribute("data-base-src")||"");
 if(readyStatus==="ready"&&source&&proxy){
  video.dataset.milanDirectFallback="1";
  video.dataset.milanDirectReady="";
  source.setAttribute("src",proxy);
  showLoading(video,false);
  video.load();
  return;
 }
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
const directObserver=typeof IntersectionObserver==="function"?new IntersectionObserver(entries=>{
entries.forEach(entry=>{
if(!entry.isIntersecting)return;
directObserver.unobserve(entry.target);
const id=entry.target.closest(".milanUniversalPlayer")?.getAttribute("data-record-id")||"";
if(id)loadDirectMedia(entry.target,id);
});
},{rootMargin:"700px 0px"}):null;
const visibilityObserver=typeof IntersectionObserver==="function"?new IntersectionObserver(entries=>{
entries.forEach(entry=>{
const video=entry.target;
if(entry.isIntersecting&&entry.intersectionRatio>=.15){
 delete video.dataset.milanOffscreen;
 if(video.dataset.milanPausedOffscreen!=="1")return;
 delete video.dataset.milanPausedOffscreen;
 if(video.dataset.milanTempDownloadInProgress==="1"){
  video.dataset.milanResumeAfterTempDownload="1";
  return;
 }
 if(video.isConnected&&!video.ended&&video.dataset.finalFailed!=="1"){
  try{const pending=video.play();if(pending&&typeof pending.catch==="function")pending.catch(()=>{})}catch(_){}
 }
 return;
}
video.dataset.milanOffscreen="1";
if(!video.paused&&!video.ended){
 video.dataset.milanPausedOffscreen="1";
 try{video.pause()}catch(_){}
 setTemporaryDownloadMessage(video,"");
 showLoading(video,false);
}else if(video.dataset.milanTempDownloadInProgress==="1"&&video.dataset.milanResumeAfterTempDownload==="1"){
 video.dataset.milanPausedOffscreen="1";
}
});
},{rootMargin:"0px",threshold:[0,.15]}):null;
window.milanEnsureDirectVideo=loadDirectMedia;
window.milanV98PlayVideo=function(id,video){try{if(!video)return;const source=video.querySelector("source[data-milan-direct-source],source");if(!source||source.getAttribute("src"))return;const base=video.getAttribute("data-base-src")||"";if(!base)return;video.dataset.milanDirectFallback="1";source.setAttribute("src",base);video.load();const pending=video.play();if(pending&&typeof pending.catch==="function")pending.catch(()=>{})}catch(_){} };
function attachVideoStallRecovery(video,id){
if(!video||video.dataset.milanStallRecoveryAttached==="1")return;
video.dataset.milanStallRecoveryAttached="1";
const clearTimer=()=>{if(video.__milanStallTimer){clearTimeout(video.__milanStallTimer);video.__milanStallTimer=null}};
const recovered=()=>{clearTimer();if(!video.paused){showLoading(video,false);markFailed(video,false)}};
video.addEventListener("playing",()=>{setTemporaryDownloadMessage(video,"");recovered()});
video.addEventListener("canplay",()=>{if(video.readyState>=3)recovered()});
video.addEventListener("play",()=>{
if(window.MILAN_ENABLE_TEMP_PLAYBACK_DOWNLOAD!==true||video.dataset.milanTempDownloadAttempted==="1"||video.dataset.milanDirectReady!=="1"||video.dataset.milanDirectFallback==="1")return;
const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
if(connection&&(connection.saveData||/^(slow-2g|2g|3g)$/i.test(String(connection.effectiveType||""))))return;
const source=video.querySelector("source[data-milan-direct-source],source");
const direct=String(source&&source.getAttribute("src")||"");
if(!/^https?:\/\//i.test(direct)||typeof fetch!=="function"||typeof URL.createObjectURL!=="function")return;
video.dataset.milanTempDownloadAttempted="1";
video.dataset.milanTempDownloadInProgress="1";
video.dataset.milanResumeAfterTempDownload="1";
video.pause();
showLoading(video,true);
setTemporaryDownloadMessage(video,"Downloading video for smooth, uninterrupted playback…");
const configuredLimit=Number(window.MILAN_TEMP_PLAYBACK_MAX_BYTES)||48*1024*1024;
const lowMemory=Number(navigator.deviceMemory||0)>0&&Number(navigator.deviceMemory)<=4;
const limit=Math.min(configuredLimit,lowMemory?24*1024*1024:48*1024*1024);
const resumeStreaming=()=>{
setTemporaryDownloadMessage(video,"");
showLoading(video,false);
if(!video.isConnected)return;
delete video.dataset.milanTempDownloadInProgress;
delete video.dataset.milanResumeAfterTempDownload;
if(video.dataset.milanOffscreen==="1"){video.dataset.milanPausedOffscreen="1";return}
try{const pending=video.play();if(pending&&typeof pending.catch==="function")pending.catch(()=>{})}catch(_){}
};
(async()=>{
let response=null;
try{
response=await fetch(direct,{method:"GET",cache:"no-store",credentials:"omit"});
if(!response.ok||!response.body)throw new Error("Temporary video download failed");
const length=Number(response.headers.get("content-length")||0);
if(!Number.isFinite(length)||length<=0||length>limit){
try{await response.body.cancel()}catch(_){}
return resumeStreaming();
}
const blob=await readBoundedVideoBlob(response,limit);
if(!blob.size||blob.size>limit)return resumeStreaming();
releaseTemporaryPlayback(video);
const blobUrl=URL.createObjectURL(blob);
temporaryPlaybackUrls.set(blobUrl,video);
video.dataset.milanTempBlobUrl=blobUrl;
video.dataset.milanTempDownloadComplete="1";
delete video.dataset.milanTempDownloadInProgress;
source.setAttribute("src",blobUrl);
setTemporaryDownloadMessage(video,"");
showLoading(video,false);
video.load();
if(video.dataset.milanOffscreen==="1"){
 video.dataset.milanPausedOffscreen="1";
 delete video.dataset.milanResumeAfterTempDownload;
 return;
}
delete video.dataset.milanResumeAfterTempDownload;
try{
const pending=video.play();
if(pending&&typeof pending.catch==="function")pending.catch(()=>{
showLoading(video,false);
setTemporaryDownloadMessage(video,"Video is downloaded. Tap play to watch.");
});
}catch(_){showLoading(video,false);setTemporaryDownloadMessage(video,"Video is downloaded. Tap play to watch.")}
}catch(_){resumeStreaming()}
})();
});
const onStall=()=>{
if(video.paused)return;
showLoading(video,true);
clearTimer();
video.__milanStallTimer=setTimeout(async()=>{
video.__milanStallTimer=null;
if(video.paused)return;
const base=video.getAttribute("data-base-src")||"";
if(!base)return;
const position=Number.isFinite(video.currentTime)?video.currentTime:0;
const shouldResume=!video.paused;

// On the authenticated fallback, avoid repeatedly reloading the same URL.
// Attempt one capped full-file Blob fallback instead.
if(video.dataset.milanDirectFallback==="1"||video.dataset.milanStallFallbackTried==="1"){
if(video.dataset.milanStallBlobAttempted==="1")return;
video.dataset.milanStallBlobAttempted="1";
const recovered=await loadStallBlobFallback(video,base,position,shouldResume);
if(!recovered&&video.isConnected)markFailed(video,true);
return;
}

video.dataset.milanStallFallbackTried="1";
video.dataset.milanDirectFallback="1";
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
if(shouldResume){const pending=video.play();if(pending&&typeof pending.catch==="function")pending.catch(()=>{})}
}
video.addEventListener("loadedmetadata",restorePlayback,{once:true});
setVideoSrc(video,base);
},12000);
};
video.addEventListener("waiting",onStall);
video.addEventListener("stalled",onStall);
}
window.milanVideoLoadedOk=function(id,video){try{playable(video)&&(video.dataset.milanPlayable="1",showLoading(video,!1),markFailed(video,!1),clearMediaError(video))}catch(_){}},window.milanRefreshVideoStatus=async function(id,quiet){try{const res=await api("/records/"+encodeURIComponent(id)+"/media/status?auto=1");return updateRecordFromResponse(id,res),!quiet&&res&&res.ready&&toast("Video ready"),res}catch(e){throw quiet||toast("Video is loading"),e}},window.milanPrepareVideoPreview=async function(id,btn){try{btn&&(btn.disabled=!0,btn.dataset.oldText=btn.textContent,btn.textContent="Loading...");const res=await api("/records/"+encodeURIComponent(id)+"/media/repair?async=1",{method:"POST",body:JSON.stringify({async:!0})});return updateRecordFromResponse(id,res),btn?(toast("Video is loading"),res):res}catch(e){btn&&toast("Video is loading")}finally{btn&&(btn.disabled=!1,btn.textContent=btn.dataset.oldText||"Load video")}},window.milanUniversalAutoHeal=async function(id,video){
if(!id||!video)return!1;
if(healing[id])return healing[id];
const base=String(video.getAttribute("data-base-src")||"");
const position=Number.isFinite(video.currentTime)?video.currentTime:0;
const shouldResume=!video.paused;
const task=(async()=>{
showLoading(video,!0);markFailed(video,!1);
try{
// Change source only when leaving the direct URL for the authenticated stream.
// If already on that stream, do not reload it and discard its current buffer.
if(base&&video.dataset.milanDirectFallback!=="1"&&video.dataset.healReloaded!=="1"){
video.dataset.healReloaded="1";
video.dataset.milanDirectFallback="1";
const metadataReady=await new Promise(resolve=>{
let settled=false;
let timer;
const finish=ok=>{
if(settled)return;
settled=true;
clearTimeout(timer);
video.removeEventListener("loadedmetadata",onMetadata);
video.removeEventListener("error",onError);
resolve(ok);
};
const onMetadata=()=>finish(playable(video));
const onError=()=>finish(false);
video.addEventListener("loadedmetadata",onMetadata,{once:true});
video.addEventListener("error",onError,{once:true});
timer=setTimeout(()=>finish(playable(video)),8000);
setVideoSrc(video,base);
});
if(metadataReady){
try{
if(position>0&&Number.isFinite(video.duration)&&position<video.duration)video.currentTime=position;
}catch(_){}
if(shouldResume){
try{const pending=video.play();if(pending&&typeof pending.catch==="function")await pending}catch(_){}
}
return!0;
}
}
// Already on fallback, or the one source switch failed: make one bounded
// same-origin Blob attempt instead of repeatedly calling video.load().
if(base&&video.dataset.milanStallBlobAttempted!=="1"){
video.dataset.milanStallBlobAttempted="1";
if(await loadStallBlobFallback(video,base,position,shouldResume))return!0;
}
const res=await api("/records/"+encodeURIComponent(id)+"/media/repair?async=1",{
method:"POST",body:JSON.stringify({async:!0})
});
updateRecordFromResponse(id,res);
if(playable(video))return!0;
throw new Error("not-started");
}catch(e){markFailed(video,!0);return!1}
finally{
showLoading(video,!1);
setTimeout(()=>{delete healing[id]},1500);
}
})();
healing[id]=task;
return task
},window.milanUniversalVideoError=function(id,video){try{if(!video)return;if("1"===video.dataset.finalFailed)return void markFailed(video,!0);void 0===video.dataset.errorCount&&(video.dataset.errorCount="0");const count=Number(video.dataset.errorCount||0)+1;if(video.dataset.errorCount=String(count),count<=2)return void window.milanUniversalAutoHeal(id,video);video.dataset.finalFailed="1",markFailed(video,!0)}catch(_){}},window.milanVideoWatchdog=function(id,video){try{if(!id||!video||"1"===video.dataset.watchdogStarted)return;video.dataset.watchdogStarted="1",showLoading(video,!0),setTimeout(()=>{try{if(playable(video))return void showLoading(video,!1);if(video.error||video.networkState===3)window.milanUniversalAutoHeal(id,video)}catch(_){}},30e3)}catch(_){}},window.milanMediaError=function(id,el){try{const node=mediaNode(el);if(node&&"VIDEO"===node.tagName)return window.milanUniversalVideoError(id,node);if(node&&"1"!==node.dataset.retryDone)return node.dataset.retryDone="1",void milanRetryMedia(node);const box=node?.closest(".media");box&&box.classList.add("previewFailed"),setMediaError(node,"Preview could not start. File is uploaded and download is available.")}catch(_){}},window.mediaHtml=function(r){try{const d=r.data||{},m=d.media||{},raw=r.mediaUrl||m.mediaUrl||d.mediaUrl||"",mt=(m.mimeType||r.dataFormat||"application/octet-stream").toLowerCase();if("video"!==(m.previewCategory||r.mediaCompatibility&&r.mediaCompatibility.previewCategory||(mt.startsWith("image/")?"image":mt.startsWith("video/")?"video":mt.startsWith("audio/")?"audio":"application/pdf"===mt?"pdf":mt.startsWith("text/")?"text":"file")).toLowerCase())return originalMediaHtml?originalMediaHtml(r):"";const id=esc(r.id||""),rawUrl=raw||"/api/records/"+encodeURIComponent(r.id||"")+"/media";let vurl=videoMediaSrc(rawUrl);vurl=addParam(vurl,"universal","1"),vurl=addParam(vurl,"player","v98");const nativeUrl=addParam(videoMediaSrc(rawUrl),"native_direct","1"),open=esc(nativeUrl),down=esc(mediaDownloadSrc(rawUrl)),name=esc(m.fileName||r.title||"video"),size=m.sizeBytes?" • "+esc(formatBytes(m.sizeBytes)):"",fallback=`<div class="milanVideoFallback"><div>Video is loading. Open/Download is also available.</div><a href="${open}" target="_blank" rel="noopener">Open</a><a href="${down}" download>Download</a></div>`,overlay='<div class="milanVideoOverlay"><div><div class="loader"></div><b>Loading video...</b></div></div>',player=`<video controls playsinline webkit-playsinline x5-playsinline preload="metadata" data-milan-inline-only="1" data-v98-player="1" controlsList="nofullscreen" x-webkit-airplay="deny" data-native-audio="1" data-base-src="${esc(vurl)}"  onplay="milanVideoSoundReady&&milanVideoSoundReady(this)" onloadstart="milanVideoWatchdog('${id}',this)" onloadedmetadata="milanVideoLoadedOk('${id}',this)" oncanplay="milanVideoLoadedOk('${id}',this)" onplaying="milanVideoLoadedOk('${id}',this);milanVideoSoundReady&&milanVideoSoundReady(this)" onerror="milanUniversalVideoError('${id}',this)"><source data-milan-direct-source="1" type="video/mp4"></video>`;return`<div class="media milanUniversalPlayer" data-record-id="${id}">${player}${overlay}${fallback}${`<div class="mini" style="padding:8px 12px;color:var(--muted)">${name}${size}</div>`}${fileCardHtml(m,rawUrl,"hidden")}</div>`}catch(e){return originalMediaHtml?originalMediaHtml(r):'<div class="media"><div class="mini">Video could not load.</div></div>'}};const previousRenderFeed=window.renderFeed;window.renderFeed=function(){previousRenderFeed&&previousRenderFeed(),setTimeout(()=>{try{window.milanAttachMediaComfort&&window.milanAttachMediaComfort(),document.querySelectorAll(".milanUniversalPlayer video:not([data-milan-initial-scan])").forEach(v=>{v.dataset.milanInitialScan="1";attachVideoStallRecovery(v,v.closest(".milanUniversalPlayer")?.getAttribute("data-record-id")||"");const id=v.closest(".milanUniversalPlayer")?.getAttribute("data-record-id")||"";if(!id)return;observedVideos.add(v);if(directObserver)directObserver.observe(v);else loadDirectMedia(v,id);if(visibilityObserver)visibilityObserver.observe(v)})}catch(e){}},120)}}();
