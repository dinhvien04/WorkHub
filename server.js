'use strict';

const http = require('http');
const env = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const { createApp } = require('./app');
const { initSocket } = require('./services/socketService');
const {
  startCompleteExpiredBookingsJob,
  stopCompleteExpiredBookingsJob,
} = require('./jobs/completeExpiredBookings');
const {
  startHoldRemindersJob,
  stopHoldRemindersJob,
} = require('./jobs/holdReminders');
const { startJobWorker, stopJobWorker } = require('./jobs/jobWorker');
const {
  startBookingRemindersJob,
  stopBookingRemindersJob,
} = require('./jobs/bookingReminders');
const logger = require('./utils/logger');

const app = createApp();
const server = http.createServer(app);

const { Server } = require('socket.io');
const io = new Server(server, {
  cors: { origin: false },
});
initSocket(io);

async function start() {
  await connectDB();
  startCompleteExpiredBookingsJob(60_000);
  startHoldRemindersJob(120_000);
  startJobWorker(15_000);
  startBookingRemindersJob(300_000);

  server.listen(env.PORT, () => {
    logger.info(`WorkHub Server running at http://localhost:${env.PORT}`);
  });
}

async function shutdown(signal) {
  logger.info(`${signal} received — shutting down`);
  stopCompleteExpiredBookingsJob();
  stopHoldRemindersJob();
  stopJobWorker();
  stopBookingRemindersJob();
  // Close Socket.IO before HTTP server
  try {
    if (io && typeof io.close === 'function') {
      await new Promise((resolve) => io.close(() => resolve()));
    }
  } catch (err) {
    logger.warn(`Socket.IO close: ${err.message}`);
  }
  server.close(async () => {
    try {
      await disconnectDB();
    } catch (err) {
      logger.warn(`DB disconnect: ${err.message}`);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  start().catch((err) => {
    logger.error('Failed to start server:', err.message);
    process.exit(1);
  });
}

module.exports = { app, server, start };
