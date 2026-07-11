"use strict";

const http = require("http");
const env = require("./config/env");
const {
  connectDB,
  disconnectDB,
  assertTransactionCapability,
} = require("./config/db");
const { createApp } = require("./app");
const { initSocket } = require("./services/socketService");
const {
  startCompleteExpiredBookingsJob,
  stopCompleteExpiredBookingsJob,
} = require("./jobs/completeExpiredBookings");
const {
  startHoldRemindersJob,
  stopHoldRemindersJob,
} = require("./jobs/holdReminders");
const { startJobWorker, stopJobWorker } = require("./jobs/jobWorker");
const {
  startBookingRemindersJob,
  stopBookingRemindersJob,
} = require("./jobs/bookingReminders");
const logger = require("./utils/logger");

/**
 * PROCESS_ROLE:
 *   web    — HTTP + Socket.IO only
 *   worker — outbox, jobs, expiry, reminders
 *   all    — both (default for local/dev)
 */
const processRole = String(process.env.PROCESS_ROLE || "all").toLowerCase();
const isWeb = processRole === "web" || processRole === "all";
const isWorker = processRole === "worker" || processRole === "all";

const app = createApp();
const server = http.createServer(app);

let io = null;
if (isWeb) {
  const { Server } = require("socket.io");
  io = new Server(server, {
    cors: { origin: false },
  });
  initSocket(io);
}

async function start() {
  await connectDB();
  if (
    env.ENABLE_TRANSACTIONS &&
    (env.isProduction || process.env.REQUIRE_TX_PROBE === "1")
  ) {
    await assertTransactionCapability({ required: true });
  }

  if (isWorker) {
    startCompleteExpiredBookingsJob(60_000);
    startHoldRemindersJob(120_000);
    startJobWorker(15_000);
    startBookingRemindersJob(300_000);
    logger.info(`Worker jobs started (PROCESS_ROLE=${processRole})`);
  }

  if (isWeb) {
    server.listen(env.PORT, () => {
      logger.info(
        `WorkHub web listening at http://localhost:${env.PORT} (PROCESS_ROLE=${processRole})`,
      );
    });
  } else {
    logger.info(
      `WorkHub worker running without HTTP (PROCESS_ROLE=${processRole})`,
    );
    // Keep process alive
    setInterval(() => {}, 60_000).unref?.();
  }
}

async function shutdown(signal) {
  logger.info(`${signal} received — shutting down`);
  if (isWorker) {
    stopCompleteExpiredBookingsJob();
    stopHoldRemindersJob();
    stopJobWorker();
    stopBookingRemindersJob();
  }
  try {
    if (io && typeof io.close === "function") {
      await new Promise((resolve) => io.close(() => resolve()));
    }
  } catch (err) {
    logger.warn(`Socket.IO close: ${err.message}`);
  }
  if (isWeb && server.listening) {
    server.close(async () => {
      try {
        await disconnectDB();
      } catch (err) {
        logger.warn(`DB disconnect: ${err.message}`);
      }
      process.exit(0);
    });
  } else {
    try {
      await disconnectDB();
    } catch (err) {
      logger.warn(`DB disconnect: ${err.message}`);
    }
    process.exit(0);
  }
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

if (require.main === module) {
  start().catch((err) => {
    logger.error("Failed to start server:", err.message);
    process.exit(1);
  });
}

module.exports = { app, server, start, processRole };
