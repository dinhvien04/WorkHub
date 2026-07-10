'use strict';

/**
 * Client i18n: load /api/i18n, apply [data-i18n], language switcher.
 */
(function (global) {
  let lang = 'vi';
  let messages = {};

  async function load(forceLang) {
    const q = forceLang ? `?lang=${encodeURIComponent(forceLang)}` : '';
    const res = await fetch('/api/i18n' + q, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    lang = data.lang || 'vi';
    messages = data.messages || {};
    try {
      document.documentElement.lang = lang;
    } catch {
      /* ignore */
    }
    return { lang, messages };
  }

  function t(key, fallback) {
    return messages[key] || fallback || key;
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const val = t(key, el.textContent);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.getAttribute('data-i18n-attr') === 'placeholder') el.placeholder = val;
        else el.value = val;
      } else {
        el.textContent = val;
      }
    });
    // Update switcher active state
    document.querySelectorAll('[data-lang-set]').forEach((btn) => {
      const l = btn.getAttribute('data-lang-set');
      btn.classList.toggle('ring-2', l === lang);
      btn.classList.toggle('ring-teal-500', l === lang);
    });
  }

  async function setLang(next) {
    const res = await fetch('/api/i18n/lang', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: next }),
    });
    // CSRF may be required — try WorkHubAPI if available
    if (res.status === 403 && global.WorkHubAPI) {
      const r2 = await WorkHubAPI.api('/api/i18n/lang', {
        method: 'POST',
        body: { lang: next },
        redirectOn401: false,
      });
      const data = await r2.json().catch(() => ({}));
      if (r2.ok) {
        lang = data.lang || next;
        messages = data.messages || messages;
        apply();
        return lang;
      }
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      lang = data.lang || next;
      messages = data.messages || messages;
    } else {
      // Fallback: set cookie client-side for detectLang on next navigation
      document.cookie = 'lang=' + (next === 'en' ? 'en' : 'vi') + '; path=/; max-age=31536000; samesite=lax';
      await load(next);
    }
    apply();
    return lang;
  }

  function bindSwitcher() {
    document.querySelectorAll('[data-lang-set]').forEach((btn) => {
      btn.addEventListener('click', () => setLang(btn.getAttribute('data-lang-set')));
    });
  }

  async function init() {
    try {
      await load();
      apply();
      bindSwitcher();
    } catch {
      /* ignore */
    }
  }

  global.WorkHubI18n = { load, t, apply, setLang, init, getLang: () => lang };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : global);
