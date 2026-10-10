'use strict';

const { chromium } = require('playwright');

const BASE = process.env.MILAN_URL || 'https://milanlife.in';
const API = process.env.MILAN_API_URL || 'https://milan-api-4n3n.onrender.com';
const TRAVEL = process.env.TRAVEL_URL || 'https://ai-travel-agent-1u4n.onrender.com';
const DWN = process.env.DWN_URL || 'https://mini-dwn.onrender.com';

const ADAPTERS = {
  'favicon-http-status': { action: 'status', environment: 'milan-prod' },
  'favicon-content-type': { action: 'headers', environment: 'milan-prod' },
  'favicon-html-reference': { action: 'body', environment: 'milan-prod' },
  'apple-touch-icon': { action: 'status', environment: 'milan-prod' },
  'logo-http-status': { action: 'status', environment: 'milan-prod' },
  'control-center-load': { action: 'body', environment: 'milan-prod' },
  'health-control': { action: 'status', environment: 'milan-api' },
  'robots': { action: 'body', environment: 'milan-prod' },
  'sitemap': { action: 'body', environment: 'milan-prod' },
  'canonical': { action: 'body', environment: 'milan-prod' },
  'structured-data': { action: 'body', environment: 'milan-prod' },
  'dwn-health': { action: 'status', environment: 'dwn-public' },
  'travel-health': { action: 'status', environment: 'travel-agent-prod' },
  'travel-request': { action: 'status', environment: 'travel-agent-prod' },
  'page-render': { action: 'render', environment: 'milan-prod' },
  'console-errors': { action: 'console', environment: 'milan-prod' },
  'network-failures': { action: 'network', environment: 'milan-prod' },
  'responsive-layout': { action: 'render', environment: 'milan-prod', responsive: true }
};

const URLS = {
  'favicon-http-status': `${BASE}/favicon.svg`,
  'favicon-content-type': `${BASE}/favicon.svg`,
  'favicon-html-reference': `${BASE}/app`,
  'apple-touch-icon': `${BASE}/apple-touch-icon.png`,
  'logo-http-status': `${BASE}/assets/milan-logo.png`,
  'control-center-load': `${BASE}/app`,
  'health-control': `${API}/api/health`,
  'robots': `${BASE}/robots.txt`,
  'sitemap': `${BASE}/sitemap.xml`,
  'canonical': `${BASE}/app`,
  'structured-data': `${BASE}/app`,
  'dwn-health': `${DWN}/health`,
  'travel-health': `${TRAVEL}/health`,
  'travel-request': `${TRAVEL}/`
};

const VIEWPORTS = {
  'desktop-1440': { width: 1440, height: 900 },
  'desktop-1280': { width: 1280, height: 900 },
  'desktop-1024': { width: 1024, height: 768 },
  'laptop-1366': { width: 1366, height: 768 },
  'tablet-1024': { width: 1024, height: 768 },
  'tablet-768': { width: 768, height: 1024 },
  'mobile-430': { width: 430, height: 932 },
  'mobile-390': { width: 390, height: 844 },
  'mobile-375': { width: 375, height: 812 },
  'mobile-320': { width: 320, height: 720 }
};

async function http(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.SENTINEL_TIMEOUT_MS || 15000));
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    const body = await response.text();
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
  } finally {
    clearTimeout(timer);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function skip(reason) {
  return { __status: 'SKIP', reason };
}

async function browserCheck(name, device) {
  const viewport = VIEWPORTS[device] || VIEWPORTS['desktop-1440'];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport });
    const pageErrors = [];
    const consoleErrors = [];
    const requestFailures = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('requestfailed', request => requestFailures.push(`${request.url()}: ${request.failure()?.errorText || 'request failed'}`));

    const response = await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert(response && response.status() < 500, `browser navigation failed: HTTP ${response?.status() ?? 'no response'}`);
    if (name === 'page-render') {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      assert(bodyText.trim().length > 0, 'page body is empty');
      return { url: `${BASE}/app`, status: response.status(), viewport, bodyCharacters: bodyText.length };
    }
    if (name === 'console-errors') {
      assert(pageErrors.length === 0 && consoleErrors.length === 0,
        `browser errors: ${[...pageErrors, ...consoleErrors].slice(0, 5).join(' | ')}`);
      return { url: `${BASE}/app`, status: response.status(), pageErrors: 0, consoleErrors: 0 };
    }
    if (name === 'network-failures') {
      assert(requestFailures.length === 0,
        `failed network requests: ${requestFailures.slice(0, 5).join(' | ')}`);
      return { url: `${BASE}/app`, status: response.status(), failedRequests: 0 };
    }
    if (name === 'responsive-layout') {
      const layout = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth
      }));
      assert(layout.documentWidth <= layout.viewportWidth + 1,
        `horizontal overflow at ${layout.viewportWidth}px: document width ${layout.documentWidth}px`);
      return { url: `${BASE}/app`, status: response.status(), ...layout };
    }
    return skip(`No browser assertion is implemented for "${name}".`);
  } finally {
    await browser.close();
  }
}

async function run(caseDef) {
  const name = caseDef.scenario?.name;
  const adapter = ADAPTERS[name];
  if (!adapter) return skip(`No category-specific adapter is implemented for scenario "${name || 'unknown'}".`);
  if (caseDef.environment !== adapter.environment) {
    return skip(`Adapter targets environment "${adapter.environment}", not "${caseDef.environment}".`);
  }
  if (caseDef.action !== adapter.action) {
    return skip(`Adapter implements action "${adapter.action}", not "${caseDef.action}".`);
  }
  if (caseDef.state !== 'fresh') return skip(`Application state "${caseDef.state}" is not implemented by this adapter.`);
  if (caseDef.locale !== 'en-IN') return skip(`Locale "${caseDef.locale}" is not implemented by this adapter.`);
  if (!adapter.responsive && caseDef.device !== 'desktop-1440') {
    return skip(`Viewport "${caseDef.device}" is not implemented by this adapter.`);
  }

  if (adapter.responsive || ['page-render', 'console-errors', 'network-failures'].includes(name)) {
    return browserCheck(name, caseDef.device);
  }

  const url = URLS[name];
  if (!url) return skip(`Adapter URL is not configured for "${name}".`);
  const response = await http(url);

  switch (name) {
    case 'favicon-http-status':
    case 'apple-touch-icon':
    case 'logo-http-status':
    case 'dwn-health':
    case 'travel-health':
    case 'travel-request':
    case 'health-control':
      assert(response.status === 200, `${name}: expected HTTP 200; got ${response.status}`);
      if (name === 'dwn-health' || name === 'travel-health' || name === 'health-control') {
        let parsed;
        try { parsed = JSON.parse(response.body); } catch { parsed = null; }
        assert(parsed && (parsed.ok === true || parsed.status === 'ok'), `${name}: health response body did not report healthy status`);
      }
      if (name === 'travel-request') {
        let parsed;
        try { parsed = JSON.parse(response.body); } catch { parsed = null; }
        assert(parsed && typeof parsed.message === 'string', 'travel root did not return the expected service banner');
      }
      return { url, status: response.status, contentType: response.headers['content-type'] || '' };
    case 'favicon-content-type':
      assert(response.status === 200, `favicon: expected HTTP 200; got ${response.status}`);
      assert((response.headers['content-type'] || '').toLowerCase().includes('image/svg+xml'),
        `favicon: expected image/svg+xml; got ${response.headers['content-type'] || 'no content-type'}`);
      return { url, status: response.status, contentType: response.headers['content-type'] };
    case 'favicon-html-reference':
      assert(response.status === 200, `app page: expected HTTP 200; got ${response.status}`);
      assert(/favicon|apple-touch-icon/i.test(response.body), 'app HTML does not reference a favicon or apple-touch icon');
      return { url, status: response.status, referenceFound: true };
    case 'control-center-load':
      assert(response.status === 200, `app page: expected HTTP 200; got ${response.status}`);
      assert(/milanControlFab|Control Center|milanControlOverlay/i.test(response.body), 'Control Center marker missing');
      return { url, status: response.status, markerFound: true };
    case 'robots':
      assert(response.status === 200 && /User-agent:/i.test(response.body), 'robots.txt response is missing a valid User-agent directive');
      return { url, status: response.status, hasUserAgent: true };
    case 'sitemap':
      assert(response.status === 200 && /<urlset|<sitemapindex/i.test(response.body), 'sitemap XML body is invalid');
      return { url, status: response.status, xmlRootFound: true };
    case 'canonical':
      assert(response.status === 200 && /rel=["']canonical["']/i.test(response.body), 'canonical link is missing');
      return { url, status: response.status, canonicalFound: true };
    case 'structured-data':
      assert(response.status === 200 && /application\/ld\+json/i.test(response.body), 'JSON-LD structured data is missing');
      return { url, status: response.status, jsonLdFound: true };
    default:
      return skip(`No executable assertion is implemented for "${name}".`);
  }
}

module.exports = { run, ADAPTERS };
