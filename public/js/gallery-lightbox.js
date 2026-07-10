'use strict';

/**
 * Branch gallery lightbox: click thumbnails, keyboard (Esc/←/→), focus return.
 */
(function initGalleryLightbox() {
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    const root = document.querySelector('[data-gallery]');
    if (!root) return;

    const urls = (root.getAttribute('data-gallery-urls') || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!urls.length) return;

    let index = 0;
    let lastFocus = null;
    let overlay = null;

    function ensureOverlay() {
      if (overlay) return overlay;
      overlay = document.createElement('div');
      overlay.id = 'gallery-lightbox';
      overlay.className = 'gallery-lightbox hidden';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Xem ảnh gallery');
      overlay.innerHTML =
        '<button type="button" class="gallery-lightbox__close" aria-label="Đóng">&times;</button>' +
        '<button type="button" class="gallery-lightbox__nav gallery-lightbox__prev" aria-label="Ảnh trước">&lsaquo;</button>' +
        '<img class="gallery-lightbox__img" alt="" />' +
        '<button type="button" class="gallery-lightbox__nav gallery-lightbox__next" aria-label="Ảnh sau">&rsaquo;</button>' +
        '<p class="gallery-lightbox__counter" aria-live="polite"></p>';
      document.body.appendChild(overlay);

      overlay.querySelector('.gallery-lightbox__close').addEventListener('click', close);
      overlay.querySelector('.gallery-lightbox__prev').addEventListener('click', function () {
        show(index - 1);
      });
      overlay.querySelector('.gallery-lightbox__next').addEventListener('click', function () {
        show(index + 1);
      });
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });
      return overlay;
    }

    function show(i) {
      if (!urls.length) return;
      index = ((i % urls.length) + urls.length) % urls.length;
      const el = ensureOverlay();
      const img = el.querySelector('.gallery-lightbox__img');
      img.src = urls[index];
      img.alt = 'Ảnh ' + (index + 1) + ' / ' + urls.length;
      el.querySelector('.gallery-lightbox__counter').textContent =
        index + 1 + ' / ' + urls.length;
      el.classList.remove('hidden');
      document.body.classList.add('gallery-lightbox-open');
      el.querySelector('.gallery-lightbox__close').focus();
    }

    function open(i) {
      lastFocus = document.activeElement;
      show(i);
    }

    function close() {
      if (!overlay) return;
      overlay.classList.add('hidden');
      document.body.classList.remove('gallery-lightbox-open');
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }

    root.querySelectorAll('[data-gallery-index]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const i = Number(btn.getAttribute('data-gallery-index') || 0);
        open(i);
      });
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(Number(btn.getAttribute('data-gallery-index') || 0));
        }
      });
    });

    document.addEventListener('keydown', function (e) {
      if (!overlay || overlay.classList.contains('hidden')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        show(index - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        show(index + 1);
      }
    });

    // Optional swipe on touch
    let touchX = null;
    document.addEventListener(
      'touchstart',
      function (e) {
        if (!overlay || overlay.classList.contains('hidden')) return;
        touchX = e.changedTouches[0].screenX;
      },
      { passive: true }
    );
    document.addEventListener(
      'touchend',
      function (e) {
        if (touchX == null || !overlay || overlay.classList.contains('hidden')) return;
        const dx = e.changedTouches[0].screenX - touchX;
        touchX = null;
        if (Math.abs(dx) < 40) return;
        if (dx > 0) show(index - 1);
        else show(index + 1);
      },
      { passive: true }
    );
  });
})();
