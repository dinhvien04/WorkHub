"use strict";

const env = require("./config/env");
const db = require("./config/db");
const express = require("express");
const http = require("http");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const client = require("prom-client");

const authRoutes = require("./routes/authRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const keyManager = require("./services/keyManager");
const tokenService = require("./services/tokenService");
const outboxPublisher = require("./workers/outboxPublisher");
const amqpService = require("./services/amqpService");
const { safeCompare, attachAuth } = require("./middlewares/auth");
const { ensureCsrfCookie, csrfProtection } = require("./middlewares/csrf");
const User = require("./models/User");
const UserSession = require("./models/Session");
const crypto = require("crypto");

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const app = express();

app.disable("x-powered-by");
app.use(
  helmet({
    // Pure JSON API — no browsing context to protect with a CSP.
    contentSecurityPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: "no-referrer" },
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));
app.use(cookieParser());

// —— Health & metrics (before auth so probes stay cheap) ——

app.get("/live", (req, res) => res.json({ status: "ok", service: "identity-service" }));

app.get("/ready", async (req, res) => {
  const mongoose = require("mongoose");
  const dbReady = mongoose.connection.readyState === 1;
  if (dbReady) return res.json({ status: "ready" });
  return res.status(503).json({ status: "not_ready", db: "disconnected" });
});

app.get("/metrics", async (req, res) => {
  try {
    res.setHeader("Content-Type", register.contentType);
    res.send(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

/**
 * JWKS for downstream RS256 verification.
 *
 * The ETag is derived from the key set, so a rotation changes it and caches
 * revalidate on their own instead of pinning a retired modulus.
 */
app.get("/.well-known/jwks.json", (req, res) => {
  const { document, etag } = keyManager.getJwksWithEtag();
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");

  if (req.headers["if-none-match"] === etag) return res.status(304).end();
  return res.json(document);
});

/**
 * Identify a trusted internal caller.
 *
 * Only callers that present the internal secret get a `internalCaller` label,
 * and only specific labels unlock privileged behaviour (see host registration
 * in authController). A client-supplied X-Service-Name alone proves nothing.
 */
const KNOWN_INTERNAL_CALLERS = new Set(["api-gateway", "onboarding-saga"]);

app.use((req, res, next) => {
  const internalToken = req.headers["x-internal-token"];
  const serviceName = String(req.headers["x-service-name"] || "");

  if (
    internalToken &&
    safeCompare(internalToken, env.IDENTITY_INTERNAL_SECRET) &&
    KNOWN_INTERNAL_CALLERS.has(serviceName)
  ) {
    req.internalCaller = serviceName;
  }
  return next();
});

// —— Authentication + CSRF ——
// Auth resolves once per request so CSRF can bind to the session id without a
// second database round trip.
app.use(attachAuth);
app.use(ensureCsrfCookie);

/**
 * Endpoints reachable without an existing session carry no CSRF risk: there is
 * no ambient cookie for an attacker's page to ride on.
 */
const CSRF_EXEMPT = new Set([
  "POST /api/auth/login",
  "POST /api/auth/register",
  "POST /api/auth/2fa/verify",
  "POST /api/auth/forgot-password",
  "POST /api/auth/reset-password",
  "POST /api/auth/email/confirm",
  "POST /api/auth/email/request-verify",
  "POST /api/auth/webauthn/login/options",
  "POST /api/auth/webauthn/login/verify",
  "POST /api/auth/google/mock",
]);

app.use((req, res, next) => {
  // Service-to-service endpoints authenticate with the internal secret, not a
  // cookie, so there is no ambient credential for CSRF to protect.
  if (req.path.startsWith("/internal/")) return next();
  if (CSRF_EXEMPT.has(`${req.method} ${req.path}`)) return next();
  return csrfProtection(req, res, next);
});

app.use("/api/auth", authRoutes);
app.use("/api", sessionRoutes);

// —— Internal introspection (gateway only) ——

function internalAuthOk(req) {
  const internalToken = req.headers["x-internal-token"];
  const serviceName = req.headers["x-service-name"];
  return (
    Boolean(internalToken) &&
    safeCompare(internalToken, env.IDENTITY_INTERNAL_SECRET) &&
    serviceName === "api-gateway"
  );
}

app.post("/internal/auth/introspect", async (req, res) => {
  if (!internalAuthOk(req)) {
    return res.status(401).json({ error: "Yêu cầu xác thực mạng nội bộ không hợp lệ." });
  }

  const { token } = req.body || {};
  if (!token) return res.json({ active: false });

  let claims;
  try {
    claims = tokenService.verifyAccessToken(token);
  } catch {
    try {
      // Monolith-issued HS256 tokens, only while the sunset window is open.
      claims = tokenService.verifyLegacyAccessToken(token);
    } catch {
      return res.json({ active: false });
    }
  }

  try {
    const user = await User.findById(claims.userId)
      .select("Status tokenVersion Role Email FullName")
      .lean();
    if (!user || user.Status !== "active") return res.json({ active: false });

    const dbVersion = typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
    if (claims.tokenVersion !== dbVersion) return res.json({ active: false });

    let sessionId = null;
    if (claims.sid) {
      const sidHash = crypto.createHash("sha256").update(String(claims.sid)).digest("hex");
      const session = await UserSession.findOne({
        UserID: claims.userId,
        RevokedAt: null,
        SidHash: sidHash,
      })
        .select("ExpiresAt PublicSessionID")
        .lean();

      if (!session) return res.json({ active: false });
      if (session.ExpiresAt && new Date(session.ExpiresAt) < new Date()) {
        return res.json({ active: false });
      }
      sessionId = session.PublicSessionID;
    }

    return res.json({
      active: true,
      user: {
        userId: user._id.toString(),
        role: user.Role,
        email: user.Email,
        fullName: user.FullName,
        tokenVersion: dbVersion,
      },
      sessionId,
      legacy: Boolean(claims.legacy),
      // Lets the gateway cap its cache at the token's own lifetime.
      expiresIn: 60,
    });
  } catch (err) {
    console.error("[Introspect] Lookup failed:", err.message);
    return res.status(503).json({ error: "Introspection tạm thời không khả dụng." });
  }
});

// —— Error handling ——

app.use((err, req, res, _next) => {
  const status = err.statusCode || 500;
  if (status >= 500) {
    console.error("[Error] Unhandled request error:", err.message, err.stack);
  }
  res.status(status).json({
    error: err.isOperational ? err.message : "Lỗi máy chủ nội bộ",
    ...(err.code ? { code: err.code } : {}),
  });
});

const server = http.createServer(app);
module.exports = { app, server, register };

if (require.main === module) {
  async function bootstrap() {
    await db.connectDb();
    // Fail fast on a misconfigured keyring rather than at first login.
    keyManager.getActiveKey();

    outboxPublisher.start();
    server.listen(env.PORT, () => {
      console.log(`[IdentityService] Listening on port ${env.PORT}`);
    });
  }

  bootstrap().catch((err) => {
    console.error("[Bootstrap] Failed to start service:", err.message);
    process.exit(1);
  });

  let shuttingDown = false;
  const handleShutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[IdentityService] Received ${signal}. Starting graceful shutdown...`);

    server.close(() => console.log("[IdentityService] HTTP server closed."));
    await outboxPublisher.stop().catch((err) => console.error(err.message));
    await amqpService.close().catch((err) => console.error(err.message));
    await db.disconnectDb().catch((err) => console.error(err.message));
    process.exit(0);
  };

  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));
}
