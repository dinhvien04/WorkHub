"use strict";

const User = require("../models/User");
const UserSession = require("../models/Session");
const env = require("../config/env");
const asyncHandler = require("../utils/asyncHandler");
const { NotFoundError } = require("../utils/errors");

const listSessions = asyncHandler(async (req, res) => {
  const sessions = await UserSession.find({
    UserID: req.user.userId,
    RevokedAt: null,
  })
    .sort({ createdAt: -1 })
    .select(
      "PublicSessionID UserAgent IP AuthMethod LastSeenAt ExpiresAt createdAt",
    )
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
  const updated = await UserSession.findOneAndUpdate(
    {
      UserID: req.user.userId,
      PublicSessionID: publicId,
      RevokedAt: null,
    },
    { $set: { RevokedAt: new Date() } },
    { new: true },
  );
  if (!updated) throw new NotFoundError("Không tìm thấy phiên.");
  res.json({ message: "Đã thu hồi phiên." });
});

const logoutAll = asyncHandler(async (req, res) => {
  await UserSession.updateMany(
    { UserID: req.user.userId, RevokedAt: null },
    { $set: { RevokedAt: new Date() } },
  );
  await User.updateOne({ _id: req.user.userId }, { $inc: { tokenVersion: 1 } });
  res.clearCookie(env.AUTH_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
  });
  res.json({ message: "Đã đăng xuất tất cả phiên." });
});

module.exports = {
  listSessions,
  revokeSession,
  logoutAll,
};
