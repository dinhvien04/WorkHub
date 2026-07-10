'use strict';

/**
 * Minimal CSS minifier (no PostCSS deps).
 * Prefer: npm run build:css → scripts/purge-css.js (purge + minify).
 * This script keeps full utilities (no purge).
 * Usage: node scripts/minify-css.js
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(process.cwd(), 'public', 'css');
const inputs = ['utilities.css', 'style.css'];

function minify(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>~+])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

let combined = '';
for (const f of inputs) {
  const p = path.join(dir, f);
  if (fs.existsSync(p)) combined += `\n/* ${f} */\n` + fs.readFileSync(p, 'utf8');
}

const out = path.join(dir, 'app.min.css');
const min = minify(combined);
fs.writeFileSync(out, min);
console.log(`Wrote ${out} (${Buffer.byteLength(min)} bytes, from ${Buffer.byteLength(combined)} raw)`);
