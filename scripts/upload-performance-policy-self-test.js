'use strict';

const assert = require('node:assert/strict');
const { getVideoUploadConcurrency } = require('../frontend/assets/js/milan-upload-policy.js');

const fast = {
    connection: { effectiveType: '4g', downlink: 10, rtt: 60 },
    deviceMemory: 8,
    hardwareConcurrency: 8
};

const cases = [
    ['fast connection uses at most three chunks', 3, 10, fast],
    ['2G uses one upload chunk', 1, 10, {
        ...fast, connection: { effectiveType: '2g', downlink: 0.2, rtt: 900 }
    }],
    ['Data Saver uses one upload chunk', 1, 10, {
        ...fast, connection: { effectiveType: '4g', saveData: true }
    }],
    ['3G uses two upload chunks', 2, 10, {
        ...fast, connection: { effectiveType: '3g', downlink: 1, rtt: 300 }
    }],
    ['high latency uses two upload chunks', 2, 10, {
        ...fast, connection: { effectiveType: '4g', downlink: 4, rtt: 700 }
    }],
    ['low-memory devices use at most two chunks', 2, 10, { ...fast, deviceMemory: 2 }],
    ['low-core devices use at most two chunks', 2, 10, { ...fast, hardwareConcurrency: 2 }],
    ['parallelism never exceeds remaining chunks', 2, 2, fast],
    ['one chunk upload uses one worker', 1, 1, fast],
    ['explicit concurrency override is respected', 2, 10, { ...fast, override: 2 }],
    ['explicit concurrency override remains capped at three', 3, 10, { ...fast, override: 9 }],
    ['invalid override falls back to network policy', 1, 10, {
        ...fast, override: 0, connection: { effectiveType: '2g' }
    }]
];

for (const [name, expected, total, options] of cases) {
    assert.equal(getVideoUploadConcurrency(total, options), expected, name);
    console.log('PASS:', name);
}

assert.equal(getVideoUploadConcurrency(0, fast), 1);
assert.equal(getVideoUploadConcurrency('invalid', fast), 1);
console.log('PASS: invalid chunk totals fail safely');
console.log(`ALL UPLOAD POLICY TESTS PASSED (${cases.length + 1} contracts plus invalid-input checks).`);
