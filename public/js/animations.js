/* global IntersectionObserver, MutationObserver */
'use strict';
/**
 * animations.js — WorkHub micro-interactions and animation system
 * Loaded on every page via layout.ejs (deferred, after main.js)
 *
 * Respects prefers-reduced-motion throughout.
 * Does not interfere with server-side security (no XSS vectors, CSP-safe).
 */

(function () {
  // ─── Motion preference ─────────────────────────────────────────────────────
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ─── Utility ───────────────────────────────────────────────────────────────
  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  // ─── 1. Scroll-triggered reveal ────────────────────────────────────────────
  function initScrollReveal() {
    if (prefersReduced) {
      // Show all without animation
      document.querySelectorAll('.reveal-on-scroll').forEach(function (el) {
        el.classList.add('revealed');
        el.style.opacity = '';
      });
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      document.querySelectorAll('.reveal-on-scroll').forEach(function (el) {
        el.classList.add('revealed');
      });
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll('.reveal-on-scroll').forEach(function (el) {
      observer.observe(el);
    });
  }

  // ─── 2. Sidebar nav stagger entrance ──────────────────────────────────────
  function staggerNavItems() {
    if (prefersReduced) return;
    var menuItems = document.getElementById('menu-items');
    if (!menuItems) return;

    function animateItems() {
      var items = menuItems.querySelectorAll('.nav-item');
      items.forEach(function (item, idx) {
        item.style.animationDelay = idx * 40 + 'ms';
        item.classList.add('nav-item-enter');
        item.addEventListener(
          'animationend',
          function () {
            item.classList.remove('nav-item-enter');
            item.style.animationDelay = '';
          },
          { once: true }
        );
      });
    }

    // Watch for menu items being populated (renderMenu is called after auth check)
    if (typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(function () {
        if (menuItems.children.length > 0) {
          mo.disconnect();
          setTimeout(animateItems, 50);
        }
      });
      mo.observe(menuItems, { childList: true });
    }
    // Fallback: also try after 300ms in case renderMenu already ran
    setTimeout(function () {
      if (menuItems.children.length > 0) animateItems();
    }, 300);
  }

  // ─── 3. Enhanced modal animations ─────────────────────────────────────────
  function initModalAnimations() {
    if (prefersReduced) return;
    // Patch openModal / closeModal defined in main.js
    var _origOpen = window.openModal;
    var _origClose = window.closeModal;

    if (typeof _origOpen === 'function') {
      window.openModal = function (id) {
        _origOpen(id);
        var el = document.getElementById(id);
        if (!el) return;
        var content = el.querySelector('.modal-content-animate');
        if (content) {
          content.classList.remove('modal-leaving');
          content.classList.add('modal-entering');
          content.addEventListener(
            'animationend',
            function () {
              content.classList.remove('modal-entering');
            },
            { once: true }
          );
        }
      };
    }

    if (typeof _origClose === 'function') {
      window.closeModal = function (id) {
        var el = document.getElementById(id);
        if (!el) { _origClose(id); return; }
        var content = el.querySelector('.modal-content-animate');
        if (!content) { _origClose(id); return; }
        content.classList.remove('modal-entering');
        content.classList.add('modal-leaving');
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          _origClose(id);
        }
        content.addEventListener('animationend', finish, { once: true });
        setTimeout(finish, 350); // fallback
      };
    }
  }

  // ─── 4. Enhanced showToast ─────────────────────────────────────────────────
  function initToast() {
    var _orig = window.showToast;
    window.showToast = function (msg, type) {
      var t = document.getElementById('success-toast');
      var m = document.getElementById('toast-msg');
      if (!t || !m) {
        if (typeof _orig === 'function') _orig(msg, type);
        return;
      }
      m.textContent = msg;
      // Remove previous state
      t.classList.remove('hidden', 'toast-error', 'toast-warning', 'toast-success', 'toast-exit');
      // Set variant
      if (type === 'error') t.classList.add('toast-error');
      else if (type === 'warning') t.classList.add('toast-warning');
      else t.classList.add('toast-success');
      // Trigger entrance animation
      if (!prefersReduced) {
        t.classList.add('toast-enter');
        t.addEventListener('animationend', function () {
          t.classList.remove('toast-enter');
        }, { once: true });
      }
      // Auto-dismiss after 3s
      var timer = setTimeout(function () {
        if (!prefersReduced) {
          t.classList.add('toast-exit');
          t.addEventListener('animationend', function () {
            t.classList.add('hidden');
            t.classList.remove('toast-exit');
          }, { once: true });
          setTimeout(function () {
            t.classList.add('hidden');
            t.classList.remove('toast-exit');
          }, 400);
        } else {
          t.classList.add('hidden');
        }
      }, 3000);
      // Allow clicking to dismiss
      t.onclick = function () {
        clearTimeout(timer);
        t.classList.add('hidden');
        t.onclick = null;
      };
    };
    // Expose type-specific helpers
    window.showError = function (msg) { window.showToast(msg, 'error'); };
    window.showWarning = function (msg) { window.showToast(msg, 'warning'); };
    window.showSuccess = function (msg) { window.showToast(msg, 'success'); };
  }

  // ─── 5. Button ripple effect ───────────────────────────────────────────────
  function initRipple() {
    if (prefersReduced) return;
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.wh-btn, .btn-primary, .btn-danger, .wh-btn-primary');
      if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
      // Ensure position relative
      var pos = window.getComputedStyle(btn).position;
      if (pos === 'static') btn.style.position = 'relative';
      btn.style.overflow = 'hidden';
      var rect = btn.getBoundingClientRect();
      var ripple = document.createElement('span');
      ripple.className = 'btn-ripple';
      var size = Math.max(rect.width, rect.height) * 2;
      ripple.style.cssText = [
        'position:absolute',
        'border-radius:50%',
        'background:rgba(255,255,255,0.3)',
        'width:' + size + 'px',
        'height:' + size + 'px',
        'left:' + (e.clientX - rect.left - size / 2) + 'px',
        'top:' + (e.clientY - rect.top - size / 2) + 'px',
        'transform:scale(0)',
        'animation:rippleEffect 0.55s ease-out forwards',
        'pointer-events:none',
        'z-index:1',
      ].join(';');
      btn.appendChild(ripple);
      ripple.addEventListener('animationend', function () {
        ripple.remove();
      });
    });
  }

  // ─── 6. Mobile bottom nav active state ────────────────────────────────────
  function initMobileNav() {
    var items = document.querySelectorAll('.mob-nav-item');
    var currentPath = window.location.pathname;
    items.forEach(function (item) {
      var href = item.getAttribute('href');
      if (href && (href === currentPath || (href !== '/' && currentPath.startsWith(href)))) {
        item.classList.add('active');
      }
      // Touch feedback
      if (!prefersReduced) {
        item.addEventListener('touchstart', function () {
          item.style.transform = 'scale(1.12) translateY(-3px)';
        }, { passive: true });
        item.addEventListener('touchend', function () {
          item.style.transform = '';
        }, { passive: true });
      }
    });
  }

  // ─── 7. Scroll-aware header ────────────────────────────────────────────────
  function initHeaderScroll() {
    var header = document.getElementById('app-header') || document.querySelector('.header');
    var contentArea = document.querySelector('.content-area');
    if (!header || !contentArea) return;
    var scrolled = false;
    contentArea.addEventListener('scroll', function () {
      var shouldScrolled = contentArea.scrollTop > 10;
      if (shouldScrolled !== scrolled) {
        scrolled = shouldScrolled;
        header.classList.toggle('header-scrolled', scrolled);
      }
    }, { passive: true });
  }

  // ─── 8. Count-up animation for stat numbers ───────────────────────────────
  function initCountUp() {
    var targets = document.querySelectorAll('[data-count-to]');
    if (!targets.length) return;
    if (prefersReduced) {
      targets.forEach(function (el) {
        var val = parseFloat(el.getAttribute('data-count-to')) || 0;
        el.textContent = val.toLocaleString('vi-VN');
      });
      return;
    }

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function animateCount(el) {
      var target = parseFloat(el.getAttribute('data-count-to')) || 0;
      var duration = parseInt(el.getAttribute('data-count-duration') || '1200', 10);
      var prefix = el.getAttribute('data-count-prefix') || '';
      var suffix = el.getAttribute('data-count-suffix') || '';
      var start = null;
      function step(ts) {
        if (!start) start = ts;
        var progress = Math.min((ts - start) / duration, 1);
        var eased = easeOutCubic(progress);
        var current = Math.round(eased * target);
        el.textContent = prefix + current.toLocaleString('vi-VN') + suffix;
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    if (typeof IntersectionObserver !== 'undefined') {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            obs.unobserve(entry.target);
            animateCount(entry.target);
          }
        });
      }, { threshold: 0.3 });
      targets.forEach(function (el) { obs.observe(el); });
    } else {
      targets.forEach(animateCount);
    }
  }

  // ─── 9. Image lazy-load fade-in ───────────────────────────────────────────
  function initLazyImages() {
    if (prefersReduced) return;
    document.querySelectorAll('img[loading="lazy"], img.lazy').forEach(function (img) {
      if (!img.complete) {
        img.style.opacity = '0';
        img.style.transition = 'opacity 0.3s ease';
        img.addEventListener('load', function () {
          img.style.opacity = '1';
        }, { once: true });
        img.addEventListener('error', function () {
          img.style.opacity = '1';
        }, { once: true });
      }
    });
  }

  // ─── 10. Page transition ──────────────────────────────────────────────────
  function initPageTransition() {
    if (prefersReduced) return;
    // Entrance animation
    var body = document.body;
    body.classList.add('page-entering');
    setTimeout(function () {
      body.classList.remove('page-entering');
    }, 500);

    // Exit animation on navigation
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href]');
      if (!link) return;
      var href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
      if (link.target === '_blank' || link.hasAttribute('download')) return;
      try {
        var url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
      } catch (_) { return; }
      e.preventDefault();
      var contentArea = document.querySelector('.content-area');
      if (contentArea) contentArea.classList.add('page-exiting');
      setTimeout(function () {
        window.location.href = href;
      }, 150);
    });
  }

  // ─── 11. Subtle card tilt on desktop ──────────────────────────────────────
  function initCardTilt() {
    if (prefersReduced) return;
    var isMobile = window.matchMedia('(hover: none)').matches;
    if (isMobile) return;
    document.querySelectorAll('.wh-card-interactive').forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width - 0.5;
        var y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = [
          'perspective(800px)',
          'rotateX(' + (-y * 3) + 'deg)',
          'rotateY(' + (x * 3) + 'deg)',
          'translateZ(4px)',
        ].join(' ');
      });
      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
        card.style.transition = 'transform 0.4s ease';
        setTimeout(function () { card.style.transition = ''; }, 400);
      });
    });
  }

  // ─── 12. Dropdown menu animation ──────────────────────────────────────────
  function initDropdowns() {
    if (prefersReduced) return;
    var dropdown = document.getElementById('dropdown-menu');
    if (!dropdown) return;
    // Observe class changes to add entrance animation
    if (typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(function () {
        if (!dropdown.classList.contains('hidden')) {
          dropdown.classList.add('dropdown-entering');
          dropdown.addEventListener('animationend', function () {
            dropdown.classList.remove('dropdown-entering');
          }, { once: true });
        }
      });
      mo.observe(dropdown, { attributes: true, attributeFilter: ['class'] });
    }
  }

  // ─── Inject keyframe for ripple (needed for dynamic elements) ─────────────
  function injectRippleStyle() {
    if (document.getElementById('wh-ripple-style')) return;
    var style = document.createElement('style');
    style.id = 'wh-ripple-style';
    style.textContent = '@keyframes rippleEffect{to{transform:scale(1);opacity:0}}';
    document.head.appendChild(style);
  }

  // ─── Bootstrap ─────────────────────────────────────────────────────────────
  onReady(function () {
    injectRippleStyle();
    initScrollReveal();
    staggerNavItems();
    initModalAnimations();
    initToast();
    initRipple();
    initMobileNav();
    initHeaderScroll();
    initCountUp();
    initLazyImages();
    initPageTransition();
    initCardTilt();
    initDropdowns();
  });
})();
