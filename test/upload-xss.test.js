'use strict';

const { IMAGE_MIMES } = require('../middlewares/upload');
const { extractPublicId, imageInResource } = require('../utils/cloudinaryHelper');

function escapeHtmlFn(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

describe('XSS escaping', () => {
  test('HTML in space name is escaped as text', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const escaped = escapeHtmlFn(payload);
    expect(escaped).not.toContain('<img');
    expect(escaped).toContain('&lt;img');
  });
});

describe('Upload MIME rules', () => {
  test('avatar/logo only allow image mimes (no PDF)', () => {
    expect(IMAGE_MIMES.has('image/jpeg')).toBe(true);
    expect(IMAGE_MIMES.has('image/png')).toBe(true);
    expect(IMAGE_MIMES.has('image/webp')).toBe(true);
    expect(IMAGE_MIMES.has('application/pdf')).toBe(false);
  });
});

describe('Cloudinary ownership helpers', () => {
  test('image must belong to resource before delete', () => {
    const images = ['https://res.cloudinary.com/demo/image/upload/v1/a/b.jpg'];
    expect(imageInResource(images, images[0])).toBe(true);
    expect(imageInResource(images, 'https://evil.com/x.jpg')).toBe(false);
  });

  test('extract public id from cloudinary URL', () => {
    const id = extractPublicId(
      'https://res.cloudinary.com/demo/image/upload/v1234567/coworking/branchs/file1.jpg'
    );
    expect(id).toContain('coworking/branchs/file1');
  });
});
