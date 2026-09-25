
(function(){
  "use strict";
  var $=function(i){return document.getElementById(i);};
  var APP="MILAN", AUDIUS_HOSTS=["https://discoveryprovider.audius.co","https://audius-discovery-1.altego.net","https://discoveryprovider2.audius.co"];
  var engine="audius", audiusHost=null, tracks=[], idx=-1, shuffle=false, repeat=false, seeking=false;
  var audio=$("audio"); audio.volume=0.9;
  var yt=null, ytReady=false, ytPending=null, poll=null;

  function fmt(s){s=Math.max(0,Math.floor(s||0));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0");}
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(m){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[m];});}
  function decode(s){var t=document.createElement("textarea");t.innerHTML=String(s||"");return t.value;}

  /* ── YouTube IFrame API ───────────────────────────────── */
  window.onYouTubeIframeAPIReady=function(){
    yt=new YT.Player("ytplayer",{height:"54",width:"96",playerVars:{controls:0,disablekb:1,modestbranding:1,rel:0,playsinline:1},
      events:{onReady:function(){ytReady=true; if(ytPending){var p=ytPending;ytPending=null;ytLoad(p);}},
        onStateChange:function(e){
          if(e.data===YT.PlayerState.PLAYING){$("playBtn").textContent="⏸"; startPoll();}
          else if(e.data===YT.PlayerState.PAUSED){$("playBtn").textContent="▶";}
          else if(e.data===YT.PlayerState.ENDED){ if(repeat){yt.seekTo(0);yt.playVideo();} else next(); }
        }}});
  };
  function loadYTApi(){
    if(window.YT&&window.YT.Player){
      window.onYouTubeIframeAPIReady();
      return;
    }
    if(document.getElementById("milan-youtube-api")) return;

    var s=document.createElement("script");
    s.id="milan-youtube-api";
    s.src="https://www.youtube.com/iframe_api";
    s.async=true;
    document.head.appendChild(s);
  }
  function ytLoad(id){ if(!ytReady){ytPending=id;return;} yt.loadVideoById(id); yt.setVolume(parseInt($("vol").value,10)); }
  function startPoll(){ clearInterval(poll); poll=setInterval(function(){
      if(engine!=="youtube"||!yt||!yt.getDuration)return; var d=yt.getDuration(),c=yt.getCurrentTime();
      if(d){ $("fill").style.width=(c/d*100)+"%"; $("dot").style.left=(c/d*100)+"%"; $("cur").textContent=fmt(c); $("dur").textContent=fmt(d); }
    },500); }

  /* ── Audius ───────────────────────────────────────────── */
  function audiusPick(){
    if(audiusHost)return Promise.resolve(audiusHost);

    // Prefer the known fast discovery provider. If it fails,
    // move through the configured Audius providers.
    var hosts=AUDIUS_HOSTS.slice();

    function tryHost(i){
      if(i>=hosts.length){
        audiusHost=AUDIUS_HOSTS[0];
        return Promise.resolve(audiusHost);
      }

      return fetch(hosts[i]+"/v1/tracks/trending?app_name="+APP,{cache:"no-store"})
        .then(function(r){
          if(!r.ok)throw 0;
          audiusHost=hosts[i];
          return audiusHost;
        })
        .catch(function(){
          return tryHost(i+1);
        });
    }

    return tryHost(0);
  }
  function audiusApi(path){ return audiusPick().then(function(h){var s=path.indexOf("?")>=0?"&":"?";
    return fetch(h+path+s+"app_name="+APP).then(function(r){if(!r.ok)throw 0;return r.json();});}); }
  function audiusArt(t){var a=t&&t.artwork;return(a&&(a["480x480"]||a["150x150"]))||"";}

  /* ── Rendering ────────────────────────────────────────── */
  function skel(n){var o="";for(var i=0;i<n;i++)o+='<div class="mz-skel"><div class="b" style="aspect-ratio:1/1;border-radius:12px;margin-bottom:10px"></div><div class="b" style="height:12px;width:80%;margin-bottom:7px"></div><div class="b" style="height:11px;width:55%"></div></div>';$("results").innerHTML=o;}
  function render(list){
    tracks=list||[];
    if(!tracks.length){$("results").innerHTML='<div class="mz-empty">No songs found. Try another search.</div>';return;}
    $("results").innerHTML=tracks.map(function(t,i){
      return '<div class="mz-card" data-i="'+i+'"><div class="mz-art">'+(t.thumb?'<img loading="lazy" src="'+esc(t.thumb)+'" alt="">':'')+
        '<button class="mz-play" aria-label="Play">▶</button></div>'+
        '<div class="mz-title">'+esc(t.title)+'</div><div class="mz-artist">'+esc(t.artist)+'</div></div>';
    }).join("");
    Array.prototype.forEach.call(document.querySelectorAll(".mz-card"),function(c){c.addEventListener("click",function(){play(parseInt(c.getAttribute("data-i"),10));});});
    mark();
  }
  function mark(){Array.prototype.forEach.call(document.querySelectorAll(".mz-card"),function(c){c.classList.toggle("playing",parseInt(c.getAttribute("data-i"),10)===idx);});}

  /* ── Unified playback ─────────────────────────────────── */
  function showEngineUI(){ $("ytwrap").style.display=engine==="youtube"?"block":"none"; $("thumb").style.display=engine==="youtube"?"none":"block"; }
  function stopYt(){ try{ if(yt&&yt.pauseVideo)yt.pauseVideo(); }catch(e){} }
  function play(i){
    if(i<0 || i>=tracks.length)return;

    idx=i;
    var t=tracks[i];

    $("npTitle").textContent=t.title||"";
    $("npArtist").textContent=t.artist||"";
    document.title=(t.title||"MILAN Music")+" · MILAN Music";

    mark();
    setMedia(t);

    // YouTube search results play through the YouTube IFrame.
    if(t.youtube){
      engine="youtube";
      showEngineUI();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();

      if($("npArt")){
        $("npArt").src=t.thumb||"/assets/milan-logo-circle.png";
      }

      loadYTApi();
      ytPending=t.id;

      if(ytReady){
        ytLoad(t.id);
      }

      return;
    }

    // Audius tracks continue through the HTML5 audio player.
    engine="audius";
    showEngineUI();
    stopYt();

    if($("npArt")){
      $("npArt").src=t.thumb||"/assets/milan-logo-circle.png";
    }

    if(t.duration){
      $("dur").textContent=fmt(t.duration);
    }

    var direct=t.stream||"";

    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    function trySource(url){
      return new Promise(function(resolve,reject){
        if(!url){
          reject(new Error("missing source"));
          return;
        }

        var settled=false;

        function cleanup(){
          audio.removeEventListener("playing",ok);
          audio.removeEventListener("error",fail);
        }

        function ok(){
          if(settled)return;
          settled=true;
          cleanup();
          resolve();
        }

        function fail(){
          if(settled)return;
          settled=true;
          cleanup();
          reject(new Error("audio error"));
        }

        audio.addEventListener("playing",ok,{once:true});
        audio.addEventListener("error",fail,{once:true});

        audio.src=url;
        audio.load();

        var p=audio.play();

        if(p && typeof p.catch==="function"){
          p.catch(function(){
            if(settled)return;
            settled=true;
            cleanup();
            reject(new Error("play rejected"));
          });
        }
      });
    }

    trySource(direct).catch(function(){
      var note=$("note");
      if(note){
        note.style.display="block";
        note.textContent="This track could not be played right now.";
      }
    });
  }
  // Audio proxy failed for a YouTube track -> fall back to the IFrame player.
  audio.addEventListener("error", function(){
    var t=tracks[idx];
    if(!t)return;

    if(engine==="audius" && t.stream){
      var proxy="/api/music/stream/"+encodeURIComponent(t.id);

      if(audio.src!==new URL(proxy,window.location.origin).href){
        audio.src=proxy;
        audio.load();
        audio.play().catch(function(){
          var note=$("note");
          if(note){
            note.style.display="block";
            note.textContent="Playback unavailable for this track.";
          }
        });
      }
    }
  });
  // Lock-screen / background controls. HTML5 audio (Audius) keeps playing when the phone
  // locks; YouTube embeds may pause on lock (mobile browser policy).
  function setMedia(t){
    if(!("mediaSession" in navigator))return;
    try{
      navigator.mediaSession.metadata=new MediaMetadata({title:t.title||"MILAN Music",artist:t.artist||"",album:"MILAN Music",
        artwork: t.thumb ? [{src:t.thumb,sizes:"480x480",type:"image/jpeg"},{src:t.thumb,sizes:"96x96",type:"image/jpeg"}] : [{src:"/assets/milan-logo-circle.png",sizes:"192x192",type:"image/png"}]});
      navigator.mediaSession.playbackState="playing";
    }catch(e){}
  }
  function isPlaying(){ return engine==="youtube" ? (yt&&yt.getPlayerState&&yt.getPlayerState()===1) : !audio.paused; }
  function toggle(){
    if(idx<0){ if(tracks.length)play(0); return; }
    if(engine==="youtube"){ if(!yt)return; isPlaying()?yt.pauseVideo():yt.playVideo(); }
    else { audio.paused?audio.play():audio.pause(); }
  }
  function next(){ if(!tracks.length)return; play(shuffle?Math.floor(Math.random()*tracks.length):(idx+1)%tracks.length); }
  function prev(){ if(!tracks.length)return; var c=engine==="youtube"?(yt&&yt.getCurrentTime?yt.getCurrentTime():0):audio.currentTime;
    if(c>3){ engine==="youtube"?yt.seekTo(0):audio.currentTime=0; return; } play((idx-1+tracks.length)%tracks.length); }

  audio.addEventListener("play",function(){$("playBtn").textContent="⏸"; if("mediaSession" in navigator)navigator.mediaSession.playbackState="playing";});
  audio.addEventListener("pause",function(){$("playBtn").textContent="▶"; if("mediaSession" in navigator)navigator.mediaSession.playbackState="paused";});
  audio.addEventListener("ended",function(){ if(repeat){audio.currentTime=0;audio.play();} else next(); });
  audio.addEventListener("loadedmetadata",function(){ if(isFinite(audio.duration))$("dur").textContent=fmt(audio.duration); });
  audio.addEventListener("timeupdate",function(){ if(seeking||!audio.duration||engine!=="audius")return;
    var p=audio.currentTime/audio.duration; $("fill").style.width=(p*100)+"%"; $("dot").style.left=(p*100)+"%"; $("cur").textContent=fmt(audio.currentTime);
    if("mediaSession" in navigator && navigator.mediaSession.setPositionState){ try{ navigator.mediaSession.setPositionState({duration:audio.duration,position:audio.currentTime,playbackRate:1}); }catch(e){} } });

  $("playBtn").onclick=toggle; $("nextBtn").onclick=next; $("prevBtn").onclick=prev;
  $("shuffleBtn").onclick=function(){shuffle=!shuffle;this.classList.toggle("on",shuffle);};
  $("repeatBtn").onclick=function(){repeat=!repeat;this.classList.toggle("on",repeat);};
  $("vol").oninput=function(){ var v=parseInt(this.value,10); audio.volume=v/100; if(yt&&yt.setVolume)yt.setVolume(v); };
  function seekEv(e){ var b=$("bar"),r=b.getBoundingClientRect(),x=((e.touches?e.touches[0].clientX:e.clientX)-r.left)/r.width; x=Math.min(1,Math.max(0,x));
    if(engine==="youtube"){ if(yt&&yt.getDuration){var d=yt.getDuration();yt.seekTo(x*d,true);} }
    else if(audio.duration){ audio.currentTime=x*audio.duration; }
    $("fill").style.width=(x*100)+"%"; $("dot").style.left=(x*100)+"%"; }
  $("bar").addEventListener("mousedown",function(e){seeking=true;seekEv(e);});
  document.addEventListener("mousemove",function(e){if(seeking)seekEv(e);},{passive:true});
  document.addEventListener("mouseup",function(){seeking=false;});
  $("bar").addEventListener("click",seekEv);
  document.addEventListener("keydown",function(e){
    if(e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)return;
    if(/input|textarea|select|button/i.test((e.target.tagName||"")))return;
    if(e.code==="Space"){e.preventDefault();toggle();} else if(e.key==="n")next(); else if(e.key==="p")prev(); });

  /* ── Search / browse ──────────────────────────────────── */
  function setTitle(t,info){ $("sectionTitle").innerHTML=esc(t)+' <small>'+(info||"")+'</small>'; }
  function ytSearch(q){
    var ck="mz_yt_"+q.toLowerCase().replace(/\s+/g," ").trim();

    try{
      var c=JSON.parse(localStorage.getItem(ck)||"null");
      if(c&&c.items&&Date.now()-c.at<21600000){
        render(c.items);
        return Promise.resolve();
      }
    }catch(e){}

    return withTimeout(
      fetch("/api/music/search?q="+encodeURIComponent(q),{
        credentials:"same-origin",
        cache:"no-store"
      }),
      2500
    )
    .then(function(r){
      return r.json().then(function(j){
        if(!r.ok) throw j;
        return j;
      });
    })
    .then(function(j){
      var items=(j.items||[]).map(function(it){
        return {
          id:it.id,
          title:decode(it.title),
          artist:decode(it.channel),
          thumb:it.thumb,
          youtube:false
        };
      });

      if(!items.length){
        throw new Error("No YouTube results");
      }

      render(items);

      try{
        localStorage.setItem(
          ck,
          JSON.stringify({
            at:Date.now(),
            items:items
          })
        );
      }catch(e){}
    });
  }
  function audiusSearch(q){ skel(12);
    return audiusApi("/v1/tracks/search?query="+encodeURIComponent(q))
      .then(function(j){
        engine="audius";

        var items=(j.data||[]).slice(0,30).map(function(t){
          return {
            id:t.id,
            title:t.title,
            artist:(t.user&&t.user.name)||"Unknown",
            thumb:audiusArt(t),
            duration:t.duration,
            stream:audiusHost+"/v1/tracks/"+t.id+"/stream?app_name="+APP
          };
        });

        render(items);

        if(!items.length){
          $("results").innerHTML='<div class="mz-empty">No songs found. Try another search.</div>';
        }

        return items;
      });
  }
  function audiusTrending(){ skel(12); setTitle("🔥 Trending","via Audius · decentralized");
    withTimeout(audiusApi("/v1/tracks/trending"),4000).then(function(j){
      render((j.data||[]).slice(0,24).map(function(t){return {id:t.id,title:t.title,artist:(t.user&&t.user.name)||"Unknown",thumb:audiusArt(t),duration:t.duration,stream:audiusHost+"/v1/tracks/"+t.id+"/stream?app_name="+APP};}));
    }).catch(function(){$("results").innerHTML='<div class="mz-empty">Could not reach music network.</div>';});
  }
  var searchT, ytAvailable=false;
  function doSearch(q){
    clearTimeout(searchT);
    q=(q||"").trim();

    if(!q){
      audiusTrending();
      return;
    }

    searchT=setTimeout(function(){
      runSearch(q);
    },180);
  }
  /* ── Real-YouTube-style autocomplete (free suggestions, no quota) ── */

  var sugT;
  var sugItems=[];
  var sugIdx=-1;

  function hideSug(){
    var box=$("mzsug");
    if(!box)return;
    box.classList.remove("show");
    box.innerHTML="";
    sugItems=[];
    sugIdx=-1;
  }

  function escSug(v){
    return String(v||"")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

  function renderSug(list){
    var box=$("mzsug");
    if(!box)return;

    sugItems=Array.isArray(list)
      ? list.filter(function(x){
          return typeof x==="string" && x.trim();
        }).slice(0,10)
      : [];

    sugIdx=-1;

    if(!sugItems.length){
      hideSug();
      return;
    }

    box.innerHTML=sugItems.map(function(item,i){
      return '<button type="button" class="mz-sug-item" data-sug-index="'+i+'">' +
        '<span class="si">⌕</span>' +
        '<span>'+escSug(item)+'</span>' +
      '</button>';
    }).join("");

    box.classList.add("show");

    var buttons=box.querySelectorAll(".mz-sug-item");

    for(var i=0;i<buttons.length;i++){
      buttons[i].addEventListener("click",function(e){
        var idx=Number(e.currentTarget.getAttribute("data-sug-index"));
        pickSug(idx);
      });
    }
  }

  function hlSug(){
    var box=$("mzsug");
    if(!box)return;

    var buttons=box.querySelectorAll(".mz-sug-item");

    for(var i=0;i<buttons.length;i++){
      buttons[i].classList.toggle("active",i===sugIdx);
    }

    if(sugIdx>=0 && sugItems[sugIdx]){
      $("q").value=sugItems[sugIdx];
    }
  }

  function pickSug(i){
    if(i<0 || i>=sugItems.length)return;

    var value=sugItems[i];

    $("q").value=value;
    hideSug();

    // Selecting a YouTube suggestion should immediately perform
    // the real search for that exact phrase.
    runSearch(value);
  }

  function fetchSug(q){
    clearTimeout(sugT);

    q=(q||"").trim();

    if(q.length<2){
      hideSug();
      return;
    }

    sugT=setTimeout(function(){

      fetch("/api/music/suggest?q="+encodeURIComponent(q),{
        credentials:"same-origin",
        cache:"no-store"
      })
      .then(function(r){
        if(!r.ok)throw new Error("autocomplete http "+r.status);
        return r.json();
      })
      .then(function(j){
        if(document.activeElement===$("q")){
          renderSug(j.suggestions||[]);
        }
      })
      .catch(function(){
        hideSug();
      });

    },180);
  }

  $("q").addEventListener("input",function(){
    fetchSug(this.value);
  });

  $("q").addEventListener("keydown",function(e){
    if(!sugItems.length)return;

    if(e.key==="ArrowDown"){
      e.preventDefault();
      sugIdx=Math.min(sugItems.length-1,sugIdx+1);
      hlSug();
    }
    else if(e.key==="ArrowUp"){
      e.preventDefault();
      sugIdx=Math.max(0,sugIdx-1);
      hlSug();
    }
    else if(e.key==="Escape"){
      hideSug();
    }
    else if(e.key==="Enter"){
      e.preventDefault();

      if(sugIdx>=0 && sugItems[sugIdx]){
        pickSug(sugIdx);
      }else{
        hideSug();
        runSearch(this.value);
      }
    }
  });

  document.addEventListener("click",function(e){
    var box=$("mzsug");
    var search=e.target.closest(".mz-search");
    if(box && !search){
      hideSug();
    }
  });

  function runSearch(q){
    q=(q||"").trim();

    if(!q){
      audiusTrending();
      return;
    }

    setTitle('🔎 "'+q+'"',"via Audius");
    audiusSearch(q).catch(function(){
      $("results").innerHTML='<div class="mz-empty">No songs found. Try another search.</div>';
    });
  }

})();

/* ── MILAN Music live visualizer ─────────────────────────── */
(function(){
  var barsBox = document.querySelector(".hero-bars");
  if(!barsBox) return;

  var bars = Array.prototype.slice.call(
    barsBox.querySelectorAll("i")
  );

  var audio = document.getElementById("audio");
  if(!bars.length) return;

  function paintIdle(){
    barsBox.classList.remove("visualizer-active");
    barsBox.classList.add("visualizer-idle");

    bars.forEach(function(bar,i){
      var h = 6 + ((i * 3) % 5);
      bar.style.height = h + "px";
      bar.style.transform = "scaleY(.7)";
    });
  }

  function paintLive(time){
    var active = audio && !audio.paused && !audio.ended;

    if(!active){
      paintIdle();
      requestAnimationFrame(paintLive);
      return;
    }

    barsBox.classList.remove("visualizer-idle");
    barsBox.classList.add("visualizer-active");

    bars.forEach(function(bar,i){
      var wave1 = Math.abs(Math.sin(time * 0.006 + i * 0.72));
      var wave2 = Math.abs(Math.sin(time * 0.011 - i * 0.38));
      var wave3 = Math.abs(Math.cos(time * 0.0035 + i * 1.17));

      var energy =
        (wave1 * 0.45) +
        (wave2 * 0.35) +
        (wave3 * 0.20);

      var height = 8 + Math.round(energy * 34);

      bar.style.height = height + "px";
      bar.style.transform =
        "scaleY(" + (0.72 + energy * 0.55).toFixed(2) + ")";
    });

    requestAnimationFrame(paintLive);
  }

  if(audio){
    audio.addEventListener("play", function(){
      barsBox.classList.remove("visualizer-idle");
      barsBox.classList.add("visualizer-active");
    });

    audio.addEventListener("pause", paintIdle);
    audio.addEventListener("ended", paintIdle);
  }

  paintIdle();
  requestAnimationFrame(paintLive);
})();
