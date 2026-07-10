'use strict';

const crypto = require('crypto');
const Booking = require('../models/Booking');
const env = require('../config/env');
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} = require('../utils/errors');
const bookingService = require('./bookingService');

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || !String(token).includes('.')) return null;
  const [body, sig] = String(token).split('.');
  const expected = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(body)
    .digest('base64url');
  try {
    if (
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Short-lived QR token for a booking (customer or host can mint for that booking).
 */
async function mintCheckInToken({ bookingId, actorId, actorRole, ttlMinutes = 30 }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new NotFoundError('Không tìm thấy booking.');
  const isCustomer = String(booking.CustomerID) === String(actorId);
  const isHost = String(booking.HostID) === String(actorId);
  if (!isCustomer && !isHost && actorRole !== 'admin') {
    throw new ForbiddenError('Không có quyền tạo mã check-in.');
  }
  if (!['confirmed', 'in-use'].includes(booking.Status)) {
    throw new ValidationError('Booking chưa sẵn sàng check-in.');
  }
  const code = `WH-${String(booking._id).slice(-6).toUpperCase()}`;
  const payload = {
    bid: String(booking._id),
    code,
    exp: Date.now() + ttlMinutes * 60 * 1000,
  };
  return {
    token: signPayload(payload),
    code,
    expiresAt: new Date(payload.exp).toISOString(),
    bookingId: booking._id,
  };
}

async function checkInWithToken({ hostId, token, code }) {
  let bookingId = null;
  if (token) {
    const payload = verifyToken(token);
    if (!payload?.bid) throw new ValidationError('Mã QR không hợp lệ hoặc đã hết hạn.');
    bookingId = payload.bid;
  } else if (code) {
    const suffix = String(code).replace(/^WH-/i, '').toLowerCase();
    const booking = await Booking.findOne({
      HostID: hostId,
      Status: 'confirmed',
      $expr: {
        $eq: [{ $substrBytes: [{ $toString: '$_id' }, -6, 6] }, suffix],
      },
    });
    // Fallback: scan recent confirmed bookings
    if (!booking) {
      const list = await Booking.find({ HostID: hostId, Status: 'confirmed' })
        .sort({ StartTime: 1 })
        .limit(100)
        .select('_id');
      const match = list.find(
        (b) => String(b._id).slice(-6).toLowerCase() === suffix.toLowerCase()
      );
      if (!match) throw new NotFoundError('Không tìm thấy booking với mã này.');
      bookingId = match._id;
    } else {
      bookingId = booking._id;
    }
  } else {
    throw new ValidationError('Cần token QR hoặc booking code.');
  }

  const updated = await bookingService.checkInBooking(hostId, bookingId);
  if (updated && !updated.CheckInAt) {
    updated.CheckInAt = new Date();
    await updated.save();
  }
  return updated;
}

async function markNoShow({ hostId, bookingId, reason = '' }) {
  const booking = await Booking.findOne({ _id: bookingId, HostID: hostId });
  if (!booking) throw new NotFoundError('Không tìm thấy booking.');
  if (!['confirmed', 'pending'].includes(booking.Status)) {
    throw new ValidationError('Chỉ đánh dấu no-show với đơn confirmed/pending.');
  }
  // Free slots; keep financial history
  booking.Status = 'cancelled';
  booking.CancelReason = `no_show: ${String(reason || '').slice(0, 400)}`;
  booking.CancelledAt = new Date();
  booking.CancelledBy = hostId;
  booking.NoShow = true;
  await booking.save();
  const BookingSlot = require('../models/BookingSlot');
  await BookingSlot.deleteMany({ BookingID: booking._id });
  return booking;
}

module.exports = {
  mintCheckInToken,
  checkInWithToken,
  markNoShow,
  signPayload,
  verifyToken,
};
