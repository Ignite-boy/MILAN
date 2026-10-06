> **HISTORICAL DOCUMENT — SUPERSEDED.** This document describes an older MILAN frontend architecture. The current production web application is `frontend/`; do not use the legacy Next.js/web paths below as implementation or deployment instructions.\n\n---\n\n# Deep Technical SEO — Applied (from Google Ranking Signals PDF)

Applied across all four properties in this repo. Legend: ✅ done now · ✔️ already present (verified) · ⚙️ config/placeholder you should fill.

**Properties**
- **Root** — `niteshpandey.com` static site (`index.html`, `robots.txt`, `sitemap.xml`)
- **web5** — `milan-web5/` (Next.js 15)
- **web** — `milan-app/web/` (Next.js, already strong)
- **frontend** — `milan-app/frontend/` (static `milanlife.in`, already strong)

---

## 1. Domain-Level
- Country TLD / geo targeting: ✅ added `geo.region=IN`, `geo.placename`, `hreflang en / en-IN / x-default` on Root; ✔️ frontend already had geo + hreflang.
- Domain age / history / keyword-in-domain: informational only — nothing to code.

## 2. Page-Level Content
- Title with keyword: ✔️ all sites. web5 now has **unique per-route titles** (Feed, Communities, Graph, Premium, Profile) ✅.
- Meta description (CTR): ✅ unique per-route descriptions added to web5; ✔️ others.
- Content depth / freshness: ✅ Root now shows a visible `Last updated` `<time>` + `dateModified` in schema.
- Heading structure (H1/H2/H3): ✔️ Root already clean (single H1, sectioned H2s).
- Image optimization: ✅ Root hero `<img>` now has `width/height` (CLS), `loading=eager`, `fetchpriority=high`, `decoding=async`, descriptive `alt`.
- Page speed / Core Web Vitals: ✅ frontend `.htaccess` now does compression (gzip+brotli), cache headers, immutable static caching; ✔️ both Next apps already ship AVIF/WebP + security headers + font `display:swap`.
- Mobile-friendly: ✔️ responsive viewport on all.
- Structured data: ✅ web5 now emits Organization + WebSite(SearchAction) + SoftwareApplication JSON-LD; ✅ Root adds WebSite+SearchAction, BreadcrumbList, dates; ✔️ frontend has a full `@graph` (WebApp/Org/Person/FAQ).
- Duplicate content / canonical: ✅ canonical + per-route canonicals everywhere; ✅ frontend `.htaccess` enforces one canonical host + clean URLs.

## 3. Site-Level
- Sitemap.xml: ✅ Root sitemap upgraded (hreflang + image); ✅ web5 sitemap adds `/graph`; ✔️ web + frontend (index/cities/keywords).
- Robots.txt: ✅ Root + web5 + web + frontend now explicitly allow all major search **and AI** crawlers (Googlebot, Google-Extended, GPTBot, OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, anthropic-ai, CCBot, Applebot(+Extended), DuckDuckBot, Bing).
- HTTPS/SSL: ✅ frontend `.htaccess` forces HTTPS (301); ✔️ Next apps set HSTS.
- Uptime/reliability, security headers: ✅ frontend now sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS; ✔️ Next apps already do in `next.config`.
- Trust pages (About/Privacy/Terms): ✔️ frontend has about/privacy/terms/cookie/disclaimer.
- Manifest / PWA: ✅ web5 now has `manifest.ts` + `icon.svg` + `apple-icon` + `opengraph-image`; ✅ Root has `site.webmanifest`; ✔️ others.

## 4. Backlinks
- Internal linking, contextual links: ✔️ existing nav/hubs. `sameAs` slots present (⚙️ fill real profile URLs to earn entity trust).
- Off-site link acquisition is not a code task.

## 5. User-Interaction Signals
- CTR levers coded (unique titles/descriptions, rich results eligibility). Bounce/dwell/pogo are behavioral — improved indirectly by speed + clarity.

## 6. E-E-A-T
- Author/Person entity + credentials: ✔️ Root Person schema (alumniOf, knowsAbout, nationality); frontend Person(founder).
- NAP / business info: ⚙️ add real contact/NAP via env (`NEXT_PUBLIC_CONTACT_EMAIL`) for stronger trust.

## 7. Technical SEO
- Crawlability (robots meta, canonical): ✅ everywhere; noindex on private routes (web5 messages/notifications/settings now have noindex layouts).
- Clean URLs: ✅ frontend `.htaccess` serves extensionless URLs + 301s `.html` → clean (matches existing canonicals).
- 404 handling: ✅ `ErrorDocument 404 /404.html`.
- 301 redirects / no chains: ✅ single-hop HTTPS + host canonicalization.
- Core Web Vitals: ✅ caching/compression + image sizing.

## 8. Local SEO
- Geo meta + `en-IN` hreflang: ✅ Root; ✔️ frontend (India-targeted, Hindi FAQ). GBP/citations are off-site tasks.

## 9. Social Signals
- OG + Twitter cards complete (image dimensions/alt, locale, site_name): ✅ Root expanded; ✔️ others.

## 10. Algorithm-Specific
- Helpful-Content / Hummingbird / BERT / RankBrain: served by entity-rich schema, FAQ blocks, `llms.txt` (✅ added for Root + web5), semantic headings and clean, unique copy.

---

## Files changed / added
**Root:** `index.html` (head + schema + image + footer), `robots.txt`, `sitemap.xml`, `site.webmanifest` (new), `llms.txt` (new).
**web5:** `app/layout.tsx`, `app/robots.ts`, `app/sitemap.ts`, `lib/seo.ts` (new), `components/seo/json-ld.tsx` (new), `app/manifest.ts` (new), `app/icon.svg` (new), `app/apple-icon.tsx` (new), `app/opengraph-image.tsx` (new), `public/llms.txt` (new), per-route `layout.tsx` × 8 (feed, communities, graph, premium, profile + noindex messages, notifications, settings).
**web:** `app/robots.ts` (AI crawlers).
**frontend:** `.htaccess` (full technical config), `robots.txt` (AI crawlers).

## You should still fill in (⚙️ placeholders — kept as agreed)
1. Real `sameAs` profile URLs (LinkedIn / Crunchbase / X / GitHub / Wikidata) in Root `index.html` and the visible "Elsewhere" links — these must match each other.
2. `@twitter:site` / `@creator` handle in Root.
3. `NEXT_PUBLIC_SITE_URL` (and optionally `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_SOCIAL_PROFILES`) env vars for both Next apps in production.
4. Real favicon/OG image assets for Root (`/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png`, `nitesh-pandey.jpg` at 1200×630).
5. Verify `.htaccess` clean-URL rules on staging before production (Apache-only; ignore if hosted on Nginx/Vercel).
