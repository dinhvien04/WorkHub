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
 * Floor-start slot builder: every overlapping range shares at least one slot.
 * Cursor = floor(start / step); while cursor < end push cursor.
 */
function buildSlotStarts(start, end, slotMinutes = env.BOOKING_SLOT_MINUTES) {
  const step = slotMinutes * 60 * 1000;
  const slots = [];
  let cursor = new Date(Math.floor(start.getTime() / step) * step);
  while (cursor < end) {
    slots.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + step);
  }
  if (slots.length === 0) {
    slots.push(new Date(Math.floor(start.getTime() / step) * step));
  }
  return slots;
}

/**
 * Run work once. Never re-invoke on transaction failure.
 * ENABLE_TRANSACTIONS=false => non-transaction path only.
 */
async function withOptionalTransaction(work) {
  if (!env.ENABLE_TRANSACTIONS) {
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
    throw err;
  } finally {
    session.endSession();
  }
}

function validateBookingWindow(start, end) {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ValidationError('Ngày/giờ không hợp lệ.');
  }
  if (end <= start) throw new ValidationError('EndTime phải lớn hơn StartTime.');
  if (start.getTime() < Date.now() - 60_000) {
    throw new ValidationError('Không thể đặt phòng ở thời điểm trong quá khứ.');
  }

  const durationMs = end - start;
  const maxDurationMs = env.MAX_BOOKING_HOURS * 60 * 60 * 1000;
  if (durationMs <= 0 || durationMs > maxDurationMs) {
    throw new ValidationError(
      `Thời lượng đặt chỗ không hợp lệ (tối đa ${env.MAX_BOOKING_HOURS} giờ).`
    );
  }

  const maxAheadMs = env.MAX_BOOKING_DAYS_AHEAD * 24 * 60 * 60 * 1000;
  if (start.getTime() - Date.now() > maxAheadMs) {
    throw new ValidationError(
      `Chỉ được đặt trước tối đa ${env.MAX_BOOKING_DAYS_AHEAD} ngày.`
    );
  }
}

async function createBooking({ customerId, spaceId, startTime, endTime, note = '' }) {
  if (!spaceId || !startTime || !endTime) {
    throw new ValidationError('Thiếu thông tin đặt chỗ (spaceId, startTime, endTime).');
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  validateBookingWindow(start, end);

  const space = await Space.findById(spaceId);
  if (!space) throw new NotFoundError('Không tìm thấy phòng.');
  if (space.Status !== 'available') {
    throw new ValidationError('Không gian hiện không khả dụng để đặt.');
  }

  const slotStarts = buildSlotStarts(start, end);
  const maxSlots = Math.ceil((env.MAX_BOOKING_HOURS * 60) / env.BOOKING_SLOT_MINUTES);
  if (slotStarts.length > maxSlots) {
    throw new ValidationError('Số lượng slot vượt giới hạn.');
  }

  const hours = (end - start) / (1000 * 60 * 60);
  const total = Math.round(hours * (space.PricePerHour || 0));
  const deposit =
    space.DepositAmount > 0 ? space.DepositAmount : Math.round(total * 0.3);

  return withOptionalTransaction(async (session) => {
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

    // Do not auto-mark all payments; host verifies payments explicitly
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

async function completeExpiredBookings({ hostId = null } = {}) {
  const filter = {
    Status: 'in-use',
    EndTime: { $lt: new Date() },
  };
  if (hostId) filter.HostID = hostId;
  return Booking.updateMany(filter, { $set: { Status: 'completed' } });
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
  ACTIVE_STATUSES,
  validateBookingWindow,
};
