"use strict";

const env = require("./config/env");
const db = require("./config/db");
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const client = require("prom-client");

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));
app.use(cookieParser());

app.get("/live", (req, res) =>
  res.json({ status: "ok", service: "identity-service" }),
);
app.get("/ready", async (req, res) => {
  const mongoose = require("mongoose");
  const dbReady = mongoose.connection.readyState === 1;
  if (dbReady) return res.json({ status: "ready" });
  return res.status(503).json({
    status: "not_ready",
    db: dbReady ? "connected" : "disconnected",
  });
});

app.get("/metrics", async (req, res) => {
  try {
    res.setHeader("Content-Type", register.contentType);
    res.send(await register.metrics());
  } catch (err) {
    res.status(500).end(err);
  }
});

const authRoutes = require("./routes/authRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const keyManager = require("./services/keyManager");
const { safeCompare } = require("./middlewares/auth");
const User = require("./models/User");
const UserSession = require("./models/Session");
const jwt = require("jsonwebtoken");

app.use("/api/auth", authRoutes);
app.use("/api", sessionRoutes);

// JWKS endpoint exposing public key parameters (Phase G)
app.get("/.well-known/jwks.json", (req, res) => {
  res.json(keyManager.getJwks());
});

// Internal token introspection endpoint (Phase H)
app.post("/internal/auth/introspect", async (req, res) => {
  const internalToken = req.headers["x-internal-token"];
  const serviceName = req.headers["x-service-name"];

  if (
    !internalToken ||
    !safeCompare(internalToken, env.IDENTITY_INTERNAL_SECRET) ||
    serviceName !== "api-gateway"
  ) {
    return res.status(401).json({ error: "Yêu cầu xác thực mạng nội bộ không hợp lệ." });
  }

  const { token } = req.body || {};
  if (!token) return res.json({ active: false });

  try {
    const key = keyManager.getActiveKey();
    const decoded = jwt.verify(token, key.publicKey, {
      algorithms: ["RS256"],
      issuer: "workhub-identity",
      audience: "workhub-api-gateway",
    });

    const userId = decoded.userId || decoded.id || decoded._id || decoded.sub;
    if (!userId) return res.json({ active: false });

    // Query DB to check user status and tokenVersion
    const user = await User.findById(userId).select("Status tokenVersion").lean();
    if (!user || user.Status !== "active") return res.json({ active: false });

    const tokenVersion = typeof decoded.tokenVersion === "number" ? decoded.tokenVersion : 0;
    const dbVersion = typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
    if (tokenVersion !== dbVersion) return res.json({ active: false });

    // Verify session status if sid is present
    if (decoded.sid) {
      const sidHash = crypto.createHash("sha256").update(String(decoded.sid)).digest("hex");
      const sess = await UserSession.findOne({
        UserID: userId,
        RevokedAt: null,
        SidHash: sidHash,
      }).lean();
      if (!sess) return res.json({ active: false });
      if (sess.ExpiresAt && new Date(sess.ExpiresAt) < new Date()) {
        return res.json({ active: false });
      }
    }

    return res.json({
      active: true,
      user: {
        userId: user._id.toString(),
        role: user.Role,
        email: user.Email,
        fullName: user.FullName,
        tokenVersion: user.tokenVersion || 0,
      },
      sid: decoded.sid || null,
      sessionId: decoded.sid ? crypto.createHash("sha256").update(String(decoded.sid)).digest("hex") : null,
    });
  } catch (err) {
    // Also support verifying legacy monolith tokens during transition window (Phase G / pre-auth)
    try {
      const decodedLegacy = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: "workhub-auth",
        audience: "workhub-app",
      });

      const userId = decodedLegacy.userId || decodedLegacy.id || decodedLegacy._id;
      if (!userId) return res.json({ active: false });

      const user = await User.findById(userId).select("Status tokenVersion").lean();
      if (!user || user.Status !== "active") return res.json({ active: false });

      const tokenVersion = typeof decodedLegacy.tokenVersion === "number" ? decodedLegacy.tokenVersion : 0;
      const dbVersion = typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
      if (tokenVersion !== dbVersion) return res.json({ active: false });

      if (decodedLegacy.sid) {
        const sidHash = crypto.createHash("sha256").update(String(decodedLegacy.sid)).digest("hex");
        const sess = await UserSession.findOne({
          UserID: userId,
          RevokedAt: null,
          $or: [{ SidHash: sidHash }, { Sid: String(decodedLegacy.sid) }],
        }).lean();
        if (!sess) return res.json({ active: false });
        if (sess.ExpiresAt && new Date(sess.ExpiresAt) < new Date()) {
          return res.json({ active: false });
        }
      }

      return res.json({
        active: true,
        user: {
          userId: user._id.toString(),
          role: user.Role,
          email: user.Email,
          fullName: user.FullName,
          tokenVersion: user.tokenVersion || 0,
        },
        sid: decodedLegacy.sid || null,
        sessionId: decodedLegacy.sid ? crypto.createHash("sha256").update(String(decodedLegacy.sid)).digest("hex") : null,
      });
    } catch (_) {
      return res.json({ active: false });
    }
  }
});

app.use((err, req, res, _next) => {
  console.error("[Error] Unhandled request error:", err.message, err.stack);
  res.status(err.statusCode || 500).json({
    error: err.isOperational ? err.message : "Lỗi máy chủ nội bộ",
  });
});

const server = http.createServer(app);
module.exports = { app, server, register };

if (require.main === module) {
  async function bootstrap() {
    await db.connectDb();
    server.listen(env.PORT, () => {
      console.log(`[IdentityService] Listening on port ${env.PORT}`);
    });
  }

  bootstrap().catch((err) => {
    console.error("[Bootstrap] Failed to start service:", err.message);
    process.exit(1);
  });

  const handleShutdown = async (signal) => {
    console.log(`[IdentityService] Received ${signal}. Starting graceful shutdown...`);
    server.close(() => {
      console.log("[IdentityService] HTTP server closed.");
    });
    await db.disconnectDb().catch(console.error);
    process.exit(0);
  };

  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));
}
