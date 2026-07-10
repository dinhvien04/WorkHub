'use strict';

/**
 * Responsive viewport checklist (manual + optional Playwright).
 * Breakpoints: 320, 360, 390, 430, 768, 1024, 1280, 1440
 */
const VIEWPORTS = [320, 360, 390, 430, 768, 1024, 1280, 1440];
const PATHS = ['/', '/search', '/login', '/booking/wizard'];

async function main() {
  console.log('Responsive checklist (master prompt)');
  console.log('Viewports:', VIEWPORTS.join(', '));
  console.log('Paths:', PATHS.join(', '));

  if (process.env.PLAYWRIGHT_SKIP === '1') {
    console.log('PLAYWRIGHT_SKIP=1 — print-only mode. Manual QA required.');
    process.exit(0);
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.log('Playwright not installed — checklist printed only.');
    process.exit(0);
  }

  const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
  const browser = await chromium.launch({ headless: true });
  const failures = [];

  for (const w of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: w, height: 800 } });
    for (const path of PATHS) {
      try {
        const res = await page.goto(`${base}${path}`, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        const status = res ? res.status() : 0;
        if (status >= 500) failures.push(`${w}px ${path} → ${status}`);
        else console.log(`OK ${w}px ${path} ${status}`);
      } catch (err) {
        failures.push(`${w}px ${path}: ${err.message}`);
      }
    }
    await page.close();
  }
  await browser.close();
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('Responsive smoke OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
