'use strict';

/**
 * Lightweight SBOM-ish inventory from package-lock.json (CycloneDX-lite JSON).
 * Usage: node scripts/generate-sbom.js
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const lockPath = path.join(root, 'package-lock.json');
const pkgPath = path.join(root, 'package.json');
const outDir = path.join(root, 'docs');
const outPath = path.join(outDir, 'sbom.json');

if (!fs.existsSync(lockPath)) {
  console.error('package-lock.json not found');
  process.exit(1);
}

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const components = [];
const packages = lock.packages || {};
for (const [key, meta] of Object.entries(packages)) {
  if (!key || key === '') continue; // root
  const name = key.startsWith('node_modules/')
    ? key.replace(/^node_modules\//, '').replace(/\/node_modules\//g, '>')
    : key;
  components.push({
    type: 'library',
    name: meta.name || name,
    version: meta.version || null,
    purl: meta.version
      ? `pkg:npm/${encodeURIComponent(meta.name || name)}@${meta.version}`
      : undefined,
    dev: !!meta.dev,
    license: meta.license || undefined,
  });
}

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      name: pkg.name,
      version: pkg.version,
    },
    tools: [{ name: 'workhub-generate-sbom', version: '1.0.0' }],
  },
  components: components.sort((a, b) => String(a.name).localeCompare(String(b.name))),
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(sbom, null, 2));
console.log(`Wrote ${outPath} (${components.length} components)`);
