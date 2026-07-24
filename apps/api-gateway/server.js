"use strict";

require("dotenv").config();
const http = require("http");
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const cors = require("cors");

const PORT = Number(process.env.PORT) || 3000;
const LEGACY_MONOLITH_URL = process.env.LEGACY_MONOLITH_URL || "http://localhost:3001";
const CANARY_BYPASS = process.env.CANARY_BYPASS === "true";

const app = express();

// Coarse rate limiter for edge protection
const edgeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // Limit each IP to 1000 requests per window
  message: { error: "Too many requests from this IP, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(edgeLimiter);

app.use(cors({
  origin: true,
  credentials: true,
}));

// Request ID middleware
app.use((req, res, next) => {
  const reqId = req.headers["x-request-id"] || crypto.randomUUID();
  req.id = reqId;
  res.setHeader("X-Request-Id", reqId);
  next();
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

module.exports = { app, server };
