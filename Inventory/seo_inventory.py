#!/usr/bin/env python3
"""MILAN public SEO inventory.

Audits discoverable public pages and reports actionable technical SEO issues.
It intentionally does not generate or publish pages at scale.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from html.parser import HTMLParser

TARGET = os.getenv("SEO_TARGET_URL", "https://milanlife.in/").rstrip("/")
MAX_PAGES = int(os.getenv("SEO_MAX_PAGES", "150"))
TIMEOUT = int(os.getenv("SEO_TIMEOUT", "20"))
OUT = os.getenv("SEO_REPORT", "seo-report.json")
UA = "MILAN-SEO-Inventory/1.0"
SKIP = {"/login", "/register", "/admin", "/chat", "/reset-password", "/settings"}

class Parser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.description = ""
        self.canonical = ""
        self.robots = ""
        self.h1 = []
        self.images_without_alt = 0
        self.og = {}
        self.jsonld = []
        self.links = []
        self.capture = None
        self.buf = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "title": self.capture = "title"
        elif tag == "h1": self.capture = "h1"
        elif tag == "meta":
            name = (a.get("name") or "").lower()
            prop = (a.get("property") or "").lower()
            if name == "description": self.description = (a.get("content") or "").strip()
            elif name == "robots": self.robots = (a.get("content") or "").strip()
            elif prop.startswith("og:"): self.og[prop] = (a.get("content") or "").strip()
        elif tag == "link":
            rel = a.get("rel") or ""
            if isinstance(rel, list): rel = " ".join(rel)
            if rel.lower() == "canonical": self.canonical = (a.get("href") or "").strip()
        elif tag == "a" and a.get("href"): self.links.append(a["href"])
        elif tag == "img" and not (a.get("alt") or "").strip(): self.images_without_alt += 1
        elif tag == "script" and (a.get("type") or "").lower() == "application/ld+json": self.capture = "jsonld"

    def handle_endtag(self, tag):
        if self.capture and tag in {"title", "h1", "script"}:
            value = "".join(self.buf).strip()
            if self.capture == "title": self.title = value
            elif self.capture == "h1" and value: self.h1.append(value)
            elif self.capture == "jsonld" and value:
                try: self.jsonld.append(json.loads(value))
                except json.JSONDecodeError: pass
            self.capture = None
            self.buf = []

    def handle_data(self, data):
        if self.capture: self.buf.append(data)

def fetch(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        return None, "", b""

def norm(url: str) -> str:
    p = urllib.parse.urlparse(url)
    return f"{p.scheme}://{p.netloc}{p.path or '/'}"

def path(url: str) -> str:
    return (urllib.parse.urlparse(url).path or "/").rstrip("/") or "/"

def same_origin(url: str) -> bool:
    a, b = urllib.parse.urlparse(url), urllib.parse.urlparse(TARGET)
    return a.netloc == b.netloc and a.scheme in {"http", "https"}

def sitemap_urls() -> list[str]:
    for p in ("/sitemap.xml", "/sitemap-index.xml", "/sitemap_index.xml"):
        status, _, body = fetch(TARGET + p)
        if status == 200 and b"<loc>" in body:
            return [x.decode("utf-8", "ignore").strip() for x in re.findall(rb"<loc>(.*?)</loc>", body)][:MAX_PAGES]
    return []

def audit() -> dict:
    queue = deque([TARGET + "/"])
    sitemap = sitemap_urls()
    for u in sitemap:
        u = norm(u)
        if same_origin(u): queue.append(u)
    seen, pages = set(), []
    while queue and len(seen) < MAX_PAGES:
        url = norm(queue.popleft())
        if url in seen or not same_origin(url) or path(url) in SKIP: continue
        seen.add(url)
        status, ctype, body = fetch(url)
        item = {"url": url, "status": status, "content_type": ctype, "issues": [], "warnings": []}
        if status != 200 or "text/html" not in ctype:
            item["issues"].append("not_html_200")
            pages.append(item)
            continue
        p = Parser(); p.feed(body.decode("utf-8", "ignore"))
        item.update({
            "title": p.title, "description": p.description, "canonical": p.canonical,
            "robots": p.robots, "h1_count": len(p.h1), "images_without_alt": p.images_without_alt,
            "og_title": p.og.get("og:title", ""), "og_description": p.og.get("og:description", ""),
            "jsonld": bool(p.jsonld),
        })
        if not p.title: item["issues"].append("missing_title")
        elif not 20 <= len(p.title) <= 65: item["warnings"].append("title_length")
        if not p.description: item["issues"].append("missing_meta_description")
        elif not 70 <= len(p.description) <= 170: item["warnings"].append("description_length")
        if not p.canonical: item["issues"].append("missing_canonical")
        if "noindex" in p.robots.lower(): item["warnings"].append("noindex")
        if len(p.h1) != 1: item["warnings"].append("h1_count")
        if p.images_without_alt: item["warnings"].append("image_alt")
        if not p.og.get("og:title"): item["warnings"].append("og_title")
        if not p.og.get("og:description"): item["warnings"].append("og_description")
        if not p.jsonld: item["warnings"].append("jsonld")
        pages.append(item)
        for href in p.links:
            u = norm(urllib.parse.urljoin(url, href))
            if same_origin(u) and u not in seen and path(u) not in SKIP: queue.append(u)
    issues, warnings = {}, {}
    for item in pages:
        for x in item["issues"]: issues[x] = issues.get(x, 0) + 1
        for x in item["warnings"]: warnings[x] = warnings.get(x, 0) + 1
    return {"target": TARGET, "pages_checked": len(pages), "sitemap_urls": len(sitemap), "issues": issues, "warnings": warnings, "pages": pages}

def main() -> int:
    report = audit()
    with open(OUT, "w", encoding="utf-8") as f: json.dump(report, f, indent=2, ensure_ascii=False)
    print(json.dumps({k: report[k] for k in ("target", "pages_checked", "sitemap_urls", "issues", "warnings")}, indent=2))
    return 0 if not report["issues"] else 1

if __name__ == "__main__":
    raise SystemExit(main())
