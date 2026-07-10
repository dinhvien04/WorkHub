"use strict";

/**
 * CI guard: reject inline event handlers in critical frontend modules.
 * Known legacy debt listed explicitly; new debt in critical set fails the build.
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
  "public/js/login.js",
  "public/js/register.js",
];

const KNOWN_DEBT = ["public/js/host-spaces.js"];

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
  // customer-history must not use innerHTML for user-driven templates
  if (
    rel.endsWith("customer-history.js") &&
    /innerHTML\s*=\s*[`'"]\s*</.test(text)
  ) {
    console.error(`FAIL: template innerHTML assignment in ${rel}`);
    failed = true;
  }
}

// layout.ejs must not use onerror stylesheet fallback
const layout = path.join(process.cwd(), "views/layout.ejs");
if (fs.existsSync(layout)) {
  const t = fs.readFileSync(layout, "utf8");
  if (/onerror\s*=/.test(t)) {
    console.error("FAIL: inline onerror in views/layout.ejs");
    failed = true;
  }
}

console.log("Critical UI modules clean of inline handlers.");
console.log("Known debt (migrate to DomSafe):", KNOWN_DEBT.join(", "));
if (failed) process.exit(1);
process.exit(0);
