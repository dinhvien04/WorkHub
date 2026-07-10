'use strict';

/**
 * Responsive image helpers (Cloudinary-aware; pass-through otherwise).
 */

const CLOUDINARY_UPLOAD = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload)\/(.*)$/i;

/**
 * Inject Cloudinary transformation segment after /upload/
 * @param {string} url
 * @param {object} opts
 * @param {number} [opts.w]
 * @param {number} [opts.h]
 * @param {string} [opts.c='fill']
 * @param {string} [opts.f='auto'] auto | webp | avif | jpg
 * @param {string} [opts.q='auto']
 */
function transform(url, opts = {}) {
  if (!url || typeof url !== 'string') return '';
  const m = url.match(CLOUDINARY_UPLOAD);
  if (!m) return url;
  const parts = [];
  if (opts.f) parts.push(`f_${opts.f}`);
  if (opts.q) parts.push(`q_${opts.q}`);
  if (opts.w) parts.push(`w_${Number(opts.w)}`);
  if (opts.h) parts.push(`h_${Number(opts.h)}`);
  if (opts.c) parts.push(`c_${opts.c}`);
  const tf = parts.join(',');
  // Avoid double-transform if already transformed
  if (/^[a-z0-9_,]+\/v\d+\//i.test(m[2]) || /^[a-z0-9_,]+\//i.test(m[2])) {
    // Still prepend a new transform layer — Cloudinary stacks them
  }
  return `${m[1]}/${tf}/${m[2]}`;
}

function isCloudinary(url) {
  return CLOUDINARY_UPLOAD.test(String(url || ''));
}

/**
 * Build srcset string for widths.
 */
function srcset(url, widths = [400, 800, 1200], opts = {}) {
  if (!url) return '';
  if (!isCloudinary(url)) return `${url} ${widths[widths.length - 1] || 1200}w`;
  return widths
    .map((w) => `${transform(url, { ...opts, w, f: opts.f || 'auto', q: opts.q || 'auto', c: opts.c || 'fill' })} ${w}w`)
    .join(', ');
}

/**
 * Picture sources for AVIF/WebP when Cloudinary; fallback img.
 */
function pictureSources(url, { widths = [400, 800, 1200], sizes = '(max-width: 768px) 100vw, 800px', h } = {}) {
  const fallback = isCloudinary(url)
    ? transform(url, { w: widths[widths.length - 1] || 1200, h, f: 'auto', q: 'auto', c: 'fill' })
    : url;
  return {
    url: url || '',
    isCloudinary: isCloudinary(url),
    avifSrcset: isCloudinary(url) ? srcset(url, widths, { f: 'avif', h, c: 'fill' }) : '',
    webpSrcset: isCloudinary(url) ? srcset(url, widths, { f: 'webp', h, c: 'fill' }) : '',
    autoSrcset: srcset(url, widths, { f: 'auto', h, c: 'fill' }),
    sizes,
    fallback,
  };
}

module.exports = {
  transform,
  srcset,
  pictureSources,
  isCloudinary,
};
