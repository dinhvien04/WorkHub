"use strict";

/**
 * Content-hash critical static assets for long-cache immutable serving.
 * Writes public/asset-manifest.json and copies hashed files under public/dist/.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const DIST = path.join(PUBLIC, "dist");

const ENTRIES = [
  { logical: "css/app.min.css", src: "css/app.min.css" },
  { logical: "css/style.css", src: "css/style.css" },
  { logical: "js/api.js", src: "js/api.js" },
  { logical: "js/domSafe.js", src: "js/domSafe.js" },
  { logical: "js/ui-bind.js", src: "js/ui-bind.js" },
  { logical: "js/main.js", src: "js/main.js" },
  { logical: "vendor/chart.min.js", src: "vendor/chart.min.js" },
  { logical: "vendor/choices.min.js", src: "vendor/choices.min.js" },
  { logical: "vendor/choices.min.css", src: "vendor/choices.min.css" },
];

/**
 * Third-party libraries copied out of node_modules and served from our own
 * origin.
 *
 * They used to load from cdnjs and jsdelivr with a CSP nonce. A nonce on a
 * script tag makes CSP accept it regardless of its src host, so the host
 * allowlist was not actually constraining them — a compromised CDN had script
 * execution on the admin and host dashboards. The choices.js URL was also
 * unversioned (npm/choices.js/...), meaning its contents could change under us
 * at any time with no review.
 *
 * Serving them ourselves removes the third-party execution path entirely,
 * pins the versions in the lockfile, and drops two cross-origin connections.
 */
const VENDOR = [
  { from: "chart.js/dist/chart.min.js", to: "vendor/chart.min.js" },
  {
    from: "choices.js/public/assets/scripts/choices.min.js",
    to: "vendor/choices.min.js",
  },
  {
    from: "choices.js/public/assets/styles/choices.min.css",
    to: "vendor/choices.min.css",
  },
];

function resolveVendor(rel) {
  // Workspace installs may hoist to the repo root or keep a local copy.
  const candidates = [
    path.join(ROOT, "node_modules", rel),
    path.join(ROOT, "..", "..", "node_modules", rel),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function syncVendor() {
  let copied = 0;
  for (const v of VENDOR) {
    const src = resolveVendor(v.from);
    if (!src) {
      console.warn(`vendor missing: ${v.from} — run npm install`);
      continue;
    }
    const dest = path.join(PUBLIC, v.to);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    copied++;
  }
  console.log(`vendor synced: ${copied}/${VENDOR.length}`);
}

function hashFile(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function main() {
  ensureDir(DIST);
  syncVendor();
  const manifest = { generatedAt: new Date().toISOString(), files: {} };

  for (const e of ENTRIES) {
    const srcPath = path.join(PUBLIC, e.src);
    if (!fs.existsSync(srcPath)) {
      console.warn("skip missing", e.src);
      continue;
    }
    const buf = fs.readFileSync(srcPath);
    const h = hashFile(buf);
    const ext = path.extname(e.src);
    const base = path.basename(e.src, ext);
    const hashedName = `${base}.${h}${ext}`;
    const relDir = path.dirname(e.src);
    const outDir = path.join(DIST, relDir);
    ensureDir(outDir);
    const outPath = path.join(outDir, hashedName);
    fs.writeFileSync(outPath, buf);
    const publicPath = `/dist/${relDir}/${hashedName}`.replace(/\\/g, "/");
    manifest.files[e.logical] = publicPath;
    console.log(e.logical, "→", publicPath);
  }

  const manPath = path.join(PUBLIC, "asset-manifest.json");
  fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2));
  console.log("wrote", manPath);
}

main();
