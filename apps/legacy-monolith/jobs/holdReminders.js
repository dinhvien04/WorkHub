'use strict';

const Booking = require('../models/Booking');
const { notifyUser } = require('../services/notificationService');
const logger = require('../utils/logger');

let running = false;
let timer = null;

/**
 * Remind customers when hold is about to expire (within 10 minutes).
 */
async function runHoldReminders() {
  if (running) return { skipped: true };
  running = true;
  try {
    const now = new Date();
    const in10 = new Date(now.getTime() + 10 * 60 * 1000);
    const holds = await Booking.find({
      Status: { $in: ['hold', 'awaiting_payment', 'pending'] },
      HoldExpiresAt: { $gt: now, $lte: in10 },
      HoldReminderSent: { $ne: true },
    })
      .limit(50)
      .select('_id CustomerID HoldExpiresAt Snapshot');

    let sent = 0;
    for (const b of holds) {
      try {
        await notifyUser({
          userId: b.CustomerID,
          title: 'Sắp hết hạn giữ chỗ',
          body: `${b.Snapshot?.SpaceName || 'Booking'} — thanh toán trước khi hết giờ giữ chỗ.`,
          type: 'booking',
          entityType: 'Booking',
          entityId: b._id,
          link: `/payment?bookingId=${b._id}`,
        });
        await Booking.updateOne({ _id: b._id }, { $set: { HoldReminderSent: true } });
        sent += 1;
      } catch (err) {
        logger.warn(`hold reminder failed ${b._id}: ${err.message}`);
      }
    }
    if (sent) logger.info(`Hold reminders sent: ${sent}`);
    return { sent };
  } finally {
    running = false;
  }
}

function startHoldRemindersJob(intervalMs = 120_000) {
  if (timer) return;
  timer = setInterval(() => {
    runHoldReminders();
  }, intervalMs);
  if (timer.unref) timer.unref();
  logger.info(`Hold reminder job every ${intervalMs}ms`);
}

function stopHoldRemindersJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  runHoldReminders,
  startHoldRemindersJob,
  stopHoldRemindersJob,
};
