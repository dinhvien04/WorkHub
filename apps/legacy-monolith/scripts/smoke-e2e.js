"use strict";

/**
 * Smoke E2E against a running server (or spins memory-less HTTP checks via start).
 * Default: hits BASE_URL (http://127.0.0.1:PORT) health + public pages + search API.
 *
 * Usage:
 *   node scripts/smoke-e2e.js
 *   BASE_URL=http://localhost:3000 node scripts/smoke-e2e.js
 */
const base =
  process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

async function check(path, { method = "GET", expectStatus = 200, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ok = res.status === expectStatus;
  const text = await res.text();
  return {
    path,
    status: res.status,
    ok,
    version: res.headers.get("x-workhub-version"),
    sample: text.slice(0, 80).replace(/\s+/g, " "),
  };
}

async function main() {
  console.log(`Smoke E2E → ${base}`);
  const steps = [
    await check("/health"),
    await check("/health/live"),
    await check("/health/ready"),
    await check("/health/details"),
    await check("/metrics"),
    await check("/"),
    await check("/search"),
    await check("/api/search?limit=5"),
    await check("/api/search/facets"),
    await check("/api/featured"),
    await check("/api/gateway/providers"),
    await check("/robots.txt"),
    await check("/sitemap_index.xml"),
    await check("/sitemap-images.xml"),
    await check("/metrics"),
    await check("/api/auth/google/status"),
    await check("/api/featured"),
    await check("/status"),
    await check("/offline.html"),
    await check("/manifest.webmanifest"),
  ];

  let failed = 0;
  for (const s of steps) {
    const mark = s.ok ? "OK " : "FAIL";
    if (!s.ok) failed += 1;
    console.log(`${mark} ${s.status} ${s.path} ${s.version || ""} ${s.sample}`);
  }

  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${steps.length} smoke checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
