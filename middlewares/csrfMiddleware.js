'use strict';

const crypto = require('crypto');
const env = require('../config/env');
const { ForbiddenError } = require('../utils/errors');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function createCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Ensure CSRF cookie exists (readable by JS for double-submit).
 */
function ensureCsrfCookie(req, res, next) {
  const name = env.CSRF_COOKIE_NAME;
  if (!req.cookies || !req.cookies[name]) {
    const token = createCsrfToken();
    res.cookie(name, token, {
      httpOnly: false,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.locals.csrfToken = token;
  } else {
    res.locals.csrfToken = req.cookies[name];
  }
  next();
}

/**
 * Double-submit CSRF: require X-CSRF-Token header to match csrf cookie.
 * Also checks Origin/Referer for state-changing requests when present.
 */
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  // Skip CSRF for health and test bootstrap if needed
  if (req.path === '/health') return next();

  // Origin / Referer check when headers present
  const origin = req.get('origin');
  const referer = req.get('referer');
  const host = req.get('host');
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return next(new ForbiddenError('Origin không hợp lệ (CSRF).'));
      }
    } catch {
      return next(new ForbiddenError('Origin không hợp lệ (CSRF).'));
    }
  } else if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost !== host) {
        return next(new ForbiddenError('Referer không hợp lệ (CSRF).'));
      }
    } catch {
      return next(new ForbiddenError('Referer không hợp lệ (CSRF).'));
    }
  }

  const cookieToken = req.cookies && req.cookies[env.CSRF_COOKIE_NAME];
  const headerToken = req.get('x-csrf-token') || req.get('x-xsrf-token') || (req.body && req.body._csrf);

  // In test env allow missing CSRF when explicitly disabled
  if (process.env.DISABLE_CSRF === '1') return next();

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(new ForbiddenError('Thiếu hoặc sai CSRF token.'));
  }
  return next();
}

module.exports = { ensureCsrfCookie, csrfProtection, createCsrfToken };
