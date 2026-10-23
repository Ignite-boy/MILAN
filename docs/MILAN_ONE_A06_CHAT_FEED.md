# A06 — Private Chat Isolation, Feed Ordering, and Pagination

## Verification scope

A06 covers private Messenger exclusion from social feeds, the authenticated home-feed
request path, and deterministic ordering and continuation through paginated results.

## Regression checks

- `npm run test:chat` verifies private mailbox ownership and DID/space predicates,
  chat exclusion in social routes, social interaction isolation, and chat filtering
  in feed-cache, merge, and render paths.
- `npm run test:feed-pagination` exercises the Express feed route using mocked storage
  containing ordinary posts interleaved with chat-shaped records, including records
  marked public/shared and records owned by another DID.
- The pagination test checks page boundaries, stable ordering, complete non-overlapping
  pages on an unchanged fixture, continuation offsets, end-of-feed behavior, and
  the SQL ordering contract `date_modified DESC, item_key DESC`.
- The route test verifies that `mine`, `friends`, and `public` scopes do not expose
  chat-shaped records and that legitimate public posts remain visible.
- CI registers `npm run test:feed-pagination` as a dedicated verification step.
- `npm run test:security` and `npm run build` provide additional regression checks.

## Verification limits

Route tests use mocked storage and the SQL ordering check verifies source structure.
These checks are not an independent production-database audit and do not close R01.
The October 22, 2026 production database incident remains an operator-owned release
gate. No production database was queried or mutated for A06.
