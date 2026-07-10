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
  /\son(?:click|error|load|change|submit|mouseover|focus|blur)\s*=/i;

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

console.log("Critical UI modules clean of inline handlers (" + CRITICAL.length + " files).");
if (failed) process.exit(1);
process.exit(0);
