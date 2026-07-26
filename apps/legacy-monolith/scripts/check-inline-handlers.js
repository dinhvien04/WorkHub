"use strict";

/**
 * CI guard: reject inline event handlers in critical frontend modules.
 */
const fs = require("fs");
const path = require("path");

const CRITICAL = [
  "public/js/api.js",
  "public/js/domSafe.js",
  "public/js/security.js",
  "public/js/booking-wizard.js",
  "public/js/gateway-checkout.js",
  "public/js/customer-history.js",
  "public/js/gallery-lightbox.js",
  "public/js/host-spaces.js",
  "public/js/login.js",
  "public/js/register.js",
];

const INLINE_RE =
  /\son(?:click|error|load|change|submit|input|mouseover|focus|blur)\s*=/i;

let failed = false;
for (const rel of CRITICAL) {
  const p = path.join(process.cwd(), rel);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, "utf8");
  if (INLINE_RE.test(text)) {
    console.error(`FAIL: inline handler in critical file ${rel}`);
    failed = true;
  }
  if (
    (rel.endsWith("customer-history.js") || rel.endsWith("host-spaces.js")) &&
    /innerHTML\s*=\s*[`'"][\s\S]{0,40}<button[^>]*onclick/i.test(text)
  ) {
    console.error(`FAIL: template innerHTML with onclick in ${rel}`);
    failed = true;
  }
}

const layout = path.join(process.cwd(), "views/layout.ejs");
if (fs.existsSync(layout)) {
  const t = fs.readFileSync(layout, "utf8");
  if (/onerror\s*=/.test(t)) {
    console.error("FAIL: inline onerror in views/layout.ejs");
    failed = true;
  }
}

// All EJS views: no remaining onclick/onchange/onerror
function walkViews(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walkViews(p, acc);
    else if (name.endsWith(".ejs")) acc.push(p);
  }
  return acc;
}
const viewsDir = path.join(process.cwd(), "views");
if (fs.existsSync(viewsDir)) {
  for (const vp of walkViews(viewsDir)) {
    const t = fs.readFileSync(vp, "utf8");
    if (INLINE_RE.test(t) || /\sonerror\s*=/i.test(t)) {
      console.error(
        "FAIL: inline handler in",
        path.relative(process.cwd(), vp),
      );
      failed = true;
    }
  }
}

if (!fs.existsSync(path.join(process.cwd(), "public/js/ui-bind.js"))) {
  console.error("FAIL: public/js/ui-bind.js missing");
  failed = true;
}
/**
 * Every file upload must go through the validation chain.
 *
 * `upload.single(...)` / `upload.array(...)` are the bare multer handlers: the
 * only check they run is fileFilter, which trusts the Content-Type the client
 * wrote into its own multipart part. `singleWithMagic` / `arrayWithMagic`
 * expand to [multer, magic-byte check, malware scan, storage] and are the only
 * forms that belong in a route.
 *
 * The customer avatar route used the bare form for two years because the two
 * spellings look identical at the call site.
 */
const BARE_UPLOAD_RE = /\bupload\.(single|array)\s*\(/;
const routesDir = path.join(process.cwd(), "routes");

if (fs.existsSync(routesDir)) {
  let routeFiles = 0;
  for (const name of fs.readdirSync(routesDir)) {
    if (!name.endsWith(".js")) continue;
    routeFiles++;
    const routeLines = fs
      .readFileSync(path.join(routesDir, name), "utf8")
      .split(/\r?\n/);

    routeLines.forEach((line, i) => {
      // A line that also names the safe helper is the authRoutes fallback,
      // which only reaches the bare form when singleWithMagic is unavailable.
      if (
        line.includes("upload.singleWithMagic") ||
        line.includes("upload.arrayWithMagic")
      ) {
        return;
      }
      if (BARE_UPLOAD_RE.test(line)) {
        console.error(
          "FAIL: bare multer handler bypasses the magic-byte + scan chain at " +
            "routes/" + name + ":" + (i + 1) + "\n      " + line.trim(),
        );
        failed = true;
      }
    });
  }
  console.log(
    "Upload routes checked for bypassed validation (" + routeFiles + " files).",
  );
}

console.log(
  "Critical UI modules clean of inline handlers (" +
    CRITICAL.length +
    " files).",
);
console.log("Views scanned for inline handlers.");
if (failed) process.exit(1);
process.exit(0);
