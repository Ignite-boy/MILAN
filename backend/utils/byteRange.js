'use strict';

function parseByteRange(range, total) {
  const size = Number(total);
  if (!Number.isSafeInteger(size) || size <= 0) return { invalid: true };

  const match = String(range || '').trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) return null;

  // Suffix range: bytes=-N means the final N bytes of the resource.
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { invalid: true };
    }
    return { start: Math.max(size - suffixLength, 0), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)) {
    return { invalid: true };
  }

  const end = Math.min(requestedEnd, size - 1);
  if (start >= size || end < start) return { invalid: true };
  return { start, end };
}

module.exports = { parseByteRange };
