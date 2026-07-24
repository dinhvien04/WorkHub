"use strict";

const jwt = require("jsonwebtoken");
const env = require("../config/env");

function requireAuth(req, res, next) {
  let token = null;

  // 1. Extract from Authorization header
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }

  // 2. Fallback to Cookie
  if (!token && req.cookies) {
    token = req.cookies["authToken"];
  }

  if (!token) {
    return res.status(401).json({ error: "Yêu cầu đăng nhập để truy cập." });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = {
      userId: decoded.userId || decoded.id || decoded._id,
      role: decoded.role,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token không hợp lệ hoặc đã hết hạn." });
  }
}

module.exports = {
  requireAuth,
};
