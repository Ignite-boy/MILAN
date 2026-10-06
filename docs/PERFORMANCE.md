# MILAN — Performance Guide (honest & curated)

You shared a list of 30 npm packages. **Most of them do nothing for MILAN** — this
app is **vanilla HTML/JS + Express + DWN (file-based JSON + embedded LevelDB)**. It has
**no React, no Vite build, no MongoDB/SQL**. Installing the irrelevant ones just adds
bloat, supply-chain risk, and slower installs — not speed.

Below is what was actually done, what to install, and what to skip (with reasons).

## ✅ Applied now (real, safe wins — no risky deps)
- **JSON read cache** (`utils/store.js`) — the app read/parsed JSON files on nearly
  every request. Now reads are cached by file mtime+size: unchanged files skip disk
  read + parse, and any write auto-invalidates the cache (no stale data). Returns a deep
  clone so callers can mutate safely. *Verified with 7 unit assertions.* This is the
  biggest backend latency win available without changing the storage architecture.
- **Single application process** — the backend runs as part of the deployed application with
  auto-restart, memory guard, and logs.

## ✅ Already in place (don't re-add)
- `compression` (gzip) — installed & active in `server.js`.
- **Static asset caching** — favicons/logos/images served `max-age=604800, immutable`.
- **Service worker** (`sw.js`) — network-first, cache-purge on activate (fresh + offline shell).
- **Streaming uploads**, **range video streaming**, **rate limiting**, **security headers** — already in `server.js`.
- New pages already use **debounced search**, **lazy images**, `preload="none"` audio.

## 👍 Worth installing (only these few)
```bash
cd backend
npm i lru-cache        # optional: bounded in-memory cache if you add more hot paths
npm i helmet           # optional: hardened security headers (or keep the manual ones)
npm i pino pino-pretty # optional: very fast structured logging (replaces console.log)
npm i -D autocannon    # dev only: load-test the API to find real bottlenecks
```
Run in production:
```bash
cd backend
```

## ❌ Skip these (useless or harmful for MILAN)
| Package(s) | Why skip |
|---|---|
| react-window, react-virtualized, @tanstack/react-query, react-lazyload, react-intersection-observer, framer-motion, zustand, jotai, use-debounce | **No React in MILAN.** The UI is vanilla HTML/JS. These do nothing. |
| vite-plugin-compression, rollup-plugin-visualizer, @vitejs/plugin-react-swc, terser, esbuild, `serve` | **No Vite/Rollup build, no `dist/`.** Frontend is static HTML served by Express. `npm run build` doesn't exist. |
| mongoose, mongodb, prisma, @prisma/client, knex | **No MongoDB/SQL.** MILAN uses DWN + JSON files. Dead weight. |
| redis, ioredis | Only useful **if** you run a Redis server and wire it in. Not used today. |
| uWebSockets.js | Not a drop-in — would require rewriting the HTTP/WS server. |
| `npm install cluster` | **Wrong package.** Node's `cluster` is built-in; the npm "cluster" package is unrelated/outdated. Don't install. |
| lodash | Vanilla JS already covers it here. |

MILAN's data lives in **JSON files + an embedded LevelDB** (`classic-level` /
`dwn-sdk-js`), which **lock to a single process**. Multiple cluster workers would
corrupt data or fail to open the DB. The included config uses **fork mode (1 instance)**
on purpose. To scale across cores/servers, first move shared state to Redis/Postgres,
then enable cluster mode.

## Next real wins (when you want them)
1. **HTTP/2 + Brotli** — handled by your host (Render/Cloudflare); enable Brotli at the edge.
2. **CDN in front** (Cloudflare) for static assets and TLS termination — big perceived speed.
3. **Move hot data to Redis/Postgres** — unlocks real horizontal scaling + cluster mode.
4. **Image/video transcoding offload** — already uses ffmpeg; move heavy jobs to a queue if traffic grows.
