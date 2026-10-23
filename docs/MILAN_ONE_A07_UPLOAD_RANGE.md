# A07 — Upload Retries, Resumable Chunks, and Video Byte Ranges

## Byte-range behavior

The media stream and buffered-stream paths share one byte-range parser. It handles
closed ranges, open-ended ranges, and suffix ranges such as `bytes=-500`; clips
ends to the resource size; rejects unsatisfiable ranges and unsafe integer values;
and treats multi-range requests as unsupported. The route returns a partial response
for a valid range and a range-not-satisfiable response for a rejected range.

## Regression checks

- `npm run test:video-range` exercises the parser with boundary, malformed, suffix,
  empty-resource, and integer-overflow cases. It also verifies that both media
  delivery paths use the shared parser.
- `npm run test:upload` covers normal and shared-storage mocked resumable sessions,
  ownership enforcement, retrying the same chunk, parallel chunk writes, byte counts,
  preservation after failed completion, stable record IDs, and cleanup.
- `npm run test:media-limits` checks the shared media-size contract.
- `npm run build` checks repository integrity and JavaScript build invariants.
- CI runs the video byte-range suite as a dedicated step.

## Verification limits

The upload tests use mocked storage/database adapters and the byte-range suite does
not query production media. No production database was queried or mutated. R01,
the October 22, 2026 production database incident, remains an operator-owned release
gate. These tests do not establish production readiness or close R01.
