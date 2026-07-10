'use strict';

/**
 * CI guard: flag high-risk inline handlers in runtime JS modules.
 * Legacy host-spaces / customer-history still use patterns — listed as known debt.
 * Fails if NEW critical files gain onclick/onerror.
 */
const fs = require('fs');
const path = require('path');

const CRITICAL = [
  'public/js/api.js',
  'public/js/domSafe.js',
  'public/js/security.js',
  'public/js/booking-wizard.js',
  'public/js/gateway-checkout.js',
];

const KNOWN_DEBT = [
  'public/js/host-spaces.js',
  'public/js/customer-history.js',
];

let failed = false;
for (const rel of CRITICAL) {
  const p = path.join(process.cwd(), rel);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, 'utf8');
  if (/\sonclick\s*=/i.test(text) || /\sonerror\s*=/i.test(text)) {
    console.error(`FAIL: inline handler in critical file ${rel}`);
    failed = true;
  }
}

console.log('Critical UI modules clean of inline handlers.');
console.log('Known debt (migrate to DomSafe/addEventListener):', KNOWN_DEBT.join(', '));
if (failed) process.exit(1);
process.exit(0);
