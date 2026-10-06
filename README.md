# MILAN

> **Your Space. Your People.**
>
> A privacy-first social platform built around user-owned identity, DID-based access, and DWN-backed data persistence.

[![Production](https://img.shields.io/badge/production-milanlife.in-111827?style=flat-square)](https://milanlife.in)
[![Next.js](https://img.shields.io/badge/frontend-Next.js-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![Node.js](https://img.shields.io/badge/backend-Node.js-16a34a?style=flat-square)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/database-PostgreSQL-2563eb?style=flat-square)](https://www.postgresql.org/)

## Overview

MILAN is a modern social platform designed around a simple principle:

> **One User = One DID = One Isolated DWN Space**

The application combines a polished social experience with an ownership-oriented data model. Identity is DID-based, and Supabase is the authoritative cloud storage backend for user snapshots, records, and media.

### Frontend Stack

The MILAN production frontend is the `frontend/` web application containing the live HTML, CSS, JavaScript, and static assets.

### Production

- **Web:** https://milanlife.in
- **Storage:** Supabase authoritative cloud storage
- **DWN health:** `GET /health`
- **DWN protocol gateway:** `POST /json-rpc`

## Core Architecture

```text
┌───────────────────────────────┐
│        MILAN Frontend        │
│   Social UI • Profiles • Feed │
│     HTML • CSS • JavaScript  │
└───────────────┬───────────────┘
                │ HTTPS
                ▼
┌───────────────────────────────┐
│      MILAN Backend / API      │
│ Auth • Profiles • Social APIs │
└───────────────┬───────────────┘
                │ JSON-RPC
                ▼
┌───────────────────────────────┐
│      Supabase Storage         │
│ Authoritative cloud data      │
└───────────────────────────────┘
```

The application keeps authoritative profile data in Supabase-backed storage rather than depending solely on browser-local state. This includes profile pictures: upload, read-back, logout, and login restore all use the persisted cloud record path.

### Registration reliability

Core account creation is intentionally independent of optional DWN metadata columns. Registration still mints a DID when available, with a bounded fallback identity path so a temporary local DWN initialization failure does not block account creation. The authoritative account row requires only the core authentication fields.

### Profile picture persistence

Profile pictures are stored as a dedicated DWN record:

```text
profile-picture:<user DID>
```

The live profile flow is:

```text
Upload
  ↓
MILAN API
  ↓
Cloud data persistence via Supabase
  ↓
PostgreSQL-backed DWN storage
  ↓
Read after logout/login
  ↓
Profile restored
```

## Identity & Data Ownership

MILAN is built around DID-based identity and isolated user storage.

- One registered user receives one DID-backed identity.
- Profile records are addressed using the user's DID.
- Profile media is stored as a DWN record and read back from the DWN node.
- Access control supports private, public, and DID-based sharing models.
- The architecture is designed so storage infrastructure can evolve without rewriting the frontend permission model.

## Product Surface

MILAN includes a social product layer with:

- Home, public, friends, and personal feeds
- Profile editing and persistent avatars
- DID-based people discovery and friend requests
- Reactions, comments, notifications, and messaging
- Image, video, and text publishing
- Privacy modes for private, public, and shared-DID content
- Media upload and streaming workflows
- Dark-mode friendly premium UI with motion and interaction polish

## Engagement & Experience Layer

The current product also includes an extended engagement system covering:

- Animated profile/avatar treatments
- Gradient and motion-based UI accents
- XP and level progression
- Daily streaks and milestone rewards
- Badge and leaderboard concepts
- Smart composer/AI interaction chips
- Live activity indicators
- Haptic feedback on supported devices

These features are designed as product-layer enhancements on top of the identity and data architecture rather than as replacements for it.

## Local Development

### Next.js frontend

```bash
The production frontend is served from `frontend/`.
```

### Backend

From the project root:

```bash
npm install
npm start
```

Local application endpoint:

```text
http://localhost:5000
```

## Production Deployment

The production application is deployed on Vercel, with Supabase serving as the authoritative cloud storage backend.

Production environment configuration should use:

```text
SUPABASE_URL=https://<your-project>.supabase.co
```

Production API and storage are provided through the Vercel deployment and Supabase authoritative storage.

## Repository Structure

```text
milan-app/
├── frontend/           # Existing web application and static assets
├── backend/            # Node.js API, auth, profile and social services
├── api/                # Deployment/serverless entry points when applicable
├── vercel.json         # Production routing/configuration
└── README.md           # Project documentation
```

## Security & Reliability Principles

MILAN's infrastructure is built with a few non-negotiable principles:

1. **Persist before trusting the UI.** Client-side cache is treated as convenience, not authoritative storage.
2. **DID-scoped records.** User-owned records are addressed and isolated by DID.
3. **HTTPS in production.** Production services communicate over the public HTTPS DWN endpoint.
4. **Resilient cloud sync.** Cloud persistence failures should be handled with bounded retry/backoff without treating local compatibility/cache storage as authoritative.
5. **Stable fixes stay stable.** Changes should be narrowly scoped and should preserve already-verified functionality.

## Quick Verification Checklist

After a production deployment:

```text
[ ] https://milanlife.in loads
[ ] Login succeeds with a fresh token
[ ] Profile read returns avatarRecordId when a DP exists
[ ] DP upload succeeds
[ ] Logout succeeds
[ ] Login restores the persisted DP
[ ] Registration returns 201 for a new account
```

## Roadmap

MILAN is structured to continue evolving across three layers:

- **Product:** better discovery, communication, creation, and engagement
- **Identity:** stronger DID lifecycle and user-controlled permissions
- **Infrastructure:** more resilient DWN hosting, observability, backups, and scalable isolated storage

## License

This repository is maintained as the MILAN application codebase. Licensing and contribution terms should be confirmed from the repository owner's current policy before redistribution.

---

**MILAN**  
*Your Space. Your People.*