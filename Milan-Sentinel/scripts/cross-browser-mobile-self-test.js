'use strict';

const { chromium, firefox, webkit } = require('playwright');

const BASE = (process.env.MILAN_URL || 'https://milanlife.in').replace(/\/+$/, '');
const ENGINES = { chromium, firefox, webkit };
const WIDTHS = [430, 390, 375, 320];

async function main() {
  const results = [];
  const failures = [];

  for (const [name, engine] of Object.entries(ENGINES)) {
    let browser;

    try {
      browser = await engine.launch({ headless: true });

      for (const width of WIDTHS) {
        let page;

        try {
          page = await browser.newPage({
            viewport: { width, height: 844 },
            isMobile: true,
            hasTouch: true,
            deviceScaleFactor: 2
          });

          const errors = [];
          page.on('pageerror', error => errors.push(error.message));

          const response = await page.goto(`${BASE}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });

          await page.waitForTimeout(500);

          const metrics = await page.evaluate(() => ({
            title: document.title,
            viewport: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth
          }));

          const reasons = [];

          if (!response || response.status() !== 200) {
            reasons.push(`HTTP ${response?.status() ?? 'no response'}`);
          }
          if (!metrics.title.includes('MILAN')) {
            reasons.push('Unexpected page title');
          }
          if (metrics.documentWidth > metrics.viewport) {
            reasons.push('Horizontal document overflow');
          }
          if (errors.length) {
            reasons.push(`Page errors: ${errors.join(' | ')}`);
          }

          const result = {
            browser: name,
            width,
            status: response?.status() ?? null,
            ...metrics,
            pageErrors: errors,
            result: reasons.length ? 'FAIL' : 'PASS',
            reasons
          };

          results.push(result);
          console.log(JSON.stringify(result));

          if (reasons.length) failures.push(result);
        } catch (error) {
          const result = {
            browser: name,
            width,
            result: 'FAIL',
            error: error.message
          };
          results.push(result);
          failures.push(result);
          console.log(JSON.stringify(result));
        } finally {
          if (page) await page.close();
        }
      }
    } catch (error) {
      const result = {
        browser: name,
        result: 'ENGINE_FAILED',
        error: error.message
      };
      failures.push(result);
      console.log(JSON.stringify(result));
    } finally {
      if (browser) await browser.close();
    }
  }

  const passed = results.filter(result => result.result === 'PASS').length;

  console.log(JSON.stringify({
    base: BASE,
    browsers: Object.keys(ENGINES),
    widths: WIDTHS,
    total: results.length,
    passed,
    failed: failures.length,
    result: failures.length ? 'FAILED' : 'ALL_PASSED'
  }, null, 2));

  if (failures.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
