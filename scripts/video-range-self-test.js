'use strict';

const assert = require('node:assert/strict');
const { parseByteRange } = require('../backend/utils/byteRange');

const cases = [
  ['first byte', 'bytes=0-0', 100, { start: 0, end: 0 }],
  ['closed range', 'bytes=10-19', 100, { start: 10, end: 19 }],
  ['open-ended range', 'bytes=50-', 100, { start: 50, end: 99 }],
  ['end is clipped to resource size', 'bytes=90-500', 100, { start: 90, end: 99 }],
  ['suffix range', 'bytes=-10', 100, { start: 90, end: 99 }],
  ['suffix larger than resource', 'bytes=-500', 100, { start: 0, end: 99 }],
  ['zero suffix is unsatisfiable', 'bytes=-0', 100, { invalid: true }],
  ['start at resource size is invalid', 'bytes=100-', 100, { invalid: true }],
  ['start beyond resource is invalid', 'bytes=101-200', 100, { invalid: true }],
  ['end before start is invalid', 'bytes=20-10', 100, { invalid: true }],
  ['empty resource range is invalid', 'bytes=0-0', 0, { invalid: true }],
  ['wrong unit is malformed', 'items=0-1', 100, null],
  ['multiple ranges are unsupported', 'bytes=0-1,4-5', 100, null],
  ['malformed range is rejected', 'bytes=abc-def', 100, null],
];

for (const [name, range, total, expected] of cases) {
  assert.deepEqual(parseByteRange(range, total), expected, name);
  console.log(`PASS: ${name}`);
}

console.log(`ALL VIDEO RANGE SELF-TESTS PASSED (${cases.length} cases).`);
