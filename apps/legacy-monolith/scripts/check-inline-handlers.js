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

console.log(
  "Critical UI modules clean of inline handlers (" +
    CRITICAL.length +
    " files).",
);
console.log("Views scanned for inline handlers.");
if (failed) process.exit(1);
process.exit(0);
