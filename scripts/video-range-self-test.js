'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseByteRange } = require('../backend/utils/byteRange');

const routes = fs.readFileSync(
  require('node:path').join(__dirname, '../backend/routes/records.js'), 'utf8'
);

assert.match(routes, /const \{ parseByteRange \} = require\('\.\.\/utils\/byteRange'\);/);
assert.equal(
  (routes.match(/parseByteRange\(range, total\)/g) || []).length,
  1,
  'file-stream path must use the shared range parser'
);
assert.equal(
  (routes.match(/parseByteRange\(req\.headers\.range, total\)/g) || []).length,
  1,
  'buffer-stream path must use the shared range parser'
);

const cases = [
  ['first byte', 'bytes=0-0', 100, { start: 0, end: 0 }],
  ['closed range', 'bytes=10-19', 100, { start: 10, end: 19 }],
  ['open-ended range', 'bytes=50-', 100, { start: 50, end: 99 }],
  ['end clipped to resource size', 'bytes=90-500', 100, { start: 90, end: 99 }],
  ['suffix range', 'bytes=-10', 100, { start: 90, end: 99 }],
  ['case-insensitive unit', 'BYTES=-10', 100, { start: 90, end: 99 }],
  ['trim surrounding whitespace', ' bytes=10-19 ', 100, { start: 10, end: 19 }],
  ['suffix larger than resource', 'bytes=-500', 100, { start: 0, end: 99 }],
  ['suffix of one byte', 'bytes=-1', 100, { start: 99, end: 99 }],
  ['zero suffix is unsatisfiable', 'bytes=-0', 100, { invalid: true }],
  ['start at resource size is invalid', 'bytes=100-', 100, { invalid: true }],
  ['start beyond resource is invalid', 'bytes=101-200', 100, { invalid: true }],
  ['end before start is invalid', 'bytes=20-10', 100, { invalid: true }],
  ['empty resource cannot satisfy a range', 'bytes=0-0', 0, { invalid: true }],
  ['invalid non-integer resource size', 'bytes=0-1', 100.5, { invalid: true }],
  ['unsafe start integer', 'bytes=9007199254740992-', 100, { invalid: true }],
  ['unsafe end integer', 'bytes=1-9007199254740992', 100, { invalid: true }],
  ['wrong unit is malformed', 'items=0-1', 100, null],
  ['multiple ranges unsupported', 'bytes=0-1,4-5', 100, null],
  ['missing range endpoints', 'bytes=-', 100, null],
  ['malformed range', 'bytes=abc-def', 100, null],
  ['negative range', 'bytes=-2--1', 100, null]
];

for (const [name, range, total, expected] of cases) {
  assert.deepEqual(parseByteRange(range, total), expected, name);
  console.log(`PASS: ${name}`);
}

console.log(`ALL VIDEO RANGE SELF-TESTS PASSED (${cases.length} cases).`);
