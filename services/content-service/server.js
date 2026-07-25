"use strict";

const env = require("./config/env");
const db = require("./config/db");
const express = require("express");
const http = require("http");
const cookieParser = require("cookie-parser");
const client = require("prom-client");

// Setup prom-client metrics registry
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const app = express();
const idempotency = require("./middlewares/idempotency");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ limit: "2mb", extended: true }));
app.use(cookieParser());
app.use(idempotency());

// Healthcheck routes
app.get("/live", (req, res) => res.json({ status: "ok", service: "content-service" }));
app.get("/ready", async (req, res) => {
  const mongoose = require("mongoose");
  const consumerService = require("./services/consumerService");
  const dbReady = mongoose.connection.readyState === 1;
  const amqpReady = consumerService.isConnected();

  if (dbReady && amqpReady) {
    return res.json({ status: "ready" });
  }
  return res.status(503).json({
    status: "not_ready",
    db: dbReady ? "connected" : "disconnected",
    amqp: amqpReady ? "connected" : "disconnected",
  });
});

// Prometheus metrics route
app.get("/metrics", async (req, res) => {
  try {
    res.setHeader("Content-Type", register.contentType);
    res.send(await register.metrics());
  } catch (err) {
    res.status(500).end(err);
  }
});

// Business routes
const pageRoutes = require("./routes/pageRoutes");
const redirectRoutes = require("./routes/redirectRoutes");
const i18nRoutes = require("./routes/i18nRoutes");

app.use("/api/content/pages", pageRoutes);
app.use("/api/seo/redirects", redirectRoutes);
app.use("/api/i18n", i18nRoutes);

// Central error handler
app.use((err, req, res, _next) => {
  console.error("[Error] Unhandled request error:", err.message, err.stack);
  res.status(err.statusCode || 500).json({
    error: err.isOperational ? err.message : "Lỗi máy chủ nội bộ",
  });
});

const server = http.createServer(app);

// Re-export metrics registry
module.exports = { app, server, register };

// If run directly, connect database and start listening
if (require.main === module) {
  const consumerService = require("./services/consumerService");
  const outboxPublisher = require("./workers/outboxPublisher");

  const processRole = String(process.env.PROCESS_ROLE || "all").toLowerCase();
  const isWeb = processRole === "web" || processRole === "all";
  const isWorker = processRole === "worker" || processRole === "all";

  async function bootstrap() {
    await db.connectDb();

    if (isWorker) {
      // Connect to RabbitMQ and start consumers
      await consumerService.start();
      // Start outbox publisher worker
      outboxPublisher.start(5000);
    }

    if (isWeb) {
      server.listen(env.PORT, () => {
        console.log(`[ContentService] Listening on port ${env.PORT}`);
      });
    } else {
      console.log(`[ContentService] Worker started (no HTTP listener)`);
      // Keep process alive
      setInterval(() => {}, 60000);
    }
  }

  bootstrap().catch((err) => {
    console.error("[Bootstrap] Failed to start service:", err.message);
    process.exit(1);
  });

  const handleShutdown = async (signal) => {
    console.log(`[ContentService] Received ${signal}. Starting graceful shutdown...`);

    // 1. Close HTTP Server
    if (isWeb) {
      server.close(() => {
        console.log("[ContentService] HTTP server closed.");
      });
    }

    // 2. Stop RabbitMQ connection
    if (isWorker) {
      outboxPublisher.stop();
      await consumerService.stop().catch(console.error);
    }

    // 3. Disconnect from database
    await db.disconnectDb().catch(console.error);

    process.exit(0);
  };

  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));
}
