const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// MILAN V49: reliable universal mobile video playback layer.
// Browser engines cannot decode every video container/codec. V49 probes the upload first:
// - already-safe H.264/AAC MP4 => fast remux with +faststart, then play immediately
// - unsupported MOV/MKV/AVI/3GP/HEVC/etc => transcode to MP4 H.264/AAC
// - all other files remain uploadable with Open/Download fallback
const BROWSER_SAFE_MEDIA = new Set([
  'image/jpeg','image/png','image/webp','image/gif','image/svg+xml','image/bmp','image/x-icon',
  'video/mp4','video/webm','video/ogg','video/quicktime','video/x-matroska','video/x-msvideo','video/3gpp','video/3gpp2','video/mpeg','video/mp2t','video/x-ms-wmv','video/x-flv',
  'audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/webm','audio/mp4','audio/aac','audio/flac',
  'application/pdf','text/plain','text/csv','application/json','text/html','text/markdown'
]);

const VIDEO_EXTS = new Set(['.mp4','.m4v','.mov','.qt','.webm','.ogv','.mkv','.avi','.wmv','.flv','.3gp','.3g2','.mpeg','.mpg','.mts','.m2ts','.ts']);
const AUDIO_EXTS = new Set(['.mp3','.wav','.ogg','.oga','.m4a','.aac','.flac','.webm']);
const IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.webp','.gif','.svg','.bmp','.ico']);

function fileSize(filePath) { try { return fs.statSync(filePath).size; } catch (_) { return 0; } }
function extOf(value = '') { return path.extname(String(value || '')).toLowerCase(); }
function safeUploadName(value = 'milan-video') { return String(value || 'milan-video').replace(/[\\/\r\n]/g, '_'); }
function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function mimeByExt(ext) {
  const map = {
    '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.bmp':'image/bmp','.ico':'image/x-icon',
    '.mp4':'video/mp4','.m4v':'video/mp4','.mov':'video/quicktime','.qt':'video/quicktime','.webm':'video/webm','.ogv':'video/ogg','.mkv':'video/x-matroska','.avi':'video/x-msvideo','.wmv':'video/x-ms-wmv','.flv':'video/x-flv','.3gp':'video/3gpp','.3g2':'video/3gpp2','.mpeg':'video/mpeg','.mpg':'video/mpeg','.mts':'video/mp2t','.m2ts':'video/mp2t','.ts':'video/mp2t',
    '.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.oga':'audio/ogg','.m4a':'audio/mp4','.aac':'audio/aac','.flac':'audio/flac',
    '.pdf':'application/pdf','.txt':'text/plain','.csv':'text/csv','.json':'application/json','.html':'text/html','.htm':'text/html','.md':'text/markdown',
    '.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xls':'application/vnd.ms-excel','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.ppt':'application/vnd.ms-powerpoint','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.zip':'application/zip','.rar':'application/vnd.rar','.7z':'application/x-7z-compressed'
  };
  return map[ext] || '';
}

function detectMimeFromFile(filePath, originalName = '') {
  const ext = extOf(originalName || filePath);
  let buf = Buffer.alloc(0);
  try {
    const fd = fs.openSync(filePath, 'r');
    buf = Buffer.alloc(512);
    const n = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    buf = buf.slice(0, n);
  } catch (_) {}
  const ascii = buf.toString('latin1');
  if (buf.length >= 12 && ascii.slice(4, 8) === 'ftyp') {
    const brand = ascii.slice(8, 24).replace(/\0/g, '').trim().toLowerCase();
    if (['.m4a', '.aac'].includes(ext)) return { mimeType: 'audio/mp4', source: 'signature', brand };
    if (brand.includes('qt') || ext === '.mov') return { mimeType: 'video/quicktime', source: 'signature', brand };
    return { mimeType: 'video/mp4', source: 'signature', brand };
  }
  if (buf.slice(0, 3).toString('hex') === 'ffd8ff') return { mimeType: 'image/jpeg', source: 'signature' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return { mimeType: 'image/png', source: 'signature' };
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return { mimeType: 'image/gif', source: 'signature' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return { mimeType: 'image/webp', source: 'signature' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return { mimeType: 'audio/wav', source: 'signature' };
  if (ascii.startsWith('OggS')) return { mimeType: ext === '.ogv' ? 'video/ogg' : 'audio/ogg', source: 'signature' };
  if (ascii.startsWith('ID3') || (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { mimeType: 'audio/mpeg', source: 'signature' };
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mimeType: ext === '.mka' ? 'audio/webm' : 'video/webm', source: 'signature' };
  if (buf.slice(0, 4).toString('latin1') === '%PDF') return { mimeType: 'application/pdf', source: 'signature' };
  if (buf.slice(0, 2).toString('hex') === '504b') return { mimeType: mimeByExt(ext) || 'application/zip', source: 'signature' };
  const extMime = mimeByExt(ext);
  if (extMime) return { mimeType: extMime, source: 'extension' };
  return { mimeType: '', source: 'unknown' };
}

function extForMime(mimeType, fallback = '.bin') {
  const map = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/bmp': '.bmp', 'image/x-icon': '.ico',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv', 'video/quicktime': '.mov', 'video/x-matroska': '.mkv', 'video/x-msvideo': '.avi', 'video/3gpp': '.3gp', 'video/3gpp2': '.3g2', 'video/mpeg': '.mpg', 'video/mp2t': '.ts', 'video/x-ms-wmv': '.wmv', 'video/x-flv': '.flv',
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/ogg': '.ogg', 'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac',
    'application/pdf': '.pdf', 'text/plain': '.txt', 'text/csv': '.csv', 'application/json': '.json', 'text/html': '.html', 'text/markdown': '.md', 'application/zip': '.zip'
  };
  return map[String(mimeType || '').toLowerCase()] || fallback;
}

function categoryForMime(mimeType = '', fileName = '') {
  const mime = String(mimeType || '').toLowerCase();
  const ext = extOf(fileName);
  if (mime.startsWith('image/') || IMAGE_EXTS.has(ext)) return 'image';
  if (mime.startsWith('video/') || VIDEO_EXTS.has(ext)) return 'video';
  if (mime.startsWith('audio/') || AUDIO_EXTS.has(ext)) return 'audio';
  if (mime === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (mime.startsWith('text/') || ['.txt','.csv','.json','.md','.html','.htm'].includes(ext)) return 'text';
  return 'file';
}

function hasCommand(cmd, args = ['-version']) {
  try { const probe = spawnSync(cmd, args, { stdio: 'ignore' }); return probe.status === 0; } catch (_) { return false; }
}
function findFfmpeg() {
  const explicit = String(process.env.FFMPEG_PATH || '').trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  try { const staticPath = require('ffmpeg-static'); if (staticPath && fs.existsSync(staticPath)) return staticPath; } catch (_) {}
  if (hasCommand('ffmpeg')) return 'ffmpeg';
  return '';
}
function findFfprobe() {
  const explicit = String(process.env.FFPROBE_PATH || '').trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  try { const probePkg = require('ffprobe-static'); const probePath = probePkg && (probePkg.path || probePkg); if (probePath && fs.existsSync(probePath)) return probePath; } catch (_) {}
  if (hasCommand('ffprobe')) return 'ffprobe';
  return '';
}

function runProcess(command, args, timeoutMs, captureStdout = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'] });
    let outText = '', errText = '', done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      reject(new Error(`${path.basename(command)} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (child.stdout) child.stdout.on('data', d => { outText += d.toString(); if (outText.length > 250000) outText = outText.slice(-250000); });
    child.stderr.on('data', d => { errText += d.toString(); if (errText.length > 16000) errText = errText.slice(-16000); });
    child.on('error', err => { if (done) return; done = true; clearTimeout(timer); reject(err); });
    child.on('close', code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: outText, stderr: errText });
      else reject(new Error(errText.trim() || `${path.basename(command)} exited with ${code}`));
    });
  });
}

async function probeMedia(filePath) {
  const ffprobe = findFfprobe();
  if (!ffprobe) return { ok: false, warning: 'ffprobe-not-available', streams: [] };
  try {
    const result = await runProcess(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath], Number(process.env.MILAN_FFPROBE_TIMEOUT_MS || 8000), true);
    const json = JSON.parse(result.stdout || '{}');
    return { ok: true, streams: Array.isArray(json.streams) ? json.streams : [], format: json.format || {} };
  } catch (err) {
    return { ok: false, warning: `ffprobe-failed: ${err.message}`, streams: [] };
  }
}

function videoIsBrowserSafe(probe = {}) {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find(s => s.codec_type === 'video');
  if (!video) return { safe: false, reason: 'no-video-stream' };
  const audio = streams.find(s => s.codec_type === 'audio');
  const vcodec = String(video.codec_name || '').toLowerCase();
  const acodec = String(audio?.codec_name || '').toLowerCase();
  const pixFmt = String(video.pix_fmt || '').toLowerCase();
  const colorSpace = String(video.color_space || '').toLowerCase();
  const colorTransfer = String(video.color_transfer || '').toLowerCase();
  const colorPrimaries = String(video.color_primaries || '').toLowerCase();
  const safeVideo = vcodec === 'h264' || vcodec === 'avc1';
  const safeAudio = !audio || acodec === 'aac' || acodec === 'mp3' || acodec === 'mp4a';
  const safePix = !pixFmt || pixFmt === 'yuv420p' || pixFmt === 'yuvj420p';
  // V56 hard fix: do NOT reject normal WhatsApp/phone MP4s only because ffprobe
  // reports old SD color metadata like bt470bg/smpte170m. That was forcing an
  // unnecessary full transcode for perfectly normal H.264/AAC/yuv420p MP4 files,
  // and on mobile it could leave posts in "preview is preparing".
  // If codecs/pixel format are browser-safe, stream-copy/remux with +faststart and
  // h264_metadata will rewrite color tags to bt709 in under a second.
  if (safeVideo && safeAudio && safePix) {
    return { safe: true, reason: 'h264-aac-compatible', videoCodec: vcodec, audioCodec: acodec, pixFmt, colorSpace, colorTransfer, colorPrimaries };
  }
  return { safe: false, reason: `video=${vcodec || 'unknown'},audio=${acodec || 'none'},pix=${pixFmt || 'unknown'},color=${colorSpace || 'unknown'}`, videoCodec: vcodec, audioCodec: acodec, pixFmt, colorSpace, colorTransfer, colorPrimaries };
}

async function tryFfmpegCopyFaststart(ffmpeg, filePath, outPath, timeoutMs) {
  // First try stream-copy with safe H.264 color metadata. Some ffmpeg builds/devices reject
  // the bitstream filter, so fall back to a plain faststart copy before doing a full transcode.
  const withMetadataArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath,
    '-map', '0', '-c', 'copy',
    '-movflags', '+faststart',
    '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
    outPath];
  try {
    await runProcess(ffmpeg, withMetadataArgs, timeoutMs, false);
    if (fs.existsSync(outPath) && fileSize(outPath) > 0) return true;
  } catch (_) {
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
  }
  const plainArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath,
    '-map', '0', '-c', 'copy', '-movflags', '+faststart', outPath];
  await runProcess(ffmpeg, plainArgs, timeoutMs, false);
  return fs.existsSync(outPath) && fileSize(outPath) > 0;
}

async function tryFfmpegTranscode(ffmpeg, filePath, outPath, timeoutMs) {
  const maxWidth = Number(process.env.MILAN_TRANSCODE_MAX_WIDTH || 1280);
  const scale = Number.isFinite(maxWidth) && maxWidth > 0
    ? `scale='min(${maxWidth},trunc(iw/2)*2)':-2,setsar=1`
    : `scale='trunc(iw/2)*2':-2,setsar=1`;
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-fflags', '+genpts+discardcorrupt',
    '-err_detect', 'ignore_err',
    '-i', filePath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-sn', '-dn',
    '-vf', scale,
    '-c:v', 'libx264',
    '-preset', process.env.MILAN_TRANSCODE_PRESET || 'veryfast',
    '-crf', process.env.MILAN_TRANSCODE_CRF || '25',
    '-profile:v', 'baseline',
    '-level', process.env.MILAN_TRANSCODE_LEVEL || '3.1',
    '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709',
    '-color_trc', 'bt709',
    '-color_primaries', 'bt709',
    '-tag:v', 'avc1',
    '-video_track_timescale', '90000',
    '-c:a', 'aac',
    '-b:a', process.env.MILAN_TRANSCODE_AUDIO_BITRATE || '128k',
    '-ac', '2',
    '-ar', '44100',
    '-movflags', '+faststart',
    '-max_muxing_queue_size', '9999',
    outPath
  ];
  await runProcess(ffmpeg, args, timeoutMs, false);
  return fs.existsSync(outPath) && fileSize(outPath) > 0;
}

async function normalizeUploadedMedia({ filePath, mimeType = '', originalName = '', force = false } = {}) {
  const detected = detectMimeFromFile(filePath, originalName);
  const ext = extOf(originalName || filePath);
  let finalMime = String(mimeType || '').split(';')[0].toLowerCase();
  if (!finalMime || finalMime === 'application/octet-stream' || finalMime === 'binary/octet-stream') finalMime = detected.mimeType || mimeByExt(ext) || 'application/octet-stream';
  if (detected.mimeType && (finalMime === 'application/octet-stream' || finalMime === 'video/quicktime')) finalMime = detected.mimeType;
  if (finalMime === 'audio/mp3') finalMime = 'audio/mpeg';
  const previewCategory = categoryForMime(finalMime, originalName || filePath);
  const isMp4OrWebm = finalMime === 'video/mp4' || finalMime === 'video/webm' || finalMime === 'video/ogg' || ['.mp4','.m4v','.webm','.ogv'].includes(extOf(originalName||filePath));
  const initial = { filePath, mimeType: finalMime, originalName, detected, previewCategory, changed: false, remuxed: false, transcoded: false, ffmpegUsed: false, browserPlayable: previewCategory !== 'video', warning: '', probe: null, compatibility: null };
  if (!filePath || !fs.existsSync(filePath)) return { ...initial, warning: 'file-missing', browserPlayable: false };
  if (previewCategory !== 'video') return initial;

  const mode = String(process.env.MILAN_TRANSCODE_VIDEO || 'true').toLowerCase();
  const size = fileSize(filePath);
  const maxNormalizeBytes = Number(process.env.MILAN_MAX_TRANSCODE_BYTES || 1024 * 1024 * 1024);
  if (size <= 0 || size > maxNormalizeBytes) return { ...initial, warning: size > maxNormalizeBytes ? 'video-too-large-for-server-normalize' : 'empty-video-file', browserPlayable: false };

  const probe = await probeMedia(filePath);
  const safe = probe.ok ? videoIsBrowserSafe(probe) : { safe: false, reason: probe.warning || 'unprobed-video' };
  const isMp4Container = finalMime === 'video/mp4' || detected.mimeType === 'video/mp4' || ['.mp4', '.m4v'].includes(ext);
  const ffmpeg = findFfmpeg();
  const forceTranscode = !!force || envFlag('MILAN_FORCE_UPLOAD_TRANSCODE', false);

  if (mode === 'false' || mode === 'off' || mode === '0') {
    return { ...initial, probe, compatibility: safe, browserPlayable: !!(safe.safe && isMp4Container), warning: safe.safe ? '' : 'video-normalize-disabled' };
  }

  const base = path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}.browser-safe.${Date.now()}`);
  const copyPath = `${base}.mp4`;
  const transcodePath = `${base}.transcoded.mp4`;
  const timeoutMs = Number(process.env.MILAN_TRANSCODE_TIMEOUT_MS || 300000);

  if (!ffmpeg) {
    const playableWithoutConvert = !!(safe.safe && isMp4Container);
    return {
      ...initial,
      mimeType: playableWithoutConvert ? 'video/mp4' : finalMime,
      originalName: playableWithoutConvert ? safeUploadName(originalName || 'milan-video').replace(/\.[^.]*$/, '') + '.mp4' : safeUploadName(originalName || 'milan-video'),
      warning: playableWithoutConvert ? 'ffmpeg-not-available-safe-mp4-preview-attempted' : 'video-conversion-not-available-on-server-original-file-saved-download-available',
      probe,
      compatibility: safe,
      browserPlayable: playableWithoutConvert
    };
  }

  if (safe.safe && isMp4Container && !forceTranscode) {
    try {
      if (await tryFfmpegCopyFaststart(ffmpeg, filePath, copyPath, Math.min(timeoutMs, 90000))) {
        return { filePath: copyPath, mimeType: 'video/mp4', originalName: safeUploadName(originalName || 'milan-video').replace(/\.[^.]*$/, '') + '.mp4', detected, previewCategory: 'video', changed: true, remuxed: true, transcoded: false, ffmpegUsed: true, browserPlayable: true, warning: '', probe, compatibility: safe };
      }
    } catch (err) {
      try { if (fs.existsSync(copyPath)) fs.unlinkSync(copyPath); } catch (_) {}
      // Do not mark a video as playable when faststart/remux failed. Fall through to
      // transcode so the app serves a known-good H.264/AAC MP4 instead of a 0:00 player.
    }
  }

  try {
    if (await tryFfmpegTranscode(ffmpeg, filePath, transcodePath, timeoutMs)) {
      return { filePath: transcodePath, mimeType: 'video/mp4', originalName: safeUploadName(originalName || 'milan-video').replace(/\.[^.]*$/, '') + '.mp4', detected, previewCategory: 'video', changed: true, remuxed: false, transcoded: true, ffmpegUsed: true, browserPlayable: true, warning: '', probe, compatibility: safe };
    }
  } catch (err) {
    try { if (fs.existsSync(transcodePath)) fs.unlinkSync(transcodePath); } catch (_) {}
    if (safe.safe && isMp4Container) {
      try {
        if (await tryFfmpegCopyFaststart(ffmpeg, filePath, copyPath, Math.min(timeoutMs, 90000))) {
          return { filePath: copyPath, mimeType: 'video/mp4', originalName: safeUploadName(originalName || 'milan-video').replace(/\.[^.]*$/, '') + '.mp4', detected, previewCategory: 'video', changed: true, remuxed: true, transcoded: false, ffmpegUsed: true, browserPlayable: true, warning: '', probe, compatibility: safe };
        }
      } catch (_) { try { if (fs.existsSync(copyPath)) fs.unlinkSync(copyPath); } catch (__) {} }
      return { ...initial, mimeType: 'video/mp4', originalName: safeUploadName(originalName || 'milan-video').replace(/\.[^.]*$/, '') + '.mp4', warning: 'video-faststart-remux-failed-processing-required', probe, compatibility: safe, browserPlayable: false };
    }
    return { ...initial, warning: `video-transcode-failed-original-saved: ${err.message}`, probe, compatibility: safe, browserPlayable: false };
  }

  return { ...initial, probe, compatibility: safe, browserPlayable: false, warning: safe.safe && isMp4Container ? 'video-normalize-did-not-produce-preview' : (safe.reason || 'video-not-browser-safe') };
}

module.exports = { BROWSER_SAFE_MEDIA, VIDEO_EXTS, AUDIO_EXTS, IMAGE_EXTS, detectMimeFromFile, extForMime, categoryForMime, normalizeUploadedMedia, findFfmpeg, findFfprobe, probeMedia, videoIsBrowserSafe };
