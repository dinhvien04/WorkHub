"use strict";

const env = require("./config/env");
const db = require("./config/db");
const express = require("express");
const http = require("http");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const client = require("prom-client");

// Setup prom-client metrics registry
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const app = express();

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));
app.use(cookieParser());

// Healthcheck routes
app.get("/live", (req, res) => res.json({ status: "ok", service: "communication-service" }));
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
const pushRoutes = require("./routes/pushRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const preferenceRoutes = require("./routes/preferenceRoutes");

app.use("/api/push", pushRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/notifications/preferences", preferenceRoutes);

// Central error handler
app.use((err, req, res, _next) => {
  console.error("[Error] Unhandled request error:", err.message, err.stack);
  res.status(err.statusCode || 500).json({
    error: err.isOperational ? err.message : "Lỗi máy chủ nội bộ",
  });
});

const server = http.createServer(app);

// Re-export metrics registry so other services can add custom metrics
module.exports = { app, server, register };

// If run directly, connect database and start listening
if (require.main === module) {
  const consumerService = require("./services/consumerService");

  async function bootstrap() {
    await db.connectDb();

    // Connect to RabbitMQ and start consumers
    await consumerService.start();

    server.listen(env.PORT, () => {
      console.log(`[CommunicationService] Listening on port ${env.PORT}`);
    });
  }

  bootstrap().catch((err) => {
    console.error("[Bootstrap] Failed to start service:", err.message);
    process.exit(1);
  });

  const handleShutdown = async (signal) => {
    console.log(`[CommunicationService] Received ${signal}. Starting graceful shutdown...`);

    // 1. Close HTTP Server
    server.close(() => {
      console.log("[CommunicationService] HTTP server closed.");
    });

    // 2. Stop RabbitMQ connection
    await consumerService.stop().catch(console.error);

    // 3. Disconnect from database
    await db.disconnectDb().catch(console.error);

    process.exit(0);
  };

  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));
}
