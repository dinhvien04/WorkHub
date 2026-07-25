"use strict";

const crypto = require("crypto");
const env = require("../config/env");

function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAuth(req, res, next) {
  const internalToken = req.headers["x-internal-token"];
  const userId = req.headers["x-user-id"];
  const role = req.headers["x-user-role"];

  // Enforce secure internal microservice boundaries
  if (!internalToken || !safeCompare(internalToken, env.COMMUNICATION_INTERNAL_SECRET)) {
    return res.status(401).json({ error: "Yêu cầu xác thực mạng nội bộ không hợp lệ." });
  }

  if (!userId) {
    return res.status(401).json({ error: "Thiếu thông tin người dùng xác thực." });
  }

  req.user = {
    userId,
    role: role || "customer",
  };

  next();
}

module.exports = {
  requireAuth,
};
