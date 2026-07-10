'use strict';

const Booking = require('../models/Booking');
const jobQueue = require('../services/jobQueue');
const logger = require('../utils/logger');

let timer = null;
let running = false;

/**
 * Enqueue reminders for bookings starting within 2 hours (once per booking).
 */
async function runBookingReminders() {
  if (running) return { skipped: true };
  running = true;
  try {
    const now = new Date();
    const in2h = new Date(now.getTime() + 2 * 3600 * 1000);
    const bookings = await Booking.find({
      Status: { $in: ['confirmed', 'pending'] },
      StartTime: { $gte: now, $lte: in2h },
      ReminderSent: { $ne: true },
    })
      .limit(40)
      .select('_id CustomerID StartTime Snapshot');

    let n = 0;
    for (const b of bookings) {
      await jobQueue.enqueue({
        type: 'booking_reminder',
        queue: 'notifications',
        ownerUserId: b.CustomerID,
        payload: {
          userId: b.CustomerID,
          bookingId: b._id,
          title: 'Sắp đến giờ đặt chỗ',
          body: `${b.Snapshot?.SpaceName || 'Booking'} lúc ${new Date(b.StartTime).toLocaleString('vi-VN')}`,
          link: `/booking/detail?id=${b._id}`,
        },
      });
      await Booking.updateOne({ _id: b._id }, { $set: { ReminderSent: true } });
      n += 1;
    }
    if (n) logger.info(`Enqueued ${n} booking reminder(s)`);
    return { enqueued: n };
  } finally {
    running = false;
  }
}

function startBookingRemindersJob(intervalMs = 300_000) {
  if (timer) return;
  timer = setInterval(() => {
    runBookingReminders();
  }, intervalMs);
  if (timer.unref) timer.unref();
  logger.info(`Booking reminders every ${intervalMs}ms`);
}

function stopBookingRemindersJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  runBookingReminders,
  startBookingRemindersJob,
  stopBookingRemindersJob,
};
