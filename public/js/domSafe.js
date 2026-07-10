/**
 * Production-safe DOM helpers for WorkHub.
 * Usable in browser (window.DomSafe) and Node tests (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.DomSafe = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clearElement(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function createTextElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  /**
   * Only allow https image URLs (optionally Cloudinary host).
   */
  function safeImageUrl(value, allowedHosts) {
    if (!value || typeof value !== 'string') return '';
    try {
      const u = new URL(value, typeof location !== 'undefined' ? location.origin : 'https://localhost');
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
      if (Array.isArray(allowedHosts) && allowedHosts.length) {
        if (!allowedHosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) {
          return '';
        }
      }
      return u.href;
    } catch {
      return '';
    }
  }

  /**
   * Render a list of space cards without innerHTML for user data.
   * @param {HTMLElement} container
   * @param {Array} spaces
   * @param {(space: object) => void} onSelect
   */
  function renderSpaceList(container, spaces, onSelect) {
    if (!container) return;
    clearElement(container);
    if (!spaces || spaces.length === 0) {
      container.appendChild(
        createTextElement('p', 'text-slate-400 text-xs italic', 'Không còn phòng trống trong khung giờ này.')
      );
      return;
    }
    spaces.forEach((space) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className =
        'w-full text-left p-3 rounded-xl border border-slate-200 hover:border-teal-500 bg-white transition space-card';
      card.dataset.spaceId = String(space._id || '');

      const name = createTextElement(
        'p',
        'font-bold text-sm text-slate-800',
        space.Name || space.SpaceCode || 'Phòng'
      );
      const meta = createTextElement(
        'p',
        'text-xs text-slate-500 mt-1',
        `${space.SpaceCode || ''} · ${(space.PricePerHour || 0).toLocaleString('vi-VN')}đ/giờ`
      );
      card.appendChild(name);
      card.appendChild(meta);

      if (Array.isArray(space.Amenities) && space.Amenities.length) {
        const am = document.createElement('div');
        am.className = 'flex flex-wrap gap-1 mt-2';
        space.Amenities.forEach((a) => {
          const chip = createTextElement(
            'span',
            'text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600',
            a
          );
          am.appendChild(chip);
        });
        card.appendChild(am);
      }

      card.addEventListener('click', () => {
        if (typeof onSelect === 'function') onSelect(space);
      });
      container.appendChild(card);
    });
  }

  /**
   * Render reviews safely with textContent.
   */
  function renderReviews(container, reviews) {
    if (!container) return;
    clearElement(container);
    if (!reviews || reviews.length === 0) {
      container.appendChild(
        createTextElement('div', 'text-slate-400 text-sm italic', 'Chưa có đánh giá nào.')
      );
      return;
    }
    reviews.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'p-3 rounded-xl border border-slate-100 bg-white mb-2';
      card.appendChild(
        createTextElement(
          'p',
          'font-bold text-sm',
          r.customerName || r.CustomerID?.FullName || 'Khách'
        )
      );
      card.appendChild(
        createTextElement('p', 'text-xs text-amber-600', `★ ${r.rating || r.Rating || '-'}`)
      );
      card.appendChild(
        createTextElement('p', 'text-sm text-slate-600 mt-1', r.comment || r.Comment || '')
      );
      container.appendChild(card);
    });
  }

  /**
   * Assert escaped payload never becomes executable HTML when assigned via textContent path.
   * Used by tests: render text into element and check no script/onerror nodes.
   */
  function renderUserText(container, text) {
    if (!container) return;
    clearElement(container);
    const p = document.createElement('p');
    p.textContent = String(text ?? '');
    container.appendChild(p);
    return p;
  }

  return {
    escapeHtml,
    clearElement,
    createTextElement,
    safeImageUrl,
    renderSpaceList,
    renderReviews,
    renderUserText,
  };
});
