'use strict';

const os = require('os');

const CPU_COUNT = (() => {
  const detected = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  return Number.isSafeInteger(detected) && detected > 0 ? detected : 1;
})();

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// Keep one heavy FFmpeg job by default. An explicit environment override may
// raise this to two, but never beyond the detected CPU-safe ceiling.
const HARD_CONCURRENCY_CAP = Math.max(1, Math.min(2, CPU_COUNT - 1));
const REQUESTED_CONCURRENCY = positiveInteger(
  process.env.MILAN_FFMPEG_CONCURRENCY,
  1
);
const MAX_CONCURRENT_JOBS = Math.min(HARD_CONCURRENCY_CAP, REQUESTED_CONCURRENCY);

// Reserve CPU capacity for the Node service and database work.
const MAX_ENCODER_THREADS = Math.max(1, Math.min(4, CPU_COUNT - 1));
const DEFAULT_ENCODER_THREADS = Math.max(1, Math.min(2, CPU_COUNT - 1));
const FFMPEG_ENCODER_THREADS = Math.min(
  MAX_ENCODER_THREADS,
  positiveInteger(process.env.MILAN_TRANSCODE_THREADS, DEFAULT_ENCODER_THREADS)
);

let activeJobs = 0;
const waiters = [];

function acquireSlot() {
  return new Promise(resolve => {
    const release = () => {
      const next = waiters.shift();
      if (next) {
        next(release);
      } else {
        activeJobs -= 1;
      }
    };

    if (activeJobs < MAX_CONCURRENT_JOBS) {
      activeJobs += 1;
      resolve(release);
    } else {
      waiters.push(resolve);
    }
  });
}

async function withFfmpegSlot(task) {
  if (typeof task !== 'function') {
    throw new TypeError('FFmpeg slot requires a task function.');
  }

  const release = await acquireSlot();
  try {
    return await task();
  } finally {
    release();
  }
}

function getFfmpegProcessingStatus() {
  return {
    cpuCount: CPU_COUNT,
    maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    activeJobs,
    queuedJobs: waiters.length,
    encoderThreads: FFMPEG_ENCODER_THREADS
  };
}

module.exports = {
  withFfmpegSlot,
  getFfmpegProcessingStatus,
  FFMPEG_ENCODER_THREADS
};
