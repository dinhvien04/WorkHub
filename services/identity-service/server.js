"use strict";

const env = require("./config/env");
const db = require("./config/db");
const express = require("express");
const http = require("http");
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

app.use("/api/auth", authRoutes);
app.use("/api", sessionRoutes);

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
