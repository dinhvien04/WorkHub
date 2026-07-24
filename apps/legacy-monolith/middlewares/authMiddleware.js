"use strict";

const jwt = require("jsonwebtoken");
const env = require("../config/env");
const User = require("../models/User");
const HostProfile = require("../models/Host_Profile");
const { UnauthorizedError, ForbiddenError } = require("../utils/errors");

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

async function attachUserFromToken(token) {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  const userId = decoded.userId || decoded.id || decoded._id;
  if (!userId) throw new UnauthorizedError("Token không chứa userId.");

  const user = await User.findById(userId).select(
    "_id Role Status Email FullName tokenVersion",
  );
  if (!user) throw new UnauthorizedError("Tài khoản không tồn tại.");
  if (user.Status === "banned")
    throw new ForbiddenError("Tài khoản của bạn đã bị khóa.");
  if (user.Status !== "active")
    throw new ForbiddenError("Tài khoản chưa được kích hoạt.");

  const tokenVersion =
    typeof decoded.tokenVersion === "number" ? decoded.tokenVersion : 0;
  const dbVersion =
    typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
  if (tokenVersion !== dbVersion) {
    throw new UnauthorizedError(
      "Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.",
    );
  }

  // Per-session revoke: JWT sid is secret; DB lookup by SidHash only
  let sid = decoded.sid || null;
  let publicSessionId = null;

  // After cutoff, reject SID-less JWTs (legacy migration window via env)
  const requireSid =
    env.SESSION_REQUIRE_SID === true ||
    (env.isProduction && env.SESSION_REQUIRE_SID !== false);
  if (!sid && requireSid) {
    throw new UnauthorizedError(
      "Phiên đăng nhập cũ không còn hiệu lực. Vui lòng đăng nhập lại.",
    );
  }

  if (sid) {
    const crypto = require("crypto");
    const UserSession = require("../models/Session");
    const sidHash = crypto
      .createHash("sha256")
      .update(String(sid))
      .digest("hex");
    // Legacy plaintext Sid only until cutoff (default: non-production only)
    const legacyUntil = process.env.SESSION_ALLOW_LEGACY_PLAINTEXT_UNTIL;
    const allowLegacyPlaintext = legacyUntil
      ? Date.now() < new Date(legacyUntil).getTime()
      : !env.isProduction;
    const filter = allowLegacyPlaintext
      ? {
          UserID: userId,
          RevokedAt: null,
          $or: [{ SidHash: sidHash }, { Sid: String(sid) }],
        }
      : { UserID: userId, RevokedAt: null, SidHash: sidHash };
    const sess = await UserSession.findOne(filter).lean();
    if (!sess) {
      throw new UnauthorizedError(
        "Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.",
      );
    }
    if (sess.ExpiresAt && new Date(sess.ExpiresAt) < new Date()) {
      throw new UnauthorizedError(
        "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
      );
    }
    publicSessionId = sess.PublicSessionID || null;
    const last = sess.LastSeenAt ? new Date(sess.LastSeenAt).getTime() : 0;
    if (Date.now() - last > 60_000) {
      UserSession.updateOne(
        { _id: sess._id },
        { $set: { LastSeenAt: new Date() } },
      ).catch(() => {});
    }
  }

  return {
    reqUser: {
      userId: user._id.toString(),
      role: user.Role,
      status: user.Status,
      tokenVersion: dbVersion,
      email: user.Email,
      fullName: user.FullName,
      sid: sid || null,
      publicSessionId,
    },
    user,
  };
}

async function verifyToken(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return next(
        new UnauthorizedError(
          "Không tìm thấy token xác thực. Vui lòng đăng nhập.",
        ),
      );
    }
    try {
      const { reqUser, user } = await attachUserFromToken(token);
      req.user = reqUser;
      req.currentUser = user;
      return next();
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return next(
          new UnauthorizedError("Token đã hết hạn. Vui lòng đăng nhập lại."),
        );
      }
      if (error.isOperational) return next(error);
      return next(new UnauthorizedError("Token không hợp lệ."));
    }
  } catch (err) {
    return next(err);
  }
}

/**
 * Optional auth: attach identity only when token is fully valid
 * (status + tokenVersion). Invalid/stale tokens → guest, never stale identity.
 * Does not 401 — callers that need auth use verifyToken.
 */
async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return next();
    try {
      const { reqUser, user } = await attachUserFromToken(token);
      req.user = reqUser;
      req.currentUser = user;
    } catch {
      /* guest — do not attach stale identity */
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

const authorizeRole =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!req.user)
      return next(
        new UnauthorizedError("Bạn cần đăng nhập để thực hiện thao tác này."),
      );
    if (!req.user.role)
      return next(new ForbiddenError("Không tìm thấy thông tin phân quyền."));
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError("Bạn không có quyền truy cập tài nguyên này."),
      );
    }
    return next();
  };

const requireAdmin = (req, res, next) => authorizeRole("admin")(req, res, next);

async function requireVerifiedHost(req, res, next) {
  try {
    if (!req.user || req.user.role !== "host") {
      return next(new ForbiddenError("Chỉ host mới được truy cập."));
    }
    const profile = await HostProfile.findOne({
      UserID: req.user.userId,
    }).select("IsVerified VerificationStatus");
    const approved =
      profile &&
      (profile.IsVerified === true ||
        profile.VerificationStatus === "approved");
    if (!approved) {
      const st =
        profile?.VerificationStatus ||
        (profile?.IsVerified ? "approved" : "pending");
      return next(
        new ForbiddenError(
          st === "needs_info"
            ? "Hồ sơ host cần bổ sung thông tin. Xem /host/onboarding."
            : st === "suspended" || st === "revoked"
              ? `Tài khoản host đang ${st}. Liên hệ hỗ trợ.`
              : "Tài khoản host chưa được admin phê duyệt. Vui lòng chờ xác minh.",
        ),
      );
    }
    req.hostVerified = true;
    req.hostVerificationStatus = profile.VerificationStatus || "approved";
    return next();
  } catch (err) {
    return next(err);
  }
}

async function requireHostPage(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.redirect("/login");
    const { reqUser, user } = await attachUserFromToken(token);
    if (user.Role !== "host") return res.redirect("/login");
    const profile = await HostProfile.findOne({ UserID: user._id }).select(
      "IsVerified",
    );
    if (!profile || !profile.IsVerified) {
      return res.status(403).send("Tài khoản host chưa được admin phê duyệt.");
    }
    req.user = reqUser;
    req.currentUser = user;
    return next();
  } catch {
    return res.redirect("/login");
  }
}

/**
 * Page-level admin auth — protects HTML routes, not only API.
 */
async function requireAdminPage(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.redirect("/login");
    const { reqUser, user } = await attachUserFromToken(token);
    if (user.Role !== "admin") {
      return res.status(403).send("Chỉ admin mới được truy cập.");
    }
    req.user = reqUser;
    req.currentUser = user;
    return next();
  } catch {
    return res.redirect("/login");
  }
}

module.exports = {
  verifyToken,
  optionalAuth,
  authorizeRole,
  requireAdmin,
  requireHostPage,
  requireVerifiedHost,
  requireAdminPage,
  extractToken,
};
