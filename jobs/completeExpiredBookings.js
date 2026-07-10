'use strict';

const bookingService = require('../services/bookingService');
const logger = require('../utils/logger');

let running = false;
let timer = null;

/**
 * Periodic job: complete in-use bookings past EndTime.
 * Simple in-process lock prevents overlapping runs on the same instance.
 */
async function runCompleteExpiredBookings() {
  if (running) return { skipped: true };
  running = true;
  try {
    const result = await bookingService.completeExpiredBookings();
    if (result.modifiedCount > 0) {
      logger.info(`Completed ${result.modifiedCount} expired booking(s).`);
    }
    return result;
  } catch (err) {
    logger.error('completeExpiredBookings failed:', err.message);
    return { error: err.message };
  } finally {
    running = false;
  }
}

function startCompleteExpiredBookingsJob(intervalMs = 60_000) {
  if (timer) return;
  // Delay first run slightly so DB is ready
  timer = setInterval(() => {
    runCompleteExpiredBookings();
  }, intervalMs);
  if (timer.unref) timer.unref();
  logger.info(`Booking completion job scheduled every ${intervalMs}ms`);
}

function stopCompleteExpiredBookingsJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  runCompleteExpiredBookings,
  startCompleteExpiredBookingsJob,
  stopCompleteExpiredBookingsJob,
};
