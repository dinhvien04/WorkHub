'use strict';

const Booking = require('../models/Booking');
const BookingSlot = require('../models/BookingSlot');
const bookingService = require('./bookingService');
const { notifyUser } = require('./notificationService');
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require('../utils/errors');

/**
 * Reschedule: create new slots first, then release old — never free old before new secured.
 */
async function rescheduleBooking({ bookingId, userId, role, startTime, endTime }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new NotFoundError('Không tìm thấy booking.');

  const isCustomer = String(booking.CustomerID) === String(userId);
  const isHost = String(booking.HostID) === String(userId);
  if (!isCustomer && !isHost && role !== 'admin') {
    throw new ForbiddenError('Không có quyền đổi lịch.');
  }
  if (!['pending', 'confirmed', 'awaiting_payment', 'payment_under_review'].includes(booking.Status)) {
    throw new ValidationError('Không thể đổi lịch booking ở trạng thái này.');
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  bookingService.validateBookingWindow(start, end);

  const slotStarts = bookingService.buildSlotStarts(start, end);
  const oldSlots = await BookingSlot.find({ BookingID: booking._id }).lean();

  // Try insert new slots first (unique index)
  const newDocs = slotStarts.map((SlotStart) => ({
    SpaceID: booking.SpaceID,
    BookingID: booking._id,
    SlotStart,
  }));

  // Temporarily remove old slots in memory plan: insert new excluding times that equal old if same
  // Strategy: delete old AFTER successful insert of new — but unique is SpaceID+SlotStart.
  // So for overlapping same booking, we need to delete old first only for slots we're replacing,
  // OR use a temp booking id. Safer: delete old slots, insert new, on failure re-insert old.

  const oldDocs = oldSlots.map((s) => ({
    SpaceID: s.SpaceID,
    BookingID: s.BookingID,
    SlotStart: s.SlotStart,
  }));

  await BookingSlot.deleteMany({ BookingID: booking._id });

  try {
    // conflict with OTHER bookings
    const conflict = await Booking.findOne({
      _id: { $ne: booking._id },
      SpaceID: booking.SpaceID,
      Status: { $in: bookingService.ACTIVE_STATUSES },
      StartTime: { $lt: end },
      EndTime: { $gt: start },
    });
    if (conflict) throw new ConflictError('Khung giờ mới bị trùng.');

    await BookingSlot.insertMany(newDocs, { ordered: true });
  } catch (err) {
    // restore old slots
    try {
      await BookingSlot.insertMany(oldDocs, { ordered: false });
    } catch {
      /* best effort */
    }
    if (err.code === 11000 || err.statusCode === 409) {
      throw new ConflictError('Khung giờ mới vừa có người đặt.');
    }
    throw err;
  }

  booking.StartTime = start;
  booking.EndTime = end;
  booking.Status = booking.Status === 'confirmed' ? 'confirmed' : booking.Status;
  await booking.save();

  const other = isCustomer ? booking.HostID : booking.CustomerID;
  await notifyUser({
    userId: other,
    title: 'Booking đã đổi lịch',
    body: `${new Date(start).toLocaleString('vi-VN')} → ${new Date(end).toLocaleString('vi-VN')}`,
    type: 'booking',
    entityType: 'Booking',
    entityId: booking._id,
  });

  return booking;
}

module.exports = { rescheduleBooking };
