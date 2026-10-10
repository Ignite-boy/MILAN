/* MILAN Image Worker (V7.1)
 * Runs OFF the main thread. Downscales + compresses an image File/Blob using
 * OffscreenCanvas so the UI never freezes while a profile picture or preview
 * is being prepared. Falls back gracefully on the main thread if the browser
 * lacks OffscreenCanvas (handled by the caller, not here).
 *
 * Message in : { id, blob, maxDim, quality, mime }
 * Message out: { id, ok, dataUrl, width, height, bytes }  OR  { id, ok:false, error }
 */
'use strict';

self.onmessage = async function (e) {
  const { id, blob, maxDim = 512, quality = 0.82, mime = 'image/jpeg' } = e.data || {};
  try {
    if (!blob) throw new Error('No image provided');
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
      throw new Error('OffscreenCanvas unsupported');
    }

    const bitmap = await createImageBitmap(blob);
    let { width, height } = bitmap;

    // Scale down so the longest side <= maxDim (never upscale).
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const outW = Math.max(1, Math.round(width * scale));
    const outH = Math.max(1, Math.round(height * scale));

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, outW, outH);
    bitmap.close && bitmap.close();

    const outBlob = await canvas.convertToBlob({ type: mime, quality });
    const buf = await outBlob.arrayBuffer();
    const dataUrl = mime + ';base64,' + base64FromBuffer(buf);

    self.postMessage({
      id,
      ok: true,
      dataUrl: 'data:' + dataUrl,
      width: outW,
      height: outH,
      bytes: outBlob.size
    });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || 'compress failed' });
  }
};

function base64FromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return self.btoa(binary);
}
