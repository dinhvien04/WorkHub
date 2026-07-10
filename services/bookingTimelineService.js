"use strict";

const Booking = require("../models/Booking");
const PaymentHistory = require("../models/Payment_History");
const Refund = require("../models/Refund");
const { NotFoundError, ForbiddenError } = require("../utils/errors");
const cancellationPolicyService = require("./cancellationPolicyService");

async function getBookingTimeline({ bookingId, userId, role }) {
  const booking = await Booking.findById(bookingId).lean();
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");

  const isCustomer = String(booking.CustomerID) === String(userId);
  const isHost = String(booking.HostID) === String(userId);
  if (!isCustomer && !isHost && role !== "admin") {
    throw new ForbiddenError("Không có quyền xem timeline.");
  }

  const [payments, refunds] = await Promise.all([
    PaymentHistory.find({ BookingID: bookingId }).sort({ createdAt: 1 }).lean(),
    Refund.find({ BookingID: bookingId })
      .sort({ createdAt: 1 })
      .lean()
      .catch(() => []),
  ]);

  const events = [];
  events.push({
    at: booking.createdAt,
    type: "created",
    label: "Tạo booking",
    meta: { status: booking.Status, total: booking.TotalAmount },
  });
  if (booking.HoldExpiresAt) {
    events.push({
      at: booking.createdAt,
      type: "hold",
      label: "Giữ chỗ tạm",
      meta: { expiresAt: booking.HoldExpiresAt },
    });
  }
  if (booking.InstantBook) {
    events.push({
      at: booking.createdAt,
      type: "instant",
      label: "Instant book — tự xác nhận",
    });
  }
  for (const p of payments) {
    events.push({
      at: p.createdAt || p.PaidAt,
      type: "payment",
      label: `Thanh toán ${p.Status}`,
      meta: { amount: p.Amount, code: p.TransactionCode },
    });
  }
  if (booking.CheckInAt) {
    events.push({ at: booking.CheckInAt, type: "checkin", label: "Check-in" });
  }
  if (booking.CheckOutAt) {
    events.push({
      at: booking.CheckOutAt,
      type: "checkout",
      label: "Check-out",
    });
  }
  if (booking.CancelledAt) {
    events.push({
      at: booking.CancelledAt,
      type: "cancelled",
      label: "Đã hủy",
      meta: { reason: booking.CancelReason },
    });
  }
  for (const r of refunds || []) {
    events.push({
      at: r.createdAt,
      type: "refund",
      label: `Hoàn tiền ${r.Status}`,
      meta: { amount: r.Amount },
    });
  }

  events.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));

  const successfulPaid = payments
    .filter((p) => p.Status === "successful")
    .reduce((s, p) => s + Number(p.Amount || 0), 0);

  const cancelPreview = cancellationPolicyService.evaluateCancellation(
    { ...booking, _successfulPaid: successfulPaid },
    { now: new Date() },
  );

  return {
    bookingId: booking._id,
    status: booking.Status,
    events,
    cancelPreview,
    paymentsCount: payments.length,
  };
}

module.exports = { getBookingTimeline };
