"use strict";

const Booking = require("../models/Booking");
const BookingSlot = require("../models/BookingSlot");
const bookingService = require("./bookingService");
const { notifyUser } = require("./notificationService");
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require("../utils/errors");

const RESCHEDULABLE = [
  "hold",
  "pending",
  "awaiting_payment",
  "payment_under_review",
  "confirmed",
];

async function loadAuthorizedBooking({ bookingId, userId, role }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");
  const isCustomer = String(booking.CustomerID) === String(userId);
  const isHost = String(booking.HostID) === String(userId);
  if (!isCustomer && !isHost && role !== "admin") {
    throw new ForbiddenError("Không có quyền đổi lịch.");
  }
  return { booking, isCustomer, isHost };
}

/**
 * Dry-run: conflict + estimated quote for new window (does not mutate slots).
 */
async function previewReschedule({
  bookingId,
  userId,
  role,
  startTime,
  endTime,
}) {
  const { booking } = await loadAuthorizedBooking({ bookingId, userId, role });
  if (!RESCHEDULABLE.includes(booking.Status)) {
    throw new ValidationError("Không thể đổi lịch booking ở trạng thái này.");
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  bookingService.validateBookingWindow(start, end);

  const conflict = await Booking.findOne({
    _id: { $ne: booking._id },
    SpaceID: booking.SpaceID,
    Status: { $in: bookingService.ACTIVE_STATUSES },
    StartTime: { $lt: end },
    EndTime: { $gt: start },
  })
    .select("_id Status StartTime EndTime")
    .lean();

  // Slot-level uniqueness excluding this booking's current slots
  const slotStarts = bookingService.buildSlotStarts(start, end);
  const taken = await BookingSlot.find({
    SpaceID: booking.SpaceID,
    BookingID: { $ne: booking._id },
    SlotStart: { $in: slotStarts },
  })
    .select("SlotStart")
    .lean();

  const available = !conflict && taken.length === 0;

  let quote = null;
  try {
    const bookingQuoteService = require("./bookingQuoteService");
    const addOns = (booking.AddOns || []).map((a) => ({
      addOnId: a.AddOnID || a.addOnId,
      quantity: a.Quantity || a.quantity || 1,
    }));
    quote = await bookingQuoteService.quoteBooking({
      spaceId: booking.SpaceID,
      startTime: start,
      endTime: end,
      addOns,
      couponCode: booking.CouponCode || null,
      userId: booking.CustomerID,
    });
    if (quote && quote.ok === false) quote = null;
  } catch {
    quote = null;
  }

  return {
    bookingId: String(booking._id),
    current: {
      startTime: booking.StartTime,
      endTime: booking.EndTime,
      status: booking.Status,
      totalAmount: booking.TotalAmount,
      depositAmount: booking.DepositAmount,
    },
    proposed: {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    },
    available,
    conflict: conflict
      ? { bookingId: String(conflict._id), status: conflict.Status }
      : null,
    slotConflicts: taken.length,
    quote: quote
      ? {
          totalAmount: quote.totalAmount,
          depositAmount: quote.depositAmount,
          baseAmount: quote.baseAmount,
          hours: quote.hours,
          priceDelta: quote.totalAmount - (booking.TotalAmount || 0),
          lines: quote.lines,
        }
      : null,
    canApply: available,
    note: available
      ? "Khung giờ trống — có thể đổi lịch. Giá có thể thay đổi theo thời lượng/rules."
      : "Khung giờ không khả dụng.",
  };
}

/**
 * Reschedule: release old slots only after new secured (restore on failure).
 * Recalculates price when unpaid (no successful payment yet).
 */
async function rescheduleBooking({
  bookingId,
  userId,
  role,
  startTime,
  endTime,
}) {
  const { booking, isCustomer } = await loadAuthorizedBooking({
    bookingId,
    userId,
    role,
  });
  if (!RESCHEDULABLE.includes(booking.Status)) {
    throw new ValidationError("Không thể đổi lịch booking ở trạng thái này.");
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  bookingService.validateBookingWindow(start, end);

  const slotStarts = bookingService.buildSlotStarts(start, end);
  const oldSlots = await BookingSlot.find({ BookingID: booking._id }).lean();
  const newDocs = slotStarts.map((SlotStart) => ({
    SpaceID: booking.SpaceID,
    BookingID: booking._id,
    SlotStart,
  }));
  const oldDocs = oldSlots.map((s) => ({
    SpaceID: s.SpaceID,
    BookingID: s.BookingID,
    SlotStart: s.SlotStart,
  }));

  await BookingSlot.deleteMany({ BookingID: booking._id });

  try {
    const conflict = await Booking.findOne({
      _id: { $ne: booking._id },
      SpaceID: booking.SpaceID,
      Status: { $in: bookingService.ACTIVE_STATUSES },
      StartTime: { $lt: end },
      EndTime: { $gt: start },
    });
    if (conflict) throw new ConflictError("Khung giờ mới bị trùng.");

    await BookingSlot.insertMany(newDocs, { ordered: true });
  } catch (err) {
    try {
      await BookingSlot.insertMany(oldDocs, { ordered: false });
    } catch {
      /* best effort */
    }
    if (err.code === 11000 || err.statusCode === 409) {
      throw new ConflictError("Khung giờ mới vừa có người đặt.");
    }
    throw err;
  }

  const previousStart = booking.StartTime;
  const previousEnd = booking.EndTime;
  booking.StartTime = start;
  booking.EndTime = end;
  if (booking.Status === "hold" || booking.Status === "pending") {
    // refresh hold window on reschedule of unpaid hold
    booking.HoldExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
  }

  // Re-price only when nothing paid successfully
  try {
    const PaymentHistory = require("../models/Payment_History");
    const paid = await PaymentHistory.countDocuments({
      BookingID: booking._id,
      Status: "successful",
    });
    if (paid === 0) {
      const bookingQuoteService = require("./bookingQuoteService");
      const addOns = (booking.AddOns || []).map((a) => ({
        addOnId: a.AddOnID,
        quantity: a.Quantity || 1,
      }));
      const quote = await bookingQuoteService.quoteBooking({
        spaceId: booking.SpaceID,
        startTime: start,
        endTime: end,
        addOns,
        couponCode: booking.CouponCode || null,
        userId: booking.CustomerID,
      });
      if (quote && quote.ok !== false) {
        booking.BaseAmount = quote.baseAmount;
        booking.AddOnsTotal = quote.addOnsTotal;
        booking.DiscountAmount = quote.discountAmount;
        booking.TotalAmount = quote.totalAmount;
        booking.DepositAmount = quote.depositAmount;
        booking.AppliedPricingRules = quote.appliedRules || [];
      }
    }
  } catch {
    /* keep previous amounts */
  }

  await booking.save();

  const other = isCustomer ? booking.HostID : booking.CustomerID;
  await notifyUser({
    userId: other,
    title: "Booking đã đổi lịch",
    body: `${new Date(start).toLocaleString("vi-VN")} → ${new Date(end).toLocaleString("vi-VN")}`,
    type: "booking",
    entityType: "Booking",
    entityId: booking._id,
  });

  return {
    booking,
    previous: { startTime: previousStart, endTime: previousEnd },
  };
}

module.exports = {
  rescheduleBooking,
  previewReschedule,
  RESCHEDULABLE,
};
