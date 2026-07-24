"use strict";

const env = require("../config/env");

function requireAuth(req, res, next) {
  const internalToken = req.headers["x-internal-token"];
  const userId = req.headers["x-user-id"];
  const role = req.headers["x-user-role"];

  // In test environment, allow direct JWT verify if no internal token to simplify testing
  if (env.isTest && !internalToken) {
    const jwt = require("jsonwebtoken");
    let token = null;

    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    } else if (req.cookies) {
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
      return next();
    } catch (err) {
      return res.status(401).json({ error: "Token không hợp lệ hoặc đã hết hạn." });
    }
  }

  // Enforce secure internal microservice boundaries
  if (!internalToken || internalToken !== env.JWT_SECRET) {
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
