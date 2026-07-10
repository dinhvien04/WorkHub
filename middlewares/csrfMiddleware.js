'use strict';

const crypto = require('crypto');
const env = require('../config/env');
const { ForbiddenError } = require('../utils/errors');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Signed CSRF token: random payload + HMAC(session secret).
 * Cookie holds the token; header must match exactly (double-submit + signature).
 */
function signToken(raw) {
  const secret = env.SESSION_SECRET || env.JWT_SECRET;
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return `${raw}.${sig}`;
}

function verifySignedToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [raw, sig] = token.split('.');
  if (!raw || !sig) return false;
  const secret = env.SESSION_SECRET || env.JWT_SECRET;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function createCsrfToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return signToken(raw);
}

function ensureCsrfCookie(req, res, next) {
  if (res.locals.csrfToken) return next();

  const name = env.CSRF_COOKIE_NAME;
  const existing = req.cookies && req.cookies[name];
  if (existing && verifySignedToken(existing)) {
    res.locals.csrfToken = existing;
    return next();
  }

  const token = createCsrfToken();
  res.cookie(name, token, {
    httpOnly: false,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.locals.csrfToken = token;
  return next();
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.path === '/health' || req.path.startsWith('/health/')) return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  const host = req.get('host');
  if (origin) {
    try {
      if (new URL(origin).host !== host) {
        return next(new ForbiddenError('Origin không hợp lệ (CSRF).'));
      }
    } catch {
      return next(new ForbiddenError('Origin không hợp lệ (CSRF).'));
    }
  } else if (referer) {
    try {
      if (new URL(referer).host !== host) {
        return next(new ForbiddenError('Referer không hợp lệ (CSRF).'));
      }
    } catch {
      return next(new ForbiddenError('Referer không hợp lệ (CSRF).'));
    }
  }

  if (process.env.DISABLE_CSRF === '1' && process.env.ALLOW_DISABLE_CSRF === '1') {
    return next();
  }

  const cookieToken = req.cookies && req.cookies[env.CSRF_COOKIE_NAME];
  const headerToken =
    req.get('x-csrf-token') || req.get('x-xsrf-token') || (req.body && req.body._csrf);

  if (
    !cookieToken ||
    !headerToken ||
    cookieToken !== headerToken ||
    !verifySignedToken(cookieToken)
  ) {
    return next(new ForbiddenError('Thiếu hoặc sai CSRF token.'));
  }
  return next();
}

module.exports = {
  ensureCsrfCookie,
  csrfProtection,
  createCsrfToken,
  verifySignedToken,
  signToken,
};
