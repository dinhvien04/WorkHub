"use strict";

require("dotenv").config();
const http = require("http");
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const PORT = Number(process.env.PORT) || 3000;
const LEGACY_MONOLITH_URL = process.env.LEGACY_MONOLITH_URL || "http://localhost:3001";
const COMMUNICATION_SERVICE_URL = process.env.COMMUNICATION_SERVICE_URL || "http://localhost:3002";
const CONTENT_SERVICE_URL = process.env.CONTENT_SERVICE_URL || "http://localhost:3003";
const CANARY_BYPASS = process.env.CANARY_BYPASS === "true";
const JWT_SECRET = process.env.JWT_SECRET || "default_test_jwt_secret_at_least_32_chars_long";
if (process.env.NODE_ENV === "production") {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "replace_with_a_long_random_secret" || process.env.JWT_SECRET === "default_test_jwt_secret_at_least_32_chars_long") {
    throw new Error("Missing or default JWT_SECRET in production.");
  }
}

const CONTENT_INTERNAL_SECRET = process.env.CONTENT_INTERNAL_SECRET || (process.env.NODE_ENV === "production" ? (() => { throw new Error("Missing CONTENT_INTERNAL_SECRET in production."); })() : "default_test_content_internal_secret_key");
const COMMUNICATION_INTERNAL_SECRET = process.env.COMMUNICATION_INTERNAL_SECRET || (process.env.NODE_ENV === "production" ? (() => { throw new Error("Missing COMMUNICATION_INTERNAL_SECRET in production."); })() : "default_test_communication_internal_secret_key");

const app = express();

// Sanitize identity headers globally from incoming client requests to prevent header spoofing
app.use((req, res, next) => {
  delete req.headers["x-internal-token"];
  delete req.headers["x-service-name"];
  delete req.headers["x-user-id"];
  delete req.headers["x-user-role"];
  delete req.headers["x-user-scopes"];
  delete req.headers["x-actor-id"];
  delete req.headers["x-actor-role"];
  next();
});

// Coarse rate limiter for edge protection
const edgeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // Limit each IP to 1000 requests per window
  message: { error: "Too many requests from this IP, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(edgeLimiter);

const CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001"];

if (process.env.NODE_ENV === "production") {
  if (!process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS.trim() === "") {
    throw new Error("Missing CORS_ALLOWED_ORIGINS in production.");
  }
}

// Intercept and reject disallowed CORS origins cleanly without throwing errors / logging stack traces
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !CORS_ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: "Forbidden by CORS" });
  }
  next();
});

app.use(cors({
  origin: CORS_ALLOWED_ORIGINS,
  credentials: true,
}));

// Request ID middleware
app.use((req, res, next) => {
  const reqId = req.headers["x-request-id"] || crypto.randomUUID();
  req.id = reqId;
  res.setHeader("X-Request-Id", reqId);
  next();
});

// Cryptographically verify JWT token at Gateway boundary
app.use((req, res, next) => {
  let token = null;

  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(";").reduce((acc, c) => {
      const parts = c.trim().split("=");
      if (parts.length >= 2) {
        acc[parts[0]] = parts.slice(1).join("=");
      }
      return acc;
    }, {});
    token = cookies["authToken"];
  }

  if (!token) {
    // Unauthenticated guest user
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "workhub-auth",
      audience: "workhub-app"
    });

    const userId = decoded.userId || decoded.id || decoded._id;
    const role = decoded.role;

    if (!userId || !role) {
      return res.status(401).json({ error: "Token không hợp lệ (sai cấu trúc payload)." });
    }

    req.user = { userId, role };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token không hợp lệ hoặc đã hết hạn." });
  }
});

// Gateway health endpoints
app.get("/gateway/health", (req, res) => res.json({ status: "ok", gateway: true }));
app.get("/gateway/health/live", (req, res) => res.json({ status: "live", gateway: true }));
app.get("/gateway/health/ready", (req, res) => res.json({ status: "ready", gateway: true }));

// Proxy setup with WebSocket support and header propagation
const proxyOptions = {
  target: LEGACY_MONOLITH_URL,
  changeOrigin: true,
  ws: true,
  timeout: 60000, // 60s timeout
  proxyTimeout: 60000,
  on: {
    error: (err, req, res) => {
      console.error(`[API Gateway] Proxy error: ${err.message}`);
      if (res.writeHead && !res.headersSent) {
        const statusCode = ["ECONNREFUSED", "ENOTFOUND"].includes(err.code) ? 502 : 504;
        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: statusCode === 502 ? "Bad Gateway" : "Gateway Timeout" }));
      }
    },
    proxyReq: (proxyReq, req) => {
      // Forward Request ID to monolith
      proxyReq.setHeader("X-Request-Id", req.id || crypto.randomUUID());

      // Propagate trace headers if present
      if (req.headers["traceparent"]) {
        proxyReq.setHeader("traceparent", req.headers["traceparent"]);
      }

      // Canary bypass propagation
      if (CANARY_BYPASS) {
        proxyReq.setHeader("X-Canary-Bypass", "true");
      }
    },
    proxyRes: (proxyRes, req, res) => {
      // Append request ID to incoming client responses
      res.setHeader("X-Request-Id", req.id || crypto.randomUUID());
    }
  }
};

function shouldRouteToCommunication(req) {
  const enabled = process.env.COMMUNICATION_SERVICE_ENABLED === "true";
  if (!enabled) return false;
  const canaryPercent = Number(process.env.COMMUNICATION_CANARY_PERCENT) || 0;
  if (canaryPercent <= 0) return false;
  if (!req.user) return false; // Anonymous requests default to monolith

  const userId = req.user.userId;
  if (canaryPercent >= 100) return true;

  // Stable hashing percentage bucket based on verified userId
  const hash = crypto.createHash("sha256").update(`comm-canary:${userId}`).digest();
  const bucket = hash.readUInt32BE(0) % 100;
  return bucket < canaryPercent;
}

function shouldRouteToContent(req) {
  const enabled = process.env.CONTENT_SERVICE_ENABLED === "true";
  if (!enabled) return false;
  const canaryPercent = Number(process.env.CONTENT_CANARY_PERCENT) || 0;
  if (canaryPercent <= 0) return false;

  if (canaryPercent >= 100) return true;

  // Stable hashing percentage bucket based on verified userId or IP
  const identifier = req.user ? req.user.userId : (req.ip || "anon");
  const hash = crypto.createHash("sha256").update(`content-canary:${identifier}`).digest();
  const bucket = hash.readUInt32BE(0) % 100;
  return bucket < canaryPercent;
}

// Proxy configurations for Communication Service
const commProxyOptions = {
  target: COMMUNICATION_SERVICE_URL,
  changeOrigin: true,
  ws: true,
  timeout: 10000,
  proxyTimeout: 10000,
  on: {
    error: (err, req, res) => {
      console.error(`[API Gateway] Comm Proxy error: ${err.message}`);
      if (res.writeHead && !res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Communication Service Unavailable" }));
      }
    },
    proxyReq: (proxyReq, req) => {
      proxyReq.setHeader("X-Request-Id", req.id || crypto.randomUUID());
      if (req.headers["traceparent"]) {
        proxyReq.setHeader("traceparent", req.headers["traceparent"]);
      }

      // Sanitize and inject verified identity headers for Communication Service
      proxyReq.removeHeader("X-User-Id");
      proxyReq.removeHeader("X-User-Role");
      proxyReq.removeHeader("X-Internal-Token");
      proxyReq.setHeader("X-Internal-Token", COMMUNICATION_INTERNAL_SECRET);
      if (req.user) {
        proxyReq.setHeader("X-User-Id", req.user.userId);
        proxyReq.setHeader("X-User-Role", req.user.role || "");
      }
    },
    proxyRes: (proxyRes, req, res) => {
      res.setHeader("X-Request-Id", req.id || crypto.randomUUID());
    }
  }
};

const communicationProxy = createProxyMiddleware(commProxyOptions);

// Proxy configurations for Content Service
const contentProxyOptions = {
  target: CONTENT_SERVICE_URL,
  changeOrigin: true,
  ws: true,
  timeout: 10000,
  proxyTimeout: 10000,
  on: {
    error: (err, req, res) => {
      console.error(`[API Gateway] Content Proxy error: ${err.message}`);
      if (res.writeHead && !res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Content Service Unavailable" }));
      }
    },
    proxyReq: (proxyReq, req) => {
      proxyReq.setHeader("X-Request-Id", req.id || crypto.randomUUID());
      if (req.headers["traceparent"]) {
        proxyReq.setHeader("traceparent", req.headers["traceparent"]);
      }

      // Sanitize and inject verified identity headers for Content Service
      proxyReq.removeHeader("X-User-Id");
      proxyReq.removeHeader("X-User-Role");
      proxyReq.removeHeader("X-User-Scopes");
      proxyReq.removeHeader("X-Actor-Id");
      proxyReq.removeHeader("X-Actor-Role");
      proxyReq.removeHeader("X-Internal-Token");
      proxyReq.removeHeader("X-Service-Name");

      proxyReq.setHeader("X-Service-Name", "api-gateway");
      proxyReq.setHeader("X-Internal-Token", CONTENT_INTERNAL_SECRET);
      if (req.user) {
        proxyReq.setHeader("X-User-Id", req.user.userId);
        proxyReq.setHeader("X-User-Role", req.user.role || "");
        proxyReq.setHeader("X-Actor-Id", req.user.userId);
        proxyReq.setHeader("X-Actor-Role", req.user.role || "");
        const scopes = req.user.role === "admin"
          ? ["content:read", "content:write", "content:publish", "content:redirect:manage", "content:i18n:manage"]
          : ["content:read"];
        proxyReq.setHeader("X-User-Scopes", scopes.join(","));
      }
    },
    proxyRes: (proxyRes, req, res) => {
      res.setHeader("X-Request-Id", req.id || crypto.randomUUID());
    }
  }
};

const contentProxy = createProxyMiddleware(contentProxyOptions);

// Route content, i18n, and seo to content microservice when enabled (preserving original path)
app.use((req, res, next) => {
  const isContentPath = req.path === "/api/content" || req.path.startsWith("/api/content/") ||
                        req.path === "/api/i18n" || req.path.startsWith("/api/i18n/") ||
                        req.path === "/api/seo" || req.path.startsWith("/api/seo/");
  if (isContentPath && shouldRouteToContent(req)) {
    return contentProxy(req, res, next);
  }
  next();
});

// Route push and notification requests to communication microservice when enabled (preserving original path)
app.use((req, res, next) => {
  const isCommPath = req.path === "/api/push" || req.path.startsWith("/api/push/") ||
                     req.path === "/api/notifications" || req.path.startsWith("/api/notifications/");
  if (isCommPath && shouldRouteToCommunication(req)) {
    return communicationProxy(req, res, next);
  }
  next();
});

// Backward compatibility path rewrites
app.use("/api/me/notifications", (req, res, next) => {
  if (shouldRouteToCommunication(req)) {
    req.url = "/api/notifications";
    return communicationProxy(req, res, next);
  }
  next();
});

app.use("/api/me/notification-prefs", (req, res, next) => {
  if (shouldRouteToCommunication(req)) {
    req.url = "/api/notifications/preferences";
    return communicationProxy(req, res, next);
  }
  next();
});

// Mount pass-through proxy to redirect everything else to the monolith
const monolithProxy = createProxyMiddleware(proxyOptions);
app.use("/", monolithProxy);

const server = http.createServer(app);

// Enable WebSocket forwarding on the HTTP server
server.on("upgrade", (req, socket, head) => {
  console.log(`[API Gateway] Upgrading WebSocket connection for: ${req.url}`);
  monolithProxy.upgrade(req, socket, head);
});

const handleShutdown = (signal) => {
  console.log(`[API Gateway] Received ${signal}. Starting graceful shutdown...`);
  server.close((err) => {
    if (err) {
      console.error(`[API Gateway] Error closing server: ${err.message}`);
      process.exit(1);
    }
    console.log("[API Gateway] Server closed successfully.");
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error("[API Gateway] Forced shutdown due to open connections.");
    process.exit(1);
  }, 10000).unref();
};

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[API Gateway] Listening on port ${PORT}, proxying to ${LEGACY_MONOLITH_URL}`);
    if (CANARY_BYPASS) {
      console.log("[API Gateway] Canary bypass enabled");
    }
  });

  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));
}

module.exports = { app, server, shouldRouteToCommunication, shouldRouteToContent };
