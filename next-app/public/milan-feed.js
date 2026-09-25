/* MILAN V7.2 — Facebook-style composer: collapsed by default, expand on focus.
   App page only. Additive — never touches existing post/publish handlers. */
(function () {
  "use strict";
  if (!/\/app(\.html)?$/.test(location.pathname)) return;
  function ready(fn){ if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",fn); else fn(); }
  ready(function () {
    var comp = document.querySelector(".composer");
    if (!comp) return;
    var txt = document.getElementById("postText");
    function expand(){ comp.classList.add("composer-expanded"); }
    if (txt) txt.addEventListener("focus", expand);
    comp.addEventListener("click", function (e) {
      // expand when the slim bar / avatar / input area is tapped
      if (!comp.classList.contains("composer-expanded")) { expand(); if (txt) txt.focus(); }
    });
  });
})();
