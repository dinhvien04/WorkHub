"use strict";

const User = require("../models/User");
const UserSession = require("../models/Session");
const env = require("../config/env");
const asyncHandler = require("../utils/asyncHandler");
const { NotFoundError } = require("../utils/errors");
const outboxService = require("../services/outboxService");
const tokenService = require("../services/tokenService");
const { withTransaction } = require("../utils/mongoTransaction");

function clearAuthCookie(res) {
  res.clearCookie(env.AUTH_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
  });
}

const listSessions = asyncHandler(async (req, res) => {
  const sessions = await UserSession.find({
    UserID: req.user.userId,
    RevokedAt: null,
  })
    .sort({ createdAt: -1 })
    .select("PublicSessionID UserAgent IP AuthMethod LastSeenAt ExpiresAt createdAt")
    .lean();

  res.json({
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
});

const revokeSession = asyncHandler(async (req, res) => {
  const publicId = String(req.params.id || "");

  await withTransaction(async (session) => {
    const updated = await UserSession.findOneAndUpdate(
      { UserID: req.user.userId, PublicSessionID: publicId, RevokedAt: null },
      { $set: { RevokedAt: new Date() } },
      session ? { session, new: true } : { new: true },
    );
    if (!updated) throw new NotFoundError("Không tìm thấy phiên.");

    await outboxService.enqueueSessionRevoked(
      {
        userId: req.user.userId,
        sessionId: updated.SidHash,
        publicSessionId: updated.PublicSessionID,
      },
      { session },
    );
    await outboxService.enqueueAudit(
      {
        userId: req.user.userId,
        action: "REVOKE_SESSION",
        entityType: "UserSession",
        entityId: updated.PublicSessionID,
        message: "Thu hồi một phiên đăng nhập",
        level: "warning",
        req,
      },
      { session },
    );
  });

  res.json({ message: "Đã thu hồi phiên." });
});

/**
 * Revoke every session and bump tokenVersion, which also invalidates any
 * access token already in flight.
 */
async function revokeAllForUser(userId, { req, action, message }) {
  return withTransaction(async (session) => {
    const opts = session ? { session } : {};

    await UserSession.updateMany(
      { UserID: userId, RevokedAt: null },
      { $set: { RevokedAt: new Date() } },
      opts,
    );
    await tokenService.revokePreAuthTokensForUser(userId, { session });

    const updated = await User.findOneAndUpdate(
      { _id: userId },
      { $inc: { tokenVersion: 1 } },
      session ? { session, new: true } : { new: true },
    );
    const tokenVersion = updated ? updated.tokenVersion : 0;

    await outboxService.enqueueAllSessionsRevoked({ userId, tokenVersion }, { session });
    await outboxService.enqueueAudit(
      {
        userId,
        action,
        entityType: "User",
        entityId: userId,
        message,
        level: "warning",
        req,
      },
      { session },
    );

    return tokenVersion;
  });
}

const logoutAll = asyncHandler(async (req, res) => {
  await revokeAllForUser(req.user.userId, {
    req,
    action: "LOGOUT_ALL",
    message: "Đăng xuất khỏi tất cả thiết bị",
  });
  clearAuthCookie(res);
  res.json({ message: "Đã đăng xuất tất cả phiên." });
});

const adminForceLogout = asyncHandler(async (req, res) => {
  const userId = String(req.params.userId || "");
  await revokeAllForUser(userId, {
    req,
    action: "ADMIN_FORCE_LOGOUT",
    message: `Admin ${req.user.userId} buộc đăng xuất người dùng ${userId}`,
  });
  res.json({ message: "Đã buộc đăng xuất tất cả phiên của người dùng." });
});

module.exports = {
  listSessions,
  revokeSession,
  logoutAll,
  adminForceLogout,
};
