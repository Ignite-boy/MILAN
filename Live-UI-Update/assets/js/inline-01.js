// JSON.parse crash fix
(function(){
  const origParse = JSON.parse;
  JSON.parse = function(text) {
    if(!text || text === "" || text === "undefined") {
      console.warn("Blocked empty JSON.parse");
      return null;
    }
    try { return origParse(text); }
    catch(e) { console.warn("JSON parse fail:", text.substring(0,50)); return null; }
  };

  // Safe get user
  window.getMilanUser = () => {
    try {
      const u = localStorage.getItem('milan_user');
      return u ? origParse(u) : null;
    } catch(e) { return null; }
  };
})();
