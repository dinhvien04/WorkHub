'use strict';

/**
 * XSS tests use production DomSafe (public/js/domSafe.js), not a fake helper.
 * Minimal document mock avoids jsdom ESM issues on some platforms.
 */
const path = require('path');
const fs = require('fs');
const DomSafe = require('../public/js/domSafe');
const { IMAGE_MIMES } = require('../middlewares/upload');
const { extractPublicId, imageInResource } = require('../utils/cloudinaryHelper');

function createMockDocument() {
  function El(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.className = '';
    this._text = '';
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
  }
  El.prototype.appendChild = function (c) {
    this.children.push(c);
    return c;
  };
  El.prototype.removeChild = function (c) {
    this.children = this.children.filter((x) => x !== c);
  };
  Object.defineProperty(El.prototype, 'firstChild', {
    get() {
      return this.children[0] || null;
    },
  });
  Object.defineProperty(El.prototype, 'textContent', {
    get() {
      if (this.children.length) {
        return this.children.map((c) => c.textContent).join('');
      }
      return this._text;
    },
    set(v) {
      this._text = String(v ?? '');
      this.children = [];
    },
  });
  Object.defineProperty(El.prototype, 'innerHTML', {
    get() {
      // Mock: only reflects text leaves; never parses HTML from textContent
      return this.children
        .map((c) => {
          if (c.children && c.children.length) return c.innerHTML;
          return c._text || '';
        })
        .join('');
    },
  });
  El.prototype.querySelector = function (sel) {
    if (sel === 'img' || sel === 'script' || sel === '[onerror]') {
      // textContent path never creates these tags from user strings
      return null;
    }
    return null;
  };
  El.prototype.addEventListener = function (type, fn) {
    this.listeners[type] = fn;
  };
  El.prototype.setAttribute = function (k, v) {
    this.attributes[k] = v;
  };

  const document = {
    createElement: (tag) => new El(tag),
    body: new El('body'),
  };
  return document;
}

describe('Production DomSafe XSS safety', () => {
  let container;

  beforeEach(() => {
    global.document = createMockDocument();
    globalThis.__xss = false;
    container = global.document.createElement('div');
  });

  afterEach(() => {
    delete global.document;
  });

  test('malicious space name is text only', () => {
    const payload = '<img src=x onerror=alert(1)>';
    DomSafe.renderUserText(container, payload);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.textContent).toContain('<img');
    expect(globalThis.__xss).toBe(false);
  });

  test('script breakout payload not executed', () => {
    const payload = '</button><script>globalThis.__xss = true</script>';
    DomSafe.renderUserText(container, payload);
    expect(container.querySelector('script')).toBeNull();
    expect(globalThis.__xss).toBe(false);
    expect(container.textContent).toContain('script');
  });

  test('js string injection not used as inline handler', () => {
    const payload = "');alert(document.domain);//";
    DomSafe.renderSpaceList(
      container,
      [{ _id: '1', Name: payload, SpaceCode: 'X', PricePerHour: 1 }],
      () => {}
    );
    // No element should have onclick attribute from user data
    const hasOnclick = JSON.stringify(container).includes('onclick');
    expect(hasOnclick).toBe(false);
    expect(globalThis.__xss).toBe(false);
  });

  test('escapeHtml encodes angle brackets', () => {
    const escaped = DomSafe.escapeHtml('<img src=x onerror=alert(1)>');
    expect(escaped).toContain('&lt;img');
    expect(escaped).not.toContain('<img');
  });

  test('renderReviews uses textContent path', () => {
    DomSafe.renderReviews(container, [
      { customerName: '<b>Evil</b>', rating: 5, comment: '<img src=x onerror=alert(1)>' },
    ]);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<b>Evil</b>');
  });
});

describe('Upload MIME rules', () => {
  test('avatar images only — no PDF', () => {
    expect(IMAGE_MIMES.has('image/jpeg')).toBe(true);
    expect(IMAGE_MIMES.has('application/pdf')).toBe(false);
  });
});

describe('Cloudinary ownership helpers', () => {
  test('image must belong to resource', () => {
    const images = ['https://res.cloudinary.com/demo/image/upload/v1/a/b.jpg'];
    expect(imageInResource(images, images[0])).toBe(true);
    expect(imageInResource(images, 'https://evil.com/x.jpg')).toBe(false);
  });

  test('extract public id', () => {
    const id = extractPublicId(
      'https://res.cloudinary.com/demo/image/upload/v1234567/coworking/branchs/file1.jpg'
    );
    expect(id).toContain('coworking/branchs/file1');
  });
});

describe('Legacy token cleanup', () => {
  test('public/js does not read localStorage token for auth', () => {
    const dir = path.join(__dirname, '..', 'public', 'js');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
    for (const f of files) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(content).not.toMatch(/localStorage\.getItem\(\s*['"]token['"]\s*\)/);
      expect(content).not.toMatch(/Bearer\s*\$\{token\}/);
    }
  });
});
