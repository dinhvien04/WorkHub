'use strict';

/**
 * Convert EJS inline onclick/onchange to data-wh-* attributes for ui-bind.js.
 */
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.ejs')) out.push(p);
  }
  return out;
}

function htmlAttrJson(value) {
  return JSON.stringify(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

function convertHandler(attrName, value) {
  const dataAttr = attrName === 'onchange' ? 'data-wh-change' : 'data-wh-click';
  let v = value.trim();
  while (v.endsWith(';')) v = v.slice(0, -1).trim();

  let stop = false;
  if (/event\.stopPropagation\(\)/.test(v)) {
    stop = true;
    v = v.replace(/;?\s*event\.stopPropagation\(\)/g, '').trim();
    while (v.endsWith(';')) v = v.slice(0, -1).trim();
  }

  if (v.includes(';')) {
    const parts = v
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      parts.length === 2 &&
      /^closeModal\(['"][^'"]+['"]\)$/.test(parts[0]) &&
      /^showToast\(['"][^'"]+['"]\)$/.test(parts[1])
    ) {
      const m1 = parts[0].match(/^closeModal\(['"]([^'"]+)['"]\)$/);
      const m2 = parts[1].match(/^showToast\(['"]([^'"]+)['"]\)$/);
      return (
        `${dataAttr}="closeModal" data-wh-args="${htmlAttrJson([m1[1]])}" ` +
        `data-wh-then="showToast" data-wh-then-args="${htmlAttrJson([m2[1]])}"`
      );
    }
    console.warn('Multi-statement partial:', v.slice(0, 100));
    v = parts[0];
  }

  const stopAttr = stop ? ' data-wh-stop="1"' : '';

  let m = v.match(/^([a-zA-Z_$][\w$]*)\(\s*event\s*\)$/);
  if (m) return `${dataAttr}="${m[1]}" data-wh-event="1"${stopAttr}`;

  m = v.match(/^([a-zA-Z_$][\w$]*)\(\s*this\s*\)$/);
  if (m) return `${dataAttr}="${m[1]}" data-wh-this="1"${stopAttr}`;

  m = v.match(/^([a-zA-Z_$][\w$]*)\(\s*(['"])(.*?)\2\s*,\s*this\s*\)$/);
  if (m) {
    return `${dataAttr}="${m[1]}" data-wh-args="${htmlAttrJson([m[3]])}" data-wh-this="1"${stopAttr}`;
  }

  m = v.match(/^([a-zA-Z_$][\w$]*)\(\s*(['"])(.*?)\2\s*\)$/);
  if (m) {
    return `${dataAttr}="${m[1]}" data-wh-args="${htmlAttrJson([m[3]])}"${stopAttr}`;
  }

  m = v.match(/^([a-zA-Z_$][\w$]*)\(\s*(-?\d+)\s*\)$/);
  if (m) {
    return `${dataAttr}="${m[1]}" data-wh-args="${htmlAttrJson([Number(m[2])])}"${stopAttr}`;
  }

  // fn(true) / fn(false)
  m = v.match(/^([a-zA-Z_$][\w$]*)\(\s*(true|false)\s*\)$/);
  if (m) {
    return `${dataAttr}="${m[1]}" data-wh-args="${htmlAttrJson([m[2] === 'true'])}"${stopAttr}`;
  }

  m = v.match(/^([a-zA-Z_$][\w$]*)\(\s*\)$/);
  if (m) return `${dataAttr}="${m[1]}"${stopAttr}`;

  m = v.match(/^alert\(\s*(['"])(.*?)\1\s*\)$/);
  if (m) return `${dataAttr}="alert" data-wh-args="${htmlAttrJson([m[2]])}"`;

  console.warn('UNHANDLED:', v);
  return null;
}

function transformFile(filePath) {
  let src = fs.readFileSync(filePath, 'utf8');
  let count = 0;

  src = src.replace(/\s(on(click|change))\s*=\s*"([^"]*)"/gi, (full, _on, kind, val) => {
    const attr = kind.toLowerCase() === 'change' ? 'onchange' : 'onclick';
    const converted = convertHandler(attr, val);
    if (!converted) return full;
    count += 1;
    return ' ' + converted;
  });

  src = src.replace(/\s(on(click|change))\s*=\s*'([^']*)'/gi, (full, _on, kind, val) => {
    const attr = kind.toLowerCase() === 'change' ? 'onchange' : 'onclick';
    const converted = convertHandler(attr, val);
    if (!converted) return full;
    count += 1;
    return ' ' + converted;
  });

  if (count) fs.writeFileSync(filePath, src);
  return count;
}

// Ensure ui-bind supports data-wh-then
const uiBindPath = path.join(__dirname, '../public/js/ui-bind.js');
let ui = fs.readFileSync(uiBindPath, 'utf8');
if (!ui.includes('data-wh-then')) {
  ui = ui.replace(
    'fn.apply(el, args);',
    `fn.apply(el, args);
    const thenName = el.getAttribute('data-wh-then');
    if (thenName && typeof root[thenName] === 'function') {
      let thenArgs = [];
      const rawThen = el.getAttribute('data-wh-then-args');
      if (rawThen) {
        try { thenArgs = JSON.parse(rawThen); } catch (e) { thenArgs = [rawThen]; }
      }
      root[thenName].apply(el, Array.isArray(thenArgs) ? thenArgs : [thenArgs]);
    }`
  );
  fs.writeFileSync(uiBindPath, ui);
}

const viewsDir = path.join(__dirname, '../views');
const files = walk(viewsDir);
let total = 0;
for (const f of files) {
  const n = transformFile(f);
  if (n) console.log(path.relative(process.cwd(), f), n);
  total += n;
}
console.log('converted handlers:', total);
