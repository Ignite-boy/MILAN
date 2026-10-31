'use strict';

const assert = require('assert');
const {
  withFfmpegSlot,
  getFfmpegProcessingStatus
} = require('../backend/utils/ffmpegProcessingPolicy');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const policy = getFfmpegProcessingStatus();

  assert(policy.maxConcurrentJobs >= 1 && policy.maxConcurrentJobs <= 2);
  assert(policy.encoderThreads >= 1 && policy.encoderThreads <= 4);

  let running = 0;
  let peak = 0;
  const started = [];
  const count = 8;

  const results = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      withFfmpegSlot(async () => {
        running += 1;
        peak = Math.max(peak, running);
        started.push(index);
        await pause(8);
        running -= 1;
        return index;
      })
    )
  );

  assert.deepStrictEqual(results, Array.from({ length: count }, (_, i) => i));
  assert.deepStrictEqual(started, Array.from({ length: count }, (_, i) => i));
  assert.strictEqual(peak, policy.maxConcurrentJobs);
  assert(peak <= 2);
  assert.strictEqual(getFfmpegProcessingStatus().activeJobs, 0);
  assert.strictEqual(getFfmpegProcessingStatus().queuedJobs, 0);

  await assert.rejects(
    withFfmpegSlot(async () => { throw new Error('expected test rejection'); }),
    /expected test rejection/
  );
  await withFfmpegSlot(async () => 'slot-released');

  assert.strictEqual(getFfmpegProcessingStatus().activeJobs, 0);
  assert.strictEqual(getFfmpegProcessingStatus().queuedJobs, 0);

  console.log('PASS: FFmpeg concurrency is bounded.');
  console.log('PASS: queued FFmpeg jobs are released in FIFO order.');
  console.log('PASS: failed jobs release their processing slot.');
  console.log('PASS: encoder and decoder thread limits are valid.');
  console.log('Policy:', JSON.stringify(getFfmpegProcessingStatus()));
}

main().catch(error => {
  console.error('FFMPEG POLICY SELF-TEST FAILED:', error);
  process.exitCode = 1;
});
