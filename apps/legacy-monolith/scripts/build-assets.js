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
];

function hashFile(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function main() {
  ensureDir(DIST);
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
