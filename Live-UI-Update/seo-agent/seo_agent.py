#!/usr/bin/env python3
"""MILAN Deep SEO Agent: technical SEO + content-quality audit.

Safe by design: it audits and reports; it does not mass-generate or publish pages.
Target is configurable via SEO_TARGET_URL and defaults to the real MILAN domain.
"""
from __future__ import annotations

import json
import os
import re
import time
from collections import deque
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

DEFAULT_TARGET = "https://milanlife.in/"
USER_AGENT = "MILAN-Deep-SEO-Agent/1.2 (+technical-seo-audit)"
MAX_PAGES = int(os.getenv("SEO_MAX_PAGES", "100"))
TIMEOUT = int(os.getenv("SEO_TIMEOUT", "15"))

# Routes that are application utilities or machine-readable discovery documents.
# They are intentionally outside an HTML-content SEO audit.
SKIP_ROUTES = {
    "/login", "/register", "/admin", "/admin-users.html", "/settings",
    "/chat", "/reset-password", "/disclaimer", "/cookie-policy", "/llms.txt",
}


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.description = ""
        self.canonical = ""
        self.robots = ""
        self.lang = ""
        self.h1 = []
        self.h2 = []
        self.links = []
        self.images_without_alt = 0
        self.og = {}
        self.jsonld = []
        self._capture = None
        self._buf = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html": self.lang = a.get("lang", "")
        elif tag == "title": self._capture = "title"
        elif tag == "h1": self._capture = "h1"
        elif tag == "h2": self._capture = "h2"
        elif tag == "meta":
            name = (a.get("name") or "").lower()
            prop = (a.get("property") or "").lower()
            content = a.get("content") or ""
            if name == "description": self.description = content.strip()
            if name == "robots": self.robots = content.strip()
            if prop.startswith("og:"): self.og[prop] = content.strip()
        elif tag == "link":
            rel = " ".join(a.get("rel", [])).lower() if isinstance(a.get("rel"), list) else (a.get("rel") or "").lower()
            if rel == "canonical": self.canonical = a.get("href", "").strip()
        elif tag == "a":
            href = a.get("href")
            if href: self.links.append(href)
        elif tag == "img" and not (a.get("alt") or "").strip():
            self.images_without_alt += 1
        elif tag == "script" and (a.get("type") or "").lower() == "application/ld+json":
            self._capture = "jsonld"

    def handle_endtag(self, tag):
        if tag in {"title", "h1", "h2", "script"} and self._capture:
            value = "".join(self._buf).strip()
            if self._capture == "title": self.title = value
            elif self._capture == "h1" and value: self.h1.append(value)
            elif self._capture == "h2" and value: self.h2.append(value)
            elif self._capture == "jsonld" and value:
                try: self.jsonld.append(json.loads(value))
                except json.JSONDecodeError: pass
            self._capture = None
            self._buf = []

    def handle_data(self, data):
        if self._capture: self._buf.append(data)


def fetch(url: str):
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})
    try:
        with urlopen(req, timeout=TIMEOUT) as r:
            body = r.read()
            ctype = r.headers.get("Content-Type", "")
            return r.status, ctype, body
    except (HTTPError, URLError, TimeoutError) as e:
        return None, "", str(e).encode()


def normalize(url: str) -> str:
    p = urlparse(url)
    path = p.path or "/"
    return f"{p.scheme}://{p.netloc}{path}"


def path_of(url: str) -> str:
    return (urlparse(url).path or "/").rstrip("/") or "/"


def should_skip(url: str) -> bool:
    path = path_of(url)
    return path in SKIP_ROUTES or path.startswith("/api/")


def same_origin(url: str, origin: str) -> bool:
    return urlparse(url).netloc == urlparse(origin).netloc and urlparse(url).scheme in {"http", "https"}


def load_sitemap(base: str) -> list[str]:
    for candidate in (urljoin(base, "/sitemap.xml"), urljoin(base, "/sitemap-index.xml"), urljoin(base, "/sitemap_index.xml")):
        status, ctype, body = fetch(candidate)
        if status == 200 and b"<loc>" in body:
            return [x.decode(errors="ignore").strip() for x in re.findall(rb"<loc>(.*?)</loc>", body)][:MAX_PAGES]
    return []


def audit(target: str) -> dict:
    target = normalize(target)
    origin = f"{urlparse(target).scheme}://{urlparse(target).netloc}"
    queue = deque([target])
    seen = set()
    pages = []
    sitemap_urls = load_sitemap(origin)
    for u in sitemap_urls[:MAX_PAGES]:
        if same_origin(u, origin) and not should_skip(u): queue.append(normalize(u))

    while queue and len(seen) < MAX_PAGES:
        url = queue.popleft()
        if url in seen or not same_origin(url, origin) or should_skip(url): continue
        seen.add(url)
        status, ctype, body = fetch(url)
        item = {"url": url, "status": status, "content_type": ctype, "issues": [], "warnings": []}
        if status != 200 or "text/html" not in ctype:
            item["issues"].append("page_not_html_or_not_200")
            pages.append(item); continue
        parser = PageParser()
        parser.feed(body.decode(errors="ignore"))
        item.update({
            "title": parser.title,
            "title_length": len(parser.title),
            "description": parser.description,
            "description_length": len(parser.description),
            "canonical": parser.canonical,
            "robots": parser.robots,
            "lang": parser.lang,
            "h1_count": len(parser.h1),
            "h1": parser.h1[:3],
            "h2_count": len(parser.h2),
            "images_without_alt": parser.images_without_alt,
            "og_title": parser.og.get("og:title", ""),
            "og_description": parser.og.get("og:description", ""),
            "og_image": parser.og.get("og:image", ""),
            "jsonld_types": sorted({str(x.get("@type")) for x in parser.jsonld if isinstance(x, dict) and x.get("@type")}),
        })
        if not parser.title: item["issues"].append("missing_title")
        elif not 20 <= len(parser.title) <= 65: item["warnings"].append("title_length_outside_common_range")
        if not parser.description: item["issues"].append("missing_meta_description")
        elif not 70 <= len(parser.description) <= 170: item["warnings"].append("description_length_outside_common_range")
        if not parser.canonical: item["issues"].append("missing_canonical")
        if "noindex" in parser.robots.lower(): item["warnings"].append("page_is_noindex")
        if len(parser.h1) != 1: item["warnings"].append("h1_count_not_one")
        if parser.images_without_alt: item["warnings"].append("images_missing_alt")
        if not parser.og.get("og:title"): item["warnings"].append("missing_og_title")
        if not parser.og.get("og:description"): item["warnings"].append("missing_og_description")
        if not parser.jsonld: item["warnings"].append("no_jsonld_detected")
        pages.append(item)
        for href in parser.links:
            absolute = normalize(urljoin(url, href))
            if same_origin(absolute, origin) and absolute not in seen and not should_skip(absolute):
                queue.append(absolute)
        time.sleep(0.05)

    all_issues = {}
    all_warnings = {}
    for p in pages:
        for x in p.get("issues", []): all_issues[x] = all_issues.get(x, 0) + 1
        for x in p.get("warnings", []): all_warnings[x] = all_warnings.get(x, 0) + 1
    return {
        "agent": "MILAN Deep SEO Agent",
        "target": origin,
        "pages_checked": len(pages),
        "sitemap_urls_found": len(sitemap_urls),
        "issues": all_issues,
        "warnings": all_warnings,
        "pages": pages,
        "policy": {"no_mass_generated_pages": True, "quality_first": True, "ranking_not_guaranteed": True},
    }


def main() -> int:
    target = os.getenv("SEO_TARGET_URL", DEFAULT_TARGET)
    report = audit(target)
    out_dir = os.getenv("SEO_REPORT_DIR", "seo-reports")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "latest.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(json.dumps({k: report[k] for k in ("agent", "target", "pages_checked", "sitemap_urls_found", "issues", "warnings")}, indent=2))
    return 0 if not report["issues"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
