"use strict";

/**
 * Authentication for identity-service.
 *
 * `attachAuth` runs once per request and does the full verification, storing
 * the outcome (including *why* it failed) on `req.auth`. `requireAuth` then
 * turns that into a response. Doing it in one pass means CSRF can bind to the
 * session id without a second database round trip, and callers keep the
 * specific "banned" / "session revoked" / "token expired" distinctions.
 */
const crypto = require("crypto");
const env = require("../config/env");
const User = require("../models/User");
const UserSession = require("../models/Session");
const tokenService = require("../services/tokenService");

function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, cookieString) => {
    const [name, ...rest] = cookieString.trim().split("=");
    if (!name) return cookies;
    cookies[name] = decodeURIComponent(rest.join("="));
    return cookies;
  }, {});
}

function extractToken(req) {
  const authHeader = req.header("Authorization") || req.headers.authorization;
  if (authHeader) {
    if (authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim();
    return authHeader.trim();
  }
  const cookies = req.cookies || parseCookies(req.headers.cookie || "");
  return cookies[env.AUTH_COOKIE_NAME] || cookies.authToken || null;
}

/**
 * Gateway-to-service boundary for internal-only endpoints.
 */
function requireInternalService(req, res, next) {
  const internalToken = req.headers["x-internal-token"];
  const serviceName = req.headers["x-service-name"];
  if (
    !internalToken ||
    !safeCompare(internalToken, env.IDENTITY_INTERNAL_SECRET) ||
    serviceName !== "api-gateway"
  ) {
    return res
      .status(401)
      .json({ error: "Yêu cầu xác thực mạng nội bộ không hợp lệ.", code: "INTERNAL_AUTH_FAILED" });
  }
  return next();
}

const FAILURES = {
  no_token: { status: 401, code: "AUTH_REQUIRED", message: "Yêu cầu đăng nhập để truy cập." },
  invalid_token: {
    status: 401,
    code: "TOKEN_INVALID",
    message: "Token không hợp lệ hoặc đã hết hạn.",
  },
  legacy_disabled: {
    status: 401,
    code: "TOKEN_LEGACY_REJECTED",
    message: "Phiên đăng nhập cũ không còn được chấp nhận. Vui lòng đăng nhập lại.",
  },
  unknown_user: { status: 401, code: "USER_NOT_FOUND", message: "Tài khoản không tồn tại." },
  banned: { status: 403, code: "USER_BANNED", message: "Tài khoản của bạn đã bị khóa." },
  inactive: { status: 403, code: "USER_INACTIVE", message: "Tài khoản chưa được kích hoạt." },
  stale_token_version: {
    status: 401,
    code: "TOKEN_VERSION_STALE",
    message: "Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.",
  },
  session_revoked: {
    status: 401,
    code: "SESSION_REVOKED",
    message: "Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.",
  },
  session_expired: {
    status: 401,
    code: "SESSION_EXPIRED",
    message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  },
  session_required: {
    status: 401,
    code: "SESSION_REQUIRED",
    message: "Token thiếu định danh phiên. Vui lòng đăng nhập lại.",
  },
};

function fail(reason) {
  return { ok: false, reason, ...FAILURES[reason] };
}

/**
 * Full verification: token integrity, user state, tokenVersion, session.
 */
async function resolveAuth(req) {
  const token = extractToken(req);
  if (!token) return fail("no_token");

  let claims;
  try {
    claims = tokenService.verifyAccessToken(token);
  } catch (rsErr) {
    // Fall back to the monolith's HS256 tokens while the sunset window is open.
    try {
      claims = tokenService.verifyLegacyAccessToken(token);
    } catch (hsErr) {
      if (hsErr.reason === "legacy_disabled") return fail("legacy_disabled");
      void rsErr;
      return fail("invalid_token");
    }
  }

  const user = await User.findById(claims.userId).select(
    "_id Role Status Email FullName tokenVersion",
  );
  if (!user) return fail("unknown_user");
  if (user.Status === "banned") return fail("banned");
  if (user.Status !== "active") return fail("inactive");

  const dbVersion = typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
  if (claims.tokenVersion !== dbVersion) return fail("stale_token_version");

  let publicSessionId = null;
  if (claims.sid) {
    const sidHash = crypto.createHash("sha256").update(String(claims.sid)).digest("hex");
    const session = await UserSession.findOne({
      UserID: user._id,
      RevokedAt: null,
      SidHash: sidHash,
    }).lean();

    if (!session) return fail("session_revoked");
    if (session.ExpiresAt && new Date(session.ExpiresAt) < new Date()) {
      return fail("session_expired");
    }
    publicSessionId = session.PublicSessionID || null;
  } else if (env.SESSION_REQUIRE_SID) {
    return fail("session_required");
  }

  return {
    ok: true,
    user: {
      userId: user._id.toString(),
      role: user.Role,
      email: user.Email,
      fullName: user.FullName,
      tokenVersion: dbVersion,
      sid: claims.sid || null,
    },
    sid: claims.sid || null,
    publicSessionId,
    legacy: Boolean(claims.legacy),
  };
}

/**
 * App-level: resolve auth once, never reject. Populates req.user when valid so
 * downstream middleware (CSRF) can bind to the session.
 */
async function attachAuth(req, res, next) {
  try {
    const result = await resolveAuth(req);
    req.auth = result;
    if (result.ok) {
      req.user = result.user;
      req.sid = result.sid;
      req.sessionId = result.publicSessionId;
    }
  } catch (err) {
    req.auth = fail("invalid_token");
    console.error("[Auth] Unexpected verification error:", err.message);
  }
  return next();
}

/**
 * Route-level: require a valid session, surfacing the specific failure.
 */
function requireAuth(req, res, next) {
  const result = req.auth;
  if (!result) {
    return res
      .status(500)
      .json({ error: "Auth middleware chưa được gắn.", code: "AUTH_NOT_ATTACHED" });
  }
  if (result.ok) return next();
  return res.status(result.status).json({ error: result.message, code: result.code });
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === "admin") return next();
  return res.status(403).json({
    error: "Quyền truy cập bị từ chối. Chỉ dành cho Admin.",
    code: "ADMIN_REQUIRED",
  });
}

module.exports = {
  safeCompare,
  extractToken,
  requireInternalService,
  resolveAuth,
  attachAuth,
  requireAuth,
  requireAdmin,
  // Back-compat aliases for existing route definitions.
  verifyToken: requireAuth,
  optionalToken: attachAuth,
};
