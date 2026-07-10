'use strict';

const Booking = require('../models/Booking');

async function hostInboxCounts(hostId) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const soon = new Date(now.getTime() + 2 * 3600000);
  const base = { HostID: hostId };

  const [newCount, awaitingPayment, today, inUse, endingSoon, completed, cancelled] =
    await Promise.all([
      Booking.countDocuments({
        ...base,
        Status: { $in: ['pending', 'hold', 'awaiting_payment'] },
      }),
      Booking.countDocuments({
        ...base,
        Status: { $in: ['awaiting_payment', 'payment_under_review'] },
      }),
      Booking.countDocuments({
        ...base,
        StartTime: { $lte: endOfDay },
        EndTime: { $gte: startOfDay },
        Status: { $in: ['confirmed', 'in-use', 'pending', 'payment_under_review'] },
      }),
      Booking.countDocuments({ ...base, Status: 'in-use' }),
      Booking.countDocuments({
        ...base,
        Status: 'in-use',
        EndTime: { $gte: now, $lte: soon },
      }),
      Booking.countDocuments({ ...base, Status: 'completed' }),
      Booking.countDocuments({
        ...base,
        Status: { $in: ['cancelled', 'rejected', 'expired'] },
      }),
    ]);

  return {
    new: newCount,
    awaiting_payment: awaitingPayment,
    today,
    in_use: inUse,
    ending_soon: endingSoon,
    completed,
    cancelled,
  };
}

function buildFilter(hostId, bucket) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const soon = new Date(now.getTime() + 2 * 3600000);
  const base = { HostID: hostId };
  const filter = { ...base };

  switch (bucket) {
    case 'new':
      filter.Status = { $in: ['pending', 'hold', 'awaiting_payment'] };
      break;
    case 'awaiting_payment':
      filter.Status = { $in: ['awaiting_payment', 'payment_under_review'] };
      break;
    case 'awaiting_confirmation':
      filter.Status = 'pending';
      break;
    case 'today':
      filter.StartTime = { $lte: endOfDay };
      filter.EndTime = { $gte: startOfDay };
      filter.Status = { $in: ['confirmed', 'in-use', 'pending', 'payment_under_review'] };
      break;
    case 'in_use':
      filter.Status = 'in-use';
      break;
    case 'ending_soon':
      filter.Status = 'in-use';
      filter.EndTime = { $gte: now, $lte: soon };
      break;
    case 'completed':
      filter.Status = 'completed';
      break;
    case 'cancelled':
      filter.Status = { $in: ['cancelled', 'rejected', 'expired'] };
      break;
    default:
      break;
  }
  return filter;
}

async function listHostInbox(hostId, opts = {}) {
  const bucket = opts.bucket || 'all';
  const page = Number(opts.page) || 1;
  const limit = Math.min(100, Number(opts.limit) || 30);
  const filter = buildFilter(hostId, bucket);
  const skip = (Math.max(1, page) - 1) * limit;

  const [items, total, counts] = await Promise.all([
    Booking.find(filter)
      .sort({ StartTime: ['completed', 'cancelled'].includes(bucket) ? -1 : 1 })
      .skip(skip)
      .limit(limit)
      .populate('CustomerID', 'FullName Email')
      .populate('SpaceID', 'Name SpaceCode')
      .lean(),
    Booking.countDocuments(filter),
    hostInboxCounts(hostId),
  ]);

  return { items, total, page, limit, bucket, counts };
}

module.exports = {
  listHostInbox,
  hostInboxCounts,
};
