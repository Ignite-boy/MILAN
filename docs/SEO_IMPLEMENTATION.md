# MILAN — Advanced SEO Implementation

Canonical domain used everywhere: **https://milanlife.in**
(Override with env var `PUBLIC_BASE_URL` / `SEO_CANONICAL_URL` if needed.)

## What was implemented (in code)

### On-page SEO (`frontend/index.html`)
- Keyword-optimized `<title>` and meta description targeting *decentralized
  social media, MILAN social, DWN social media, DID social network*.
- Full meta keyword set, robots/googlebot/bingbot directives
  (`max-image-preview:large`, `max-snippet:-1`).
- `<link rel="canonical">` to the brand domain.
- **Open Graph** (Facebook / LinkedIn / WhatsApp) + **Twitter/X** cards with a
  real 1200×630 share image (`/assets/og-cover.png`).
- **JSON-LD structured data** (4 schemas in one graph):
  - `WebApplication` (with aggregateRating, featureList, offers = free)
  - `Organization` (logo, slogan)
  - `WebSite` (with SearchAction sitelinks searchbox)
  - `FAQPage` — eligible for FAQ rich snippets in Google.
- Crawlable, keyword-rich hidden SEO block + `<noscript>` fallback so crawlers
  index real content even though the app is a JS SPA.
- `preconnect`/`dns-prefetch` for fonts (Core Web Vitals).

### Secondary pages
- `about.html` — expanded into real, keyword-rich content (H1/H2 structure,
  DWN/DID explanation) + `AboutPage` JSON-LD + canonical + OG/Twitter.
- `privacy.html`, `terms.html` — canonical + OG/Twitter + proper titles.

### Technical SEO (`backend/server.js`)
- **robots.txt** (dynamic): rules for Googlebot/Image/Video, Bing, DuckDuckGo,
  Yahoo, Apple, social unfurlers, and AI crawlers (GPTBot, PerplexityBot,
  ClaudeBot, Google-Extended). `Host` + `Sitemap` directives.
- **sitemap.xml** (dynamic): image-sitemap extension, all public routes,
  fresh `lastmod`, correct priorities.
- Default canonical base set to `https://milanlife.in`.
- Static `robots.txt` / `sitemap.xml` / `manifest.json` updated to match.

### Assets
- `assets/og-cover.png` — 1200×630 branded social share card (generated).
- `assets/favicon-192.png` — added for manifest.
- `manifest.json` — richer PWA metadata (description, categories, screenshots,
  lang/dir) which also helps app-listing SEO.

## What YOU must do manually (cannot be done in code)

1. **Point milanlife.in at the app.** Make sure the domain actually serves the
   app (DNS + host config on your chosen host). Set env `PUBLIC_BASE_URL=https://milanlife.in`.

2. **Google Search Console** (most important):
   - Add & verify the property for `https://milanlife.in`.
   - Submit `https://milanlife.in/sitemap.xml`.
   - Use *URL Inspection → Request indexing* for the homepage and `/about`.
   - There's already a verification stub route in `server.js`
     (`/google9928e17b30912a08.html`) — replace it with YOUR token if different.

3. **Bing Webmaster Tools** — add site, submit sitemap.

4. **Build backlinks & brand signals** (this is what actually moves ranking):
   - Submit MILAN to Product Hunt, AlternativeTo, BetaList, decentralized-web
     directories, Web5/DID communities, relevant subreddits.
   - Get the brand name "MILAN" + "milanlife.in" mentioned with links.
   - Social profiles (X, LinkedIn) linking back with consistent name/logo.

5. **Replace the og-cover** later with a designer version if you want — keep it
   exactly 1200×630 PNG at `/assets/og-cover.png`.

## Honest expectation on "rank #1 for MILAN"

The bare word **"MILAN"** is dominated by the city of Milan, Italy — ranking #1
for that single word is not realistic for a new app. What IS achievable with
this setup + backlinks:
- "MILAN social", "MILAN app", "MILAN decentralized" → strong brand-term ranking
- "decentralized social media where you own your data", "DWN social media",
  "DID social network", "privacy-first social network alternative" → realistic
  long-tail targets.

SEO compounds over weeks/months after indexing + backlinks — not instant.

## Verify after deploy
- `https://milanlife.in/robots.txt`
- `https://milanlife.in/sitemap.xml`
- Rich Results Test: https://search.google.com/test/rich-results (paste homepage URL)
- Social preview: https://www.opengraph.xyz/ (paste homepage URL)
