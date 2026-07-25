"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const User = require("../models/User");
const UserSession = require("../models/Session");

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
 * Optional gateway-to-service boundary for internal calls.
 * Public auth endpoints do not require this; session-sensitive routes may.
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
      .json({ error: "Yêu cầu xác thực mạng nội bộ không hợp lệ." });
  }
  return next();
}

async function verifyToken(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: "Yêu cầu đăng nhập để truy cập." });
    }

    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "workhub-auth",
      audience: "workhub-app",
    });
    const userId = decoded.userId || decoded.id || decoded._id;
    if (!userId) {
      return res.status(401).json({ error: "Token không chứa userId." });
    }

    const user = await User.findById(userId).select(
      "_id Role Status Email FullName tokenVersion",
    );
    if (!user) {
      return res.status(401).json({ error: "Tài khoản không tồn tại." });
    }
    if (user.Status === "banned") {
      return res.status(403).json({ error: "Tài khoản của bạn đã bị khóa." });
    }
    if (user.Status !== "active") {
      return res.status(403).json({ error: "Tài khoản chưa được kích hoạt." });
    }

    const tokenVersion =
      typeof decoded.tokenVersion === "number" ? decoded.tokenVersion : 0;
    const dbVersion =
      typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
    if (tokenVersion !== dbVersion) {
      return res.status(401).json({
        error: "Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.",
      });
    }

    if (decoded.sid) {
      const sidHash = crypto
        .createHash("sha256")
        .update(String(decoded.sid))
        .digest("hex");
      const sess = await UserSession.findOne({
        UserID: userId,
        RevokedAt: null,
        SidHash: sidHash,
      }).lean();
      if (!sess) {
        return res.status(401).json({
          error: "Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.",
        });
      }
      if (sess.ExpiresAt && new Date(sess.ExpiresAt) < new Date()) {
        return res.status(401).json({
          error: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
        });
      }
      req.sessionId = sess.PublicSessionID || null;
      req.sid = decoded.sid;
    }

    req.user = {
      userId: user._id.toString(),
      role: user.Role,
      email: user.Email,
      fullName: user.FullName,
      tokenVersion: user.tokenVersion || 0,
      sid: decoded.sid || null,
    };
    return next();
  } catch (err) {
    return res
      .status(401)
      .json({ error: "Token không hợp lệ hoặc đã hết hạn." });
  }
}

/**
 * Attach user when a valid token is present; otherwise continue anonymously.
 * Used for logout and public email verification resend.
 * Invalid/expired tokens are ignored (never hard-fail).
 */
async function optionalToken(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "workhub-auth",
      audience: "workhub-app",
    });
    const userId = decoded.userId || decoded.id || decoded._id;
    if (!userId) return next();
    const user = await User.findById(userId).select(
      "_id Role Status Email FullName tokenVersion",
    );
    if (!user || user.Status !== "active") return next();
    const tokenVersion =
      typeof decoded.tokenVersion === "number" ? decoded.tokenVersion : 0;
    const dbVersion =
      typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
    if (tokenVersion !== dbVersion) return next();
    req.user = {
      userId: user._id.toString(),
      role: user.Role,
      email: user.Email,
      fullName: user.FullName,
      tokenVersion: user.tokenVersion || 0,
      sid: decoded.sid || null,
    };
    req.sid = decoded.sid || null;
  } catch {
    /* ignore invalid token for optional auth */
  }
  return next();
}

module.exports = {
  safeCompare,
  extractToken,
  requireInternalService,
  verifyToken,
  optionalToken,
};
