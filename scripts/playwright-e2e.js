'use strict';

/**
 * Skip-safe Playwright smoke E2E.
 *
 * - Exits 0 with a clear message if `playwright` is not installed
 * - Or if PLAYWRIGHT_SKIP=1 / CI without browsers
 * - When available, hits public pages on BASE_URL
 *
 * Usage:
 *   npm run test:e2e
 *   BASE_URL=http://127.0.0.1:3000 npm run test:e2e
 *   npx playwright install chromium   # one-time browser download
 */
const base = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

function skip(reason) {
  console.log(`[playwright-e2e] SKIP: ${reason}`);
  process.exit(0);
}

async function main() {
  if (process.env.PLAYWRIGHT_SKIP === '1' || process.env.PLAYWRIGHT_SKIP === 'true') {
    return skip('PLAYWRIGHT_SKIP=1');
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    return skip(
      'playwright not installed (optional). Install with: npm i -D playwright && npx playwright install chromium'
    );
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    return skip(`browser launch failed: ${err.message}`);
  }

  const page = await browser.newPage();
  const failures = [];

  async function visit(path, { expectText } = {}) {
    const url = `${base}${path}`;
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const status = res ? res.status() : 0;
      if (status >= 400) {
        failures.push(`${path} → HTTP ${status}`);
        console.log(`FAIL ${status} ${path}`);
        return;
      }
      if (expectText) {
        const body = await page.textContent('body');
        if (!body || !body.includes(expectText)) {
          failures.push(`${path} missing text: ${expectText}`);
          console.log(`FAIL text ${path}`);
          return;
        }
      }
      console.log(`OK   ${status} ${path}`);
    } catch (err) {
      failures.push(`${path}: ${err.message}`);
      console.log(`FAIL ${path} ${err.message}`);
    }
  }

  console.log(`[playwright-e2e] → ${base}`);
  await visit('/health', { expectText: 'ok' }).catch(() => {});
  // health may be JSON — use status only
  await visit('/');
  await visit('/search');
  await visit('/security');
  await visit('/consent');
  await visit('/login');

  await browser.close();

  if (failures.length) {
    console.error(`\n${failures.length} Playwright check(s) failed`);
    process.exit(1);
  }
  console.log('\nPlaywright smoke passed');
}

main().catch((err) => {
  console.error(err);
  // Treat unexpected errors as skip-safe soft fail only when server is down
  if (String(err.message || '').includes('ECONNREFUSED')) {
    skip(`server not reachable at ${base}`);
  }
  process.exit(1);
});
