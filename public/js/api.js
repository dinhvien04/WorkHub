/**
 * Shared API client: cookie auth + CSRF + credentials.
 * Do not store JWT in localStorage.
 */
(function (global) {
  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function ensureCsrf() {
    let token = getCookie('csrfToken');
    if (!token) {
      try {
        const res = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
        const data = await res.json();
        token = data.csrfToken || getCookie('csrfToken');
      } catch {
        /* ignore */
      }
    }
    return token;
  }

  async function api(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = Object.assign({}, options.headers || {});

    if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
      if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
      }
    }

    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const csrf = await ensureCsrf();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData) && headers['Content-Type'] === 'application/json') {
      body = JSON.stringify(body);
    }

    const res = await fetch(url, {
      ...options,
      method,
      headers,
      body,
      credentials: 'same-origin',
    });

    if (res.status === 401) {
      const path = window.location.pathname;
      if (!path.startsWith('/login') && !path.startsWith('/register')) {
        // Avoid redirect loops
        if (!sessionStorage.getItem('auth_redirecting')) {
          sessionStorage.setItem('auth_redirecting', '1');
          window.location.href = '/login';
        }
      }
    } else {
      sessionStorage.removeItem('auth_redirecting');
    }

    return res;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setText(el, text) {
    if (el) el.textContent = text == null ? '' : String(text);
  }

  /** Safe text node helper for dynamic lists */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  global.WorkHubAPI = { api, ensureCsrf, getCookie, escapeHtml, setText, el };
})(window);
