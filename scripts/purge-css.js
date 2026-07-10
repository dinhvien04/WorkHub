'use strict';

/**
 * Tailwind-less CSS purge (no PostCSS deps).
 * 1) Scan views and public/js for class tokens
 * 2) Keep utilities.css rules that match used classes (+ always keep base)
 * 3) Concat style.css + purged utilities, minify to public/css/app.min.css
 *
 * Usage: node scripts/purge-css.js
 *        npm run build:css
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const cssDir = path.join(root, 'public', 'css');

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(p, exts, out);
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(p);
    }
  }
  return out;
}

function extractClasses(text) {
  const set = new Set();
  // class="a b c" / className='a b'
  const reAttr = /class(?:Name)?\s*=\s*["'`]([^"'`]+)["'`]/g;
  let m;
  while ((m = reAttr.exec(text))) {
    m[1].split(/\s+/).forEach((c) => c && set.add(c));
  }
  // classList.add('x') / classList.toggle("y")
  const reList = /classList\.(?:add|remove|toggle|contains)\(\s*['"]([^'"]+)['"]/g;
  while ((m = reList.exec(text))) set.add(m[1]);
  // Tailwind-like in template strings: 'bg-white border rounded-2xl'
  const reStr = /['"`]([a-zA-Z0-9_.:\/\[\]%-]{2,}(?:\s+[a-zA-Z0-9_.:\/\[\]%-]{2,})+)['"`]/g;
  while ((m = reStr.exec(text))) {
    m[1].split(/\s+/).forEach((c) => {
      if (/^[a-zA-Z0-9_.:\/\[\]%-]+$/.test(c) && c.includes('-') || c.length > 2) {
        if (!c.includes('://') && !c.includes('=')) set.add(c);
      }
    });
  }
  return set;
}

function collectUsedClasses() {
  const files = [
    ...walk(path.join(root, 'views'), ['.ejs', '.html']),
    ...walk(path.join(root, 'public', 'js'), ['.js']),
  ];
  const used = new Set([
    // always keep structural
    'app-wrapper',
    'header',
    'main-container',
    'sidebar',
    'content-area',
    'nav-item',
    'skip-link',
    'mobile-bottom-nav',
    'mob-nav-item',
    'btn-primary',
    'btn-danger',
    'empty-state',
    'error-state',
    'skeleton',
    'wh-container',
    'wh-card',
    'wh-h1',
    'wh-muted',
    'wh-map',
    'wh-badge',
    'wh-btn',
    'wh-btn-primary',
    'wh-btn-ghost',
  ]);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const c of extractClasses(text)) used.add(c);
  }
  return used;
}

/**
 * Very small CSS rule splitter — handles simple selectors (no nested @media split fidelity for nested).
 */
function purgeUtilities(css, used) {
  // Preserve @media blocks by recursive-ish split
  let out = '';
  // Extract base reset (everything before first .class or @media with classes)
  const mediaBlocks = [];
  const withoutMedia = css.replace(/@media[^{]+\{[\s\S]*?\n\}/g, (block) => {
    mediaBlocks.push(block);
    return '\n/*__MEDIA__*/\n';
  });

  function keepSelector(sel) {
    // keep element/universal resets
    if (/^(\*|html|body|button|input|select|textarea|a|img|svg|video)\b/.test(sel.trim())) {
      return true;
    }
    // extract class tokens .foo .bar:hover
    const classes = sel.match(/\.([a-zA-Z0-9_\\:-]+)/g) || [];
    if (!classes.length) return true;
    return classes.some((c) => {
      const name = c
        .slice(1)
        .replace(/\\:/g, ':')
        .replace(/\\\//g, '/')
        .replace(/\\\[/g, '[')
        .replace(/\\\]/g, ']')
        .split(':')[0]
        .split('[')[0];
      // hover\:bg-teal-700 → need full token with hover:
      const full = c
        .slice(1)
        .replace(/\\:/g, ':')
        .replace(/\\\//g, '/')
        .replace(/\\\[/g, '[')
        .replace(/\\\]/g, ']');
      if (used.has(full) || used.has(name)) return true;
      // match hover:bg-x when used has hover:bg-x
      for (const u of used) {
        if (full === u || full.endsWith(u) || u.endsWith(name)) return true;
      }
      return false;
    });
  }

  function purgeBlock(blockCss) {
    let result = '';
    // split rules
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(blockCss))) {
      const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      const body = m[2].trim();
      if (!body) continue;
      const kept = selectors.filter(keepSelector);
      if (kept.length) result += `${kept.join(',')}{${body}}`;
    }
    return result;
  }

  out += purgeBlock(withoutMedia.replace(/\/\*__MEDIA__\*\//g, ''));

  for (const media of mediaBlocks) {
    const headerMatch = media.match(/^(@media[^{]+)\{([\s\S]*)\}$/);
    if (!headerMatch) continue;
    const inner = purgeBlock(headerMatch[2]);
    if (inner) out += `${headerMatch[1]}{${inner}}`;
  }
  return out;
}

function minify(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>~+])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

function main() {
  const used = collectUsedClasses();
  const utilitiesPath = path.join(cssDir, 'utilities.css');
  const stylePath = path.join(cssDir, 'style.css');
  const utilities = fs.existsSync(utilitiesPath) ? fs.readFileSync(utilitiesPath, 'utf8') : '';
  const style = fs.existsSync(stylePath) ? fs.readFileSync(stylePath, 'utf8') : '';

  const purged = purgeUtilities(utilities, used);
  const purgedPath = path.join(cssDir, 'utilities.purged.css');
  fs.writeFileSync(purgedPath, purged);

  const combined = `/* purged utilities */\n${purged}\n/* style */\n${style}\n`;
  const min = minify(combined);
  const out = path.join(cssDir, 'app.min.css');
  fs.writeFileSync(out, min);

  console.log(
    `Purge CSS: ${used.size} class tokens scanned; ` +
      `utilities ${Buffer.byteLength(utilities)} → ${Buffer.byteLength(purged)} bytes; ` +
      `app.min.css ${Buffer.byteLength(min)} bytes`
  );
}

main();
