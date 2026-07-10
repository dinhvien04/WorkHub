/**
 * Shared API client: cookie auth + CSRF + credentials.
 * Do not store JWT in localStorage.
 */
(function (global) {
  function getCookie(name) {
    const m = document.cookie.match(
      new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')
    );
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

  /**
   * @param {string} url
   * @param {RequestInit & { redirectOn401?: boolean }} options
   */
  async function api(url, options = {}) {
    const { redirectOn401 = true, headers: optHeaders, body: optBody, method: optMethod, ...rest } =
      options;

    const method = (optMethod || 'GET').toUpperCase();
    const headers = Object.assign({}, optHeaders || {});

    if (!headers['Content-Type'] && !(optBody instanceof FormData)) {
      if (optBody && typeof optBody === 'object' && !(optBody instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
      }
    }

    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const csrf = await ensureCsrf();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    let body = optBody;
    if (
      body &&
      typeof body === 'object' &&
      !(body instanceof FormData) &&
      headers['Content-Type'] === 'application/json'
    ) {
      body = JSON.stringify(body);
    }

    const res = await fetch(url, {
      ...rest,
      method,
      headers,
      body,
      credentials: 'same-origin',
    });

    if (res.status === 401 && redirectOn401) {
      const path = window.location.pathname + window.location.search;
      if (!path.startsWith('/login') && !path.startsWith('/register')) {
        if (!sessionStorage.getItem('auth_redirecting')) {
          sessionStorage.setItem('auth_redirecting', '1');
          const ret = encodeURIComponent(path);
          window.location.href = `/login?returnUrl=${ret}`;
        }
      }
    } else if (res.status !== 401) {
      sessionStorage.removeItem('auth_redirecting');
    }

    return res;
  }

  global.WorkHubAPI = { api, ensureCsrf, getCookie };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { api, ensureCsrf, getCookie };
  }
})(typeof window !== 'undefined' ? window : global);
