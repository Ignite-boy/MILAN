/* MILAN — heavy-JSON Web Worker.
   Runs the app's expensive JSON work (feed diffing, boot-cache packing) off
   the main thread so scrolling/typing never stutters while data refreshes.
   Protocol: { id, type:'feedDiff'|'pack', ... } -> { id, changed?|json?|error? } */
self.onmessage = function (e) {
  var d = e.data || {};
  try {
    if (d.type === 'feedDiff') {
      self.postMessage({ id: d.id, changed: JSON.stringify(d.fresh) !== JSON.stringify(d.prev) });
    } else if (d.type === 'pack') {
      self.postMessage({ id: d.id, json: JSON.stringify(d.value) });
    } else {
      self.postMessage({ id: d.id, error: 'unknown op' });
    }
  } catch (err) {
    self.postMessage({ id: d.id, error: String(err && err.message || err) });
  }
};
