# Sentinel Agent Contract

MILAN Sentinel is the repository's autonomous QA coordinator.

## Operating rules

1. Generate deterministic cases from `scenarios/test-matrix.json`.
2. Never mark a case PASS because it was generated. PASS requires real evidence.
3. Prefer low-risk read-only probes automatically: HTTP status, headers, favicon availability, HTML references, robots/sitemap, TLS, redirects, API health, public UI, and service reachability.
4. Browser-changing or data-mutating flows require explicit credentials/test accounts and must run only against approved environments.
5. A discovered failure should be stored as a reproducible regression case and linked to the commit/deployment that exposed it.
6. Never print secrets in reports.
7. Do not attempt artificial ranking manipulation, spam, fake engagement, or mass-generated search content. SEO checks are for technical health, useful content, indexability, accessibility, and discoverability signals.

## Case accounting

The matrix contains exactly 10,000,000 addressable cases. Cases are generated on demand from six dimensions and therefore are not stored as 10,000,000 individual files.

Each execution should record:

- case ID
- scenario/category
- target environment
- browser/device or request context
- application state
- locale
- start/end timestamp
- PASS/FAIL/BLOCKED
- evidence reference
- commit/deployment identifier
- sanitized failure reason
