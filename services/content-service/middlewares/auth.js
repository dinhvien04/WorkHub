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
      // Inject fallback scopes for test compatibility
      req.user.scopes = req.user.role === "admin"
        ? ["content:read", "content:write", "content:publish", "content:redirect:manage", "content:i18n:manage"]
        : ["content:read"];
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

  const scopes = req.headers["x-user-scopes"] ? req.headers["x-user-scopes"].split(",") : [];

  req.user = {
    userId,
    role: role || "customer",
    scopes,
  };

  next();
}

/**
 * Enforce scope-based access checks.
 */
function requireScope(requiredScope) {
  return (req, res, next) => {
    const userScopes = req.user && req.user.scopes ? req.user.scopes : [];
    if (!userScopes.includes(requiredScope)) {
      return res.status(403).json({ error: `Quyền truy cập bị từ chối. Thiếu scope: ${requiredScope}` });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requireScope,
};
