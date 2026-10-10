# MILAN Deep SEO Agent

A production-safe technical SEO audit agent for the public MILAN site.

## What it does

- Crawls the configured public origin.
- Reads sitemap.xml / sitemap_index.xml when available.
- Checks HTTP status and HTML delivery.
- Audits title and meta-description presence/length.
- Checks canonical URL, robots/noindex, language, H1 structure and image alt text.
- Checks Open Graph basics and JSON-LD presence.
- Follows same-origin links while avoiding login/register/admin/settings areas.
- Writes a machine-readable report to `seo-reports/latest.json`.

## Safety model

This agent audits and reports instead of mass-publishing AI pages. It is intentionally designed around quality-first SEO. Do not use it to create large numbers of thin doorway pages, keyword variants, or duplicate pages solely to manipulate rankings.

## Target

`SEO_TARGET_URL` is configurable and defaults to `https://milanlife.in/`.

Do not point this at `mirrorlife.com`: that domain is currently a different public website and is not the MILAN property.

## Local run

```bash
python3 seo-agent/seo_agent.py
```

Optional:

```bash
SEO_TARGET_URL=https://example.com/ SEO_MAX_PAGES=50 python3 seo-agent/seo_agent.py
```

Exit status is non-zero when hard technical issues are found. Warnings do not fail the audit.
