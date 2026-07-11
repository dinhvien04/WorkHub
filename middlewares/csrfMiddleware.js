"use strict";

const crypto = require("crypto");
const env = require("../config/env");
const { ForbiddenError } = require("../utils/errors");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Session-bound CSRF: HMAC(sid|pre2fa|anonId + raw token).
 * Cookie holds signed token; header must match (double-submit + signature).
 */
function csrfSecret() {
  return env.CSRF_SECRET || env.SESSION_SECRET || env.JWT_SECRET;
}

function ensureAnonPreSession(req, res) {
  if (req.user?.sid || req.cookies?.preSession2fa) return;
  if (req.cookies?.csrfPreSession) return;
  const anon = crypto.randomBytes(16).toString("hex");
  req.cookies = req.cookies || {};
  req.cookies.csrfPreSession = anon;
  if (res) {
    res.cookie("csrfPreSession", anon, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60 * 1000,
    });
  }
}

function getBinding(req) {
  if (req.user?.sid) return `sid:${req.user.sid}`;
  const pre2fa = req.cookies?.preSession2fa;
  if (pre2fa) {
    const h = crypto
      .createHash("sha256")
      .update(String(pre2fa))
      .digest("hex")
      .slice(0, 32);
    return `pre2fa:${h}`;
  }
  const anon = req.cookies?.csrfPreSession || "anon-missing";
  return `anon:${anon}`;
}

function signToken(raw, binding = "") {
  const secret = csrfSecret();
  const payload = binding ? `${binding}.${raw}` : raw;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${raw}.${sig}`;
}

function verifySignedToken(token, binding = "") {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const lastDot = token.lastIndexOf(".");
  const raw = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  if (!raw || !sig) return false;
  const secret = csrfSecret();
  const payload = binding ? `${binding}.${raw}` : raw;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function createCsrfToken(req) {
  const raw = crypto.randomBytes(32).toString("hex");
  const binding = req ? getBinding(req) : "";
  return signToken(raw, binding);
}

function ensureCsrfCookie(req, res, next) {
  if (res.locals.csrfToken) return next();

  // Establish stable anon pre-session BEFORE computing binding / token
  ensureAnonPreSession(req, res);

  const name = env.CSRF_COOKIE_NAME;
  const binding = getBinding(req);

  const existing = req.cookies && req.cookies[name];
  if (existing && verifySignedToken(existing, binding)) {
    res.locals.csrfToken = existing;
    return next();
  }
  // Accept legacy unbound tokens for migration
  if (existing && verifySignedToken(existing, "")) {
    res.locals.csrfToken = existing;
    return next();
  }

  const token = createCsrfToken(req);
  res.cookie(name, token, {
    httpOnly: false,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.locals.csrfToken = token;
  return next();
}

function allowedOriginHost() {
  const base = env.PUBLIC_BASE_URL;
  if (base) {
    try {
      return new URL(base).host;
    } catch {
      /* fall through */
    }
  }
  return null;
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.path === "/health" || req.path.startsWith("/health/")) return next();

  // Origin/Referer against PUBLIC_BASE_URL when set
  const origin = req.get("origin");
  const referer = req.get("referer");
  const expectedHost = allowedOriginHost() || req.get("host");
  if (origin) {
    try {
      if (new URL(origin).host !== expectedHost) {
        return next(new ForbiddenError("Origin không hợp lệ (CSRF)."));
      }
    } catch {
      return next(new ForbiddenError("Origin không hợp lệ (CSRF)."));
    }
  } else if (referer) {
    try {
      if (new URL(referer).host !== expectedHost) {
        return next(new ForbiddenError("Referer không hợp lệ (CSRF)."));
      }
    } catch {
      return next(new ForbiddenError("Referer không hợp lệ (CSRF)."));
    }
  }

  if (
    process.env.DISABLE_CSRF === "1" &&
    process.env.ALLOW_DISABLE_CSRF === "1"
  ) {
    return next();
  }

  const cookieToken = req.cookies && req.cookies[env.CSRF_COOKIE_NAME];
  const headerToken =
    req.get("x-csrf-token") ||
    req.get("x-xsrf-token") ||
    (req.body && req.body._csrf);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(new ForbiddenError("Thiếu hoặc sai CSRF token."));
  }

  const binding = getBinding(req);
  if (
    !verifySignedToken(cookieToken, binding) &&
    !verifySignedToken(cookieToken, "")
  ) {
    return next(new ForbiddenError("Thiếu hoặc sai CSRF token."));
  }
  return next();
}

module.exports = {
  ensureCsrfCookie,
  csrfProtection,
  createCsrfToken,
  verifySignedToken,
  signToken,
  getBinding,
};
