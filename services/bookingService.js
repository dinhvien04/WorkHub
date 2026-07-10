'use strict';

const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const BookingSlot = require('../models/BookingSlot');
const Space = require('../models/Space');
const PaymentHistory = require('../models/Payment_History');
const logActivity = require('../utils/auditLogger');
const env = require('../config/env');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} = require('../utils/errors');

const ACTIVE_STATUSES = ['pending', 'confirmed', 'in-use'];

const allowedTransitions = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['in-use', 'cancelled'],
  'in-use': ['completed'],
  completed: [],
  cancelled: [],
};

function assertTransition(from, to) {
  const allowed = allowedTransitions[from] || [];
  if (!allowed.includes(to)) {
    throw new ValidationError(`Không thể chuyển trạng thái booking từ "${from}" sang "${to}".`);
  }
}

/**
 * Build slot start times [start, end) stepped by BOOKING_SLOT_MINUTES.
 */
function buildSlotStarts(start, end, slotMinutes = env.BOOKING_SLOT_MINUTES) {
  const slots = [];
  const step = slotMinutes * 60 * 1000;
  let cursor = new Date(start);
  // Align to slot boundary
  const ms = cursor.getTime();
  const aligned = Math.floor(ms / step) * step;
  cursor = new Date(aligned);
  if (cursor < start) cursor = new Date(cursor.getTime() + step);

  while (cursor < end) {
    slots.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + step);
  }
  if (slots.length === 0) {
    // Always at least one slot for short bookings
    slots.push(new Date(Math.floor(start.getTime() / step) * step));
  }
  return slots;
}

async function withOptionalTransaction(work) {
  // Prefer non-transaction path first for standalone Mongo / memory server.
  // Slot unique index still prevents concurrent double-booking.
  if (process.env.FORCE_NO_TX === '1' || process.env.NODE_ENV === 'test') {
    return work(null);
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch {
      /* ignore */
    }
    // Fallback when replica set / transactions unavailable
    if (
      err.message &&
      (err.message.includes('Transaction numbers') ||
        err.message.includes('replica set') ||
        err.message.includes('Transaction') ||
        err.codeName === 'IllegalOperation' ||
        err.code === 20)
    ) {
      return work(null);
    }
    throw err;
  } finally {
    session.endSession();
  }
}

async function createBooking({ customerId, spaceId, startTime, endTime, note = '' }) {
  if (!spaceId || !startTime || !endTime) {
    throw new ValidationError('Thiếu thông tin đặt chỗ (spaceId, startTime, endTime).');
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ValidationError('Ngày/giờ không hợp lệ.');
  }
  if (end <= start) throw new ValidationError('EndTime phải lớn hơn StartTime.');
  if (start.getTime() < Date.now() - 60_000) {
    throw new ValidationError('Không thể đặt phòng ở thời điểm trong quá khứ.');
  }

  const space = await Space.findById(spaceId);
  if (!space) throw new NotFoundError('Không tìm thấy phòng.');
  if (space.Status !== 'available') {
    throw new ValidationError('Không gian hiện không khả dụng để đặt.');
  }

  const hours = (end - start) / (1000 * 60 * 60);
  const total = Math.round(hours * (space.PricePerHour || 0));
  const deposit =
    space.DepositAmount > 0
      ? space.DepositAmount
      : Math.round(total * 0.3);

  const slotStarts = buildSlotStarts(start, end);

  try {
    return await withOptionalTransaction(async (session) => {
      // Soft conflict check (slots are the real lock)
      let conflictQuery = Booking.findOne({
        SpaceID: spaceId,
        Status: { $in: ACTIVE_STATUSES },
        StartTime: { $lt: end },
        EndTime: { $gt: start },
      });
      if (session) conflictQuery = conflictQuery.session(session);
      const conflict = await conflictQuery;

      if (conflict) {
        throw new ConflictError('Khung giờ này vừa có người khác đặt. Vui lòng chọn giờ khác!');
      }

      const doc = {
        CustomerID: customerId,
        SpaceID: spaceId,
        HostID: space.HostID,
        StartTime: start,
        EndTime: end,
        TotalAmount: total,
        DepositAmount: deposit,
        Status: 'pending',
        Note: note || '',
      };

      let booking;
      if (session) {
        [booking] = await Booking.create([doc], { session });
      } else {
        booking = await Booking.create(doc);
      }

      const slotDocs = slotStarts.map((SlotStart) => ({
        SpaceID: spaceId,
        BookingID: booking._id,
        SlotStart,
      }));

      try {
        if (session) {
          await BookingSlot.insertMany(slotDocs, { session, ordered: true });
        } else {
          await BookingSlot.insertMany(slotDocs, { ordered: true });
        }
      } catch (slotErr) {
        // Best-effort rollback without transaction
        if (!session) {
          await Booking.deleteOne({ _id: booking._id });
          await BookingSlot.deleteMany({ BookingID: booking._id });
        }
        if (slotErr.code === 11000) {
          throw new ConflictError('Khung giờ này vừa có người khác đặt. Vui lòng chọn giờ khác!');
        }
        throw slotErr;
      }

      await logActivity(
        customerId,
        'CREATE_BOOKING',
        'Booking',
        booking._id,
        `Khách hàng tạo đơn đặt chỗ trị giá ${total.toLocaleString('vi-VN')}đ`,
        'info'
      );

      return booking;
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new ConflictError('Khung giờ này vừa có người khác đặt. Vui lòng chọn giờ khác!');
    }
    throw err;
  }
}

async function transitionBooking({ bookingId, hostId, customerId, toStatus, actorId, action }) {
  const filter = { _id: bookingId };
  if (hostId) filter.HostID = hostId;
  if (customerId) filter.CustomerID = customerId;

  const booking = await Booking.findOne(filter);
  if (!booking) throw new NotFoundError('Không tìm thấy đơn hàng.');

  assertTransition(booking.Status, toStatus);

  booking.Status = toStatus;
  await booking.save();

  if (toStatus === 'cancelled') {
    await BookingSlot.deleteMany({ BookingID: booking._id });
  }

  await logActivity(
    actorId || hostId || customerId,
    action || `BOOKING_${toStatus.toUpperCase()}`,
    'Booking',
    booking._id,
    `Chuyển booking sang ${toStatus}`,
    toStatus === 'cancelled' ? 'warning' : 'info'
  );

  return booking;
}

async function confirmBooking(hostId, bookingId) {
  return withOptionalTransaction(async (session) => {
    const opts = { returnDocument: 'after', runValidators: true };
    if (session) opts.session = session;

    const booking = await Booking.findOneAndUpdate(
      { _id: bookingId, HostID: hostId, Status: 'pending' },
      { $set: { Status: 'confirmed' } },
      opts
    );

    if (!booking) {
      let existsQ = Booking.findOne({ _id: bookingId });
      if (session) existsQ = existsQ.session(session);
      const exists = await existsQ;
      if (!exists) throw new NotFoundError('Không tìm thấy đơn hàng.');
      if (String(exists.HostID) !== String(hostId)) {
        throw new ForbiddenError('Bạn không có quyền xác nhận đơn này.');
      }
      throw new ValidationError('Đơn hàng không ở trạng thái chờ xác nhận.');
    }

    let pendingQ = PaymentHistory.find({
      BookingID: bookingId,
      HostID: hostId,
      Status: 'pending',
    });
    let successQ = PaymentHistory.find({
      BookingID: bookingId,
      Status: 'successful',
    });
    if (session) {
      pendingQ = pendingQ.session(session);
      successQ = successQ.session(session);
    }
    const pending = await pendingQ;
    const successful = await successQ;
    let paid = successful.reduce((s, p) => s + p.Amount, 0);

    for (const p of pending) {
      if (paid + p.Amount > booking.TotalAmount) continue;
      p.Status = 'successful';
      p.PaidAt = new Date();
      p.VerifiedAt = new Date();
      p.VerifiedBy = hostId;
      await p.save(session ? { session } : undefined);
      paid += p.Amount;
    }

    await logActivity(hostId, 'CONFIRM_BOOKING', 'Booking', booking._id, 'Chủ cơ sở xác nhận đơn', 'success');
    return booking;
  });
}

async function checkInBooking(hostId, bookingId) {
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, HostID: hostId, Status: 'confirmed' },
    { $set: { Status: 'in-use' } },
    { returnDocument: 'after', runValidators: true }
  );

  if (!booking) {
    const exists = await Booking.findOne({ _id: bookingId });
    if (!exists) throw new NotFoundError('Không tìm thấy đơn hàng.');
    if (String(exists.HostID) !== String(hostId)) {
      throw new ForbiddenError('Bạn không có quyền check-in đơn này.');
    }
    throw new ValidationError('Chỉ có thể nhận phòng với đơn đã được xác nhận.');
  }

  await logActivity(hostId, 'CHECKIN_BOOKING', 'Booking', booking._id, 'Chủ cơ sở check-in', 'info');
  return booking;
}

async function cancelBookingByHost(hostId, bookingId) {
  const booking = await Booking.findOne({ _id: bookingId, HostID: hostId });
  if (!booking) throw new NotFoundError('Không tìm thấy đơn hàng.');
  assertTransition(booking.Status, 'cancelled');

  booking.Status = 'cancelled';
  await booking.save();
  await BookingSlot.deleteMany({ BookingID: booking._id });

  // Do NOT auto-mark as refunded without real refund processing
  await PaymentHistory.updateMany(
    { BookingID: bookingId, HostID: hostId, Status: 'pending' },
    { $set: { Status: 'failed', FailureReason: 'Booking cancelled by host' } }
  );

  await logActivity(hostId, 'CANCEL_BOOKING', 'Booking', booking._id, 'Chủ cơ sở hủy đơn', 'danger');
  return booking;
}

async function cancelBookingByCustomer(customerId, bookingId) {
  const booking = await Booking.findOne({ _id: bookingId, CustomerID: customerId });
  if (!booking) throw new NotFoundError('Không tìm thấy đơn hàng của bạn.');
  if (booking.Status !== 'pending') {
    throw new ValidationError('Chỉ có thể hủy đơn đang chờ xác nhận.');
  }
  booking.Status = 'cancelled';
  await booking.save();
  await BookingSlot.deleteMany({ BookingID: booking._id });
  await PaymentHistory.updateMany(
    { BookingID: bookingId, CustomerID: customerId, Status: 'pending' },
    { $set: { Status: 'failed', FailureReason: 'Booking cancelled by customer' } }
  );
  await logActivity(customerId, 'CANCEL_BOOKING', 'Booking', booking._id, 'Khách hàng hủy đơn', 'warning');
  return booking;
}

/**
 * Complete only in-use bookings past EndTime.
 */
async function completeExpiredBookings({ hostId = null } = {}) {
  const filter = {
    Status: 'in-use',
    EndTime: { $lt: new Date() },
  };
  if (hostId) filter.HostID = hostId;

  const result = await Booking.updateMany(filter, { $set: { Status: 'completed' } });
  return result;
}

module.exports = {
  allowedTransitions,
  assertTransition,
  buildSlotStarts,
  createBooking,
  confirmBooking,
  checkInBooking,
  cancelBookingByHost,
  cancelBookingByCustomer,
  completeExpiredBookings,
  transitionBooking,
  ACTIVE_STATUSES,
};
