"use strict";

/**
 * CSRF defence for cookie-authenticated mutations.
 *
 * Three independent checks, because each one alone has a known gap:
 *   1. Signed double-submit token — the cookie is readable by same-origin JS
 *      and echoed in a header an attacker's origin cannot set.
 *   2. Origin/Referer allowlist — catches requests that never ran our JS.
 *   3. Fetch Metadata (Sec-Fetch-Site) — browser-asserted, unspoofable from
 *      page context, and covers form posts that carry no Origin.
 *
 * Bearer-token callers are exempt: an Authorization header is not attached
 * ambiently by the browser, so there is nothing to forge.
 */
const crypto = require("crypto");
const env = require("../config/env");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TOKEN_BYTES = 32;

function hmac(value) {
  return crypto
    .createHmac("sha256", env.IDENTITY_CSRF_SECRET)
    .update(String(value))
    .digest("base64url");
}

function timingSafeEquals(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Mint a token of the form `<nonce>.<signature>`.
 *
 * The signature covers the session id when there is one, so a token minted for
 * an anonymous visitor cannot be reused after they log in as somebody else.
 */
function issueToken(sid = "") {
  const nonce = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  return `${nonce}.${hmac(`${nonce}:${sid}`)}`;
}

function verifyTokenSignature(token, sid = "") {
  const raw = String(token || "");
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return false;

  const nonce = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  return timingSafeEquals(signature, hmac(`${nonce}:${sid}`));
}

function csrfError(res, code, message) {
  return res.status(403).json({ error: message, code });
}

function allowedOrigins() {
  const configured = env.IDENTITY_ALLOWED_ORIGINS;
  if (configured.length > 0) return configured;
  if (env.PUBLIC_BASE_URL) return [env.PUBLIC_BASE_URL];
  // Dev fallback only; production requires IDENTITY_ALLOWED_ORIGINS.
  return ["http://localhost:3000", "http://127.0.0.1:3000"];
}

function originAllowed(value) {
  if (!value) return false;
  let origin;
  try {
    origin = new URL(value).origin;
  } catch {
    return false;
  }
  return allowedOrigins().some((allowed) => {
    try {
      return new URL(allowed).origin === origin;
    } catch {
      return false;
    }
  });
}

/**
 * Ensure the caller has a CSRF cookie. Safe to run on every request.
 */
function ensureCsrfCookie(req, res, next) {
  const existing = req.cookies?.[env.CSRF_COOKIE_NAME];
  const sid = req.user?.sid || req.sid || "";

  if (existing && verifyTokenSignature(existing, sid)) {
    res.locals.csrfToken = existing;
    return next();
  }

  const token = issueToken(sid);
  res.cookie(env.CSRF_COOKIE_NAME, token, {
    // Deliberately readable by same-origin JS — that is how the double-submit
    // header gets populated.
    httpOnly: false,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60 * 1000,
  });
  res.locals.csrfToken = token;
  return next();
}

/**
 * Reject state-changing requests that fail any of the three checks.
 */
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  // Bearer auth is not ambient — no CSRF surface.
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) return next();

  // Nothing to protect if the request carries no auth cookie at all.
  const hasAuthCookie = Boolean(req.cookies?.[env.AUTH_COOKIE_NAME]);

  // 1. Fetch Metadata.
  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite && fetchSite === "cross-site") {
    return csrfError(res, "CSRF_CROSS_SITE", "Yêu cầu bị chặn: nguồn gửi không hợp lệ.");
  }

  // 2. Origin / Referer allowlist.
  const origin = req.get("origin");
  const referer = req.get("referer");
  if (origin) {
    if (!originAllowed(origin)) {
      return csrfError(res, "CSRF_ORIGIN_REJECTED", "Yêu cầu bị chặn: origin không được phép.");
    }
  } else if (referer) {
    if (!originAllowed(referer)) {
      return csrfError(res, "CSRF_REFERER_REJECTED", "Yêu cầu bị chặn: referer không được phép.");
    }
  } else if (hasAuthCookie && !fetchSite) {
    // A cookie-authenticated mutation with neither Origin nor Fetch Metadata
    // is not something a current browser produces.
    return csrfError(res, "CSRF_ORIGIN_MISSING", "Yêu cầu bị chặn: thiếu thông tin nguồn gửi.");
  }

  // 3. Signed double-submit token.
  const cookieToken = req.cookies?.[env.CSRF_COOKIE_NAME];
  const headerToken = req.get("x-csrf-token") || req.body?._csrf;

  if (!cookieToken || !headerToken) {
    return csrfError(res, "CSRF_TOKEN_MISSING", "Thiếu CSRF token. Vui lòng tải lại trang.");
  }
  if (!timingSafeEquals(cookieToken, headerToken)) {
    return csrfError(res, "CSRF_TOKEN_MISMATCH", "CSRF token không khớp. Vui lòng tải lại trang.");
  }

  const sid = req.user?.sid || req.sid || "";
  if (!verifyTokenSignature(cookieToken, sid)) {
    return csrfError(res, "CSRF_TOKEN_INVALID", "CSRF token không hợp lệ. Vui lòng tải lại trang.");
  }

  return next();
}

module.exports = {
  ensureCsrfCookie,
  csrfProtection,
  issueToken,
  verifyTokenSignature,
  originAllowed,
  allowedOrigins,
};
