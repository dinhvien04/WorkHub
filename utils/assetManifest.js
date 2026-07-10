'use strict';

const fs = require('fs');
const path = require('path');

let cache = null;

function loadManifest() {
  if (cache) return cache;
  const p = path.join(__dirname, '../public/asset-manifest.json');
  try {
    cache = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    cache = { files: {} };
  }
  return cache;
}

/** Resolve logical asset path → hashed path if present. */
function assetUrl(logical) {
  const m = loadManifest();
  return (m.files && m.files[logical]) || `/${logical}`;
}

function clearCache() {
  cache = null;
}

module.exports = { assetUrl, loadManifest, clearCache };
