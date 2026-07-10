'use strict';

/**
 * Product funnel: landing → search → detail → availability → booking → payment → confirmed → completed → review
 * Counts are server-side events (not client-only analytics).
 */
const Booking = require('../models/Booking');
const PaymentHistory = require('../models/Payment_History');
const Review = require('../models/Review');
const User = require('../models/User');

// In-process counters (also exportable via metrics); reset on restart.
const counters = {
  landing: 0,
  search: 0,
  detail: 0,
  availability: 0,
  booking_create: 0,
  payment_start: 0,
  confirmed: 0,
  completed: 0,
  review: 0,
};

function track(step) {
  const key = String(step || '').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(counters, key)) {
    counters[key] += 1;
  }
  return counters[key] || 0;
}

function snapshotProcess() {
  return { ...counters };
}

async function funnelReport({ days = 30 } = {}) {
  const since = new Date(Date.now() - Math.min(90, Math.max(1, days)) * 86400000);
  const match = { createdAt: { $gte: since } };

  const [
    newCustomers,
    bookingsCreated,
    bookingsConfirmed,
    bookingsCompleted,
    paymentsSuccess,
    reviews,
  ] = await Promise.all([
    User.countDocuments({ ...match, Role: 'customer' }),
    Booking.countDocuments(match),
    Booking.countDocuments({
      ...match,
      Status: { $in: ['confirmed', 'in-use', 'completed'] },
    }),
    Booking.countDocuments({ ...match, Status: 'completed' }),
    PaymentHistory.countDocuments({ ...match, Status: 'successful' }),
    Review.countDocuments(match),
  ]);

  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

  return {
    windowDays: days,
    since: since.toISOString(),
    stages: {
      landing_hint: 'client/page — process counters in processCounters',
      newCustomers,
      bookingsCreated,
      paymentsSuccess,
      bookingsConfirmed,
      bookingsCompleted,
      reviews,
    },
    conversion: {
      customerToBooking: pct(bookingsCreated, newCustomers),
      bookingToPayment: pct(paymentsSuccess, bookingsCreated),
      bookingToConfirmed: pct(bookingsConfirmed, bookingsCreated),
      confirmedToCompleted: pct(bookingsCompleted, bookingsConfirmed),
      completedToReview: pct(reviews, bookingsCompleted),
    },
    processCounters: snapshotProcess(),
    path: [
      'landing',
      'search',
      'detail',
      'availability',
      'booking',
      'payment',
      'confirmed',
      'completed',
      'review',
    ],
  };
}

module.exports = { track, snapshotProcess, funnelReport };
