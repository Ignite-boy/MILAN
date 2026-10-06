> **HISTORICAL DOCUMENT — SUPERSEDED.** This document describes an older MILAN frontend architecture. The current production web application is `frontend/`; do not use the legacy Next.js/web paths below as implementation or deployment instructions.\n\n---\n\n<div align="center">

# MILAN

**Your Space. Your People. — Decentralized social media where you own your data.**

[Live app → milanlife.in](https://milanlife.in) · [About](https://milanlife.in/about) · [Decentralized Social Media guide](https://milanlife.in/decentralized-social-media)

</div>

---

## What is MILAN?

MILAN is a privacy-first, **decentralized social network built on Web5 primitives** — every user gets their own real **Decentralized Web Node (DWN)** secured by a **Decentralized Identifier (DID)**. Posts, media and connections live in the user's own node, not in a central company database.

- 🔒 **Private by default** — you decide what becomes public or shared
- 🪪 **Self-sovereign identity** — a portable DID that you control
- 🚫 **No ads, no tracking, no data selling** — your attention is not the product
- 🎵 **Free music** — search & play millions of songs, no signup
- 🤖 **AI writing assist**, modern media uploads, themes, communities
- 🇮🇳 **Made in India** — works in every city, town and village

Founded by **Nitesh Pandey**.

## Repository structure

```
.
├── milan-app/                  # Main production app (milanlife.in)
│   ├── backend/                # Node.js + Express API server
│   │   ├── server.js           # Entry point (API, SEO routes, static serving)
│   │   ├── routes/             # API routes
│   │   ├── services/           # Business logic (mail, media, DWN…)
│   │   ├── middleware/         # Auth & request middleware
│   │   ├── scripts/            # Mail test / diagnostics tools
│   │   └── .env.example        # Environment template (copy to .env)
│   ├── frontend/               # Static frontend (HTML/CSS/JS, PWA)
│   │   ├── index.html          # Login / landing page
│   │   ├── app.html            # Main application shell
│   │   ├── decentralized-social-media.html   # SEO pillar page (EN + HI)
│   │   ├── milan-geo-india.js  # India-wide geo detection & city search
│   │   ├── milan-india-cities.js # 856-city directory (all states & UTs)
│   │   └── sitemap*.xml, robots.txt, manifest.json, llms.txt
│   └── web/                    # Next.js web experiment
├── milan-web5/                 # Next.js 14 + TypeScript + Tailwind rebuild (in progress)
├── package-release.mjs         # Builds a clean deployable release bundle
├── redeploy.sh                 # Server redeploy helper
├── QA-AUDIT-REPORT.md          # Quality audit notes
├── RELEASE_CHECKLIST.md        # Pre-release checklist
└── MILAN-SEO-keywords-and-growth.md  # SEO strategy docs
```

## Tech stack

| Layer      | Technology |
|------------|------------|
| Backend    | Node.js ≥ 18, Express, JWT auth, Nodemailer/Resend |
| Identity   | DID (Decentralized Identifiers), `@web5/dids`, `@web5/crypto` |
| Data       | DWN (Decentralized Web Nodes), `@tbd54566975/dwn-sdk-js`, LevelDB stores |
| Media      | ffmpeg-static / ffprobe-static processing pipeline |
| Frontend   | Vanilla HTML/CSS/JS PWA (zero-framework, fast LCP/INP) |
| Rebuild    | Next.js 14, TypeScript, Tailwind CSS (`milan-web5/`) |
| SEO        | JSON-LD (Organization, FAQPage EN+HI, SoftwareApplication), dynamic sitemaps, GEO/AI-Overview-ready atomic answers |

## Quick start

### 1. Backend + production frontend (`milan-app`)

```bash
cd milan-app/backend
cp .env.example .env        # then fill in your values (mail keys, JWT secret…)
npm install
npm start                   # serves API + frontend
```

### 2. Next.js rebuild (`milan-web5`)

```bash
cd milan-web5
npm install
npm run dev                 # http://localhost:3000
```

## Environment variables

All secrets live in `milan-app/backend/.env` — **never committed** (see `.gitignore`).
Use `milan-app/backend/.env.example` as the template. Key groups:

- **Mail** — Resend API key (or SMTP fallback), from/reply-to addresses
- **Auth** — JWT secret, session behaviour
- **Server** — port, public base URL, upload limits

## Release & deploy

```bash
node package-release.mjs    # builds a clean release bundle (no secrets/user data)
./redeploy.sh               # redeploys on the server
```

See `RELEASE_CHECKLIST.md` before shipping.

## SEO / GEO

The frontend ships with white-hat, AI-search-ready SEO: continuous-freshness sitemaps, `llms.txt`, FAQPage & Organization structured data (English + Hindi), atomic-answer content blocks, India-wide geo signals (`geo.region=IN`), and a client-side city finder covering every Indian state and union territory — one URL for the whole country, no doorway pages.

## Security & privacy notes

- Real user data (DWN stores, resolver caches, uploads, logs) is **excluded from this repo** by `.gitignore`.
- `.env` and any key material are never committed.
- Responsible disclosure: **support@milanlife.in**

## License

**All Rights Reserved** — see [LICENSE](LICENSE). The code is public for viewing/reference only; the MILAN name and brand belong to Nitesh Pandey. Licensing enquiries: support@milanlife.in

---

<div align="center">

**MILAN** — Decentralized. Private. Yours.

</div>
