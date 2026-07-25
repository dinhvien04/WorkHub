"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const UserSession = require("../models/Session");
const env = require("../config/env");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function isValidPassword(password) {
  return String(password || "").length >= 10;
}

function authCookieOptions() {
  return {
    path: "/",
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
  };
}

function signToken(user, { sid } = {}) {
  const payload = {
    userId: user._id.toString(),
    role: user.Role,
    tokenVersion: user.tokenVersion || 0,
  };
  if (sid) payload.sid = String(sid);
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: "workhub-auth",
    audience: "workhub-app",
  });
}

async function createSession(user, req, authMethod = "password") {
  const sid = crypto.randomBytes(32).toString("hex");
  const publicSessionId = crypto.randomUUID();
  const sidHash = crypto.createHash("sha256").update(sid).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await UserSession.create({
    UserID: user._id,
    PublicSessionID: publicSessionId,
    SidHash: sidHash,
    TokenVersion: user.tokenVersion || 0,
    UserAgent: req.get("user-agent") || "",
    IP: req.ip || "",
    AuthMethod: authMethod,
    LastSeenAt: new Date(),
    ExpiresAt: expiresAt,
  });
  return { sid, publicSessionId, expiresAt };
}

async function register(req, res, next) {
  try {
    const { email, password, fullName, role = "customer" } = req.body || {};
    if (!email || !password || !fullName) {
      return res
        .status(400)
        .json({ error: "Vui lòng nhập Email, Mật khẩu và Họ tên." });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Định dạng email không hợp lệ!" });
    }
    if (!isValidPassword(password)) {
      return res
        .status(400)
        .json({ error: "Mật khẩu phải ít nhất 10 ký tự." });
    }
    const normalizedRole = String(role).trim().toLowerCase();
    if (!["customer", "host"].includes(normalizedRole)) {
      return res.status(400).json({ error: "Role không hợp lệ." });
    }

    const normalizedEmail = normalizeEmail(email);
    const existing = await User.findOne({ Email: normalizedEmail }).lean();
    if (existing) {
      return res.status(400).json({ error: "Email này đã được đăng ký!" });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    const user = await User.create({
      Email: normalizedEmail,
      PasswordHash: passwordHash,
      FullName: String(fullName).trim(),
      Role: normalizedRole,
      Status: "active",
      EmailVerified: true,
      EmailVerifiedAt: new Date(),
      AuthProvider: "local",
      tokenVersion: 0,
    });

    return res.status(201).json({
      message: "Đăng ký thành công.",
      user: {
        id: user._id,
        email: user.Email,
        fullName: user.FullName,
        role: user.Role,
        status: user.Status,
      },
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(400).json({ error: "Email này đã được đăng ký!" });
    }
    return next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Vui lòng nhập Email và Mật khẩu." });
    }

    const user = await User.findOne({ Email: normalizeEmail(email) }).select(
      "+TotpSecret +TotpRecoveryHashes PasswordHash tokenVersion Role Status Email FullName TotpEnabled",
    );
    if (!user || !user.PasswordHash) {
      return res
        .status(401)
        .json({ error: "Email hoặc mật khẩu không đúng." });
    }
    if (user.Status === "banned") {
      return res.status(403).json({ error: "Tài khoản của bạn đã bị khóa." });
    }
    if (user.Status !== "active") {
      return res
        .status(403)
        .json({ error: "Tài khoản chưa được kích hoạt." });
    }

    const ok = await bcrypt.compare(String(password), user.PasswordHash);
    if (!ok) {
      return res
        .status(401)
        .json({ error: "Email hoặc mật khẩu không đúng." });
    }

    if (user.TotpEnabled) {
      return res.status(200).json({
        requires2fa: true,
        message: "Yêu cầu xác minh 2FA.",
        userId: user._id,
      });
    }

    const session = await createSession(user, req, "password");
    const token = signToken(user, { sid: session.sid });
    res.cookie(env.AUTH_COOKIE_NAME, token, authCookieOptions());
    return res.json({
      message: "Đăng nhập thành công.",
      token,
      user: {
        id: user._id,
        email: user.Email,
        fullName: user.FullName,
        role: user.Role,
        status: user.Status,
      },
      sessionId: session.publicSessionId,
    });
  } catch (err) {
    return next(err);
  }
}

async function logout(req, res, next) {
  try {
    if (req.sid) {
      const sidHash = crypto
        .createHash("sha256")
        .update(String(req.sid))
        .digest("hex");
      await UserSession.updateOne(
        { SidHash: sidHash, RevokedAt: null },
        { $set: { RevokedAt: new Date() } },
      );
    }
    res.clearCookie(env.AUTH_COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: "lax",
    });
    return res.json({ message: "Đăng xuất thành công." });
  } catch (err) {
    return next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await User.findById(req.user.userId)
      .select("_id Email FullName Role Status EmailVerified tokenVersion")
      .lean();
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng." });
    }
    return res.json({
      user: {
        id: user._id,
        email: user.Email,
        fullName: user.FullName,
        role: user.Role,
        status: user.Status,
        emailVerified: user.EmailVerified,
        tokenVersion: user.tokenVersion || 0,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function listSessions(req, res, next) {
  try {
    const sessions = await UserSession.find({
      UserID: req.user.userId,
      RevokedAt: null,
    })
      .sort({ createdAt: -1 })
      .select("PublicSessionID UserAgent IP AuthMethod LastSeenAt ExpiresAt createdAt")
      .lean();
    return res.json({
      sessions: sessions.map((s) => ({
        id: s.PublicSessionID,
        userAgent: s.UserAgent,
        ip: s.IP,
        authMethod: s.AuthMethod,
        lastSeenAt: s.LastSeenAt,
        expiresAt: s.ExpiresAt,
        createdAt: s.createdAt,
        current: req.sessionId === s.PublicSessionID,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

async function revokeSession(req, res, next) {
  try {
    const publicId = String(req.params.id || "");
    const updated = await UserSession.findOneAndUpdate(
      {
        UserID: req.user.userId,
        PublicSessionID: publicId,
        RevokedAt: null,
      },
      { $set: { RevokedAt: new Date() } },
      { new: true },
    );
    if (!updated) {
      return res.status(404).json({ error: "Không tìm thấy phiên." });
    }
    return res.json({ message: "Đã thu hồi phiên." });
  } catch (err) {
    return next(err);
  }
}

async function logoutAll(req, res, next) {
  try {
    await UserSession.updateMany(
      { UserID: req.user.userId, RevokedAt: null },
      { $set: { RevokedAt: new Date() } },
    );
    await User.updateOne(
      { _id: req.user.userId },
      { $inc: { tokenVersion: 1 } },
    );
    res.clearCookie(env.AUTH_COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: "lax",
    });
    return res.json({ message: "Đã đăng xuất tất cả phiên." });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  normalizeEmail,
  isValidEmail,
  isValidPassword,
  signToken,
  createSession,
  register,
  login,
  logout,
  me,
  listSessions,
  revokeSession,
  logoutAll,
};
