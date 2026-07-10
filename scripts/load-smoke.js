"use strict";

/**
 * Lightweight concurrent load smoke (no extra deps).
 * Hits /health and /api/search in parallel for N rounds.
 *
 * Usage:
 *   node scripts/load-smoke.js
 *   BASE_URL=http://localhost:3000 CONCURRENCY=20 ROUNDS=5 node scripts/load-smoke.js
 */
const base =
  process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const concurrency = Math.min(
  100,
  Math.max(1, Number(process.env.CONCURRENCY) || 10),
);
const rounds = Math.min(50, Math.max(1, Number(process.env.ROUNDS) || 3));
const paths = ["/health", "/api/search?limit=5", "/metrics"];

async function one(path) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}${path}`);
    return {
      path,
      status: res.status,
      ms: Date.now() - t0,
      ok: res.status < 500,
    };
  } catch (err) {
    return {
      path,
      status: 0,
      ms: Date.now() - t0,
      ok: false,
      error: err.message,
    };
  }
}

async function main() {
  console.log(`Load smoke ${concurrency}x${rounds} → ${base}`);
  const all = [];
  for (let r = 0; r < rounds; r++) {
    const batch = [];
    for (let i = 0; i < concurrency; i++) {
      batch.push(one(paths[i % paths.length]));
    }
        const results = await Promise.all(batch);
    all.push(...results);
  }
  const ok = all.filter((x) => x.ok).length;
  const fail = all.length - ok;
  const avg = Math.round(all.reduce((s, x) => s + x.ms, 0) / all.length);
  const p95 =
    all.map((x) => x.ms).sort((a, b) => a - b)[Math.floor(all.length * 0.95)] ||
    0;
  console.log({ total: all.length, ok, fail, avgMs: avg, p95Ms: p95 });
  if (fail > all.length * 0.05) {
    console.error("Too many failures");
    process.exit(1);
  }
  console.log("Load smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
