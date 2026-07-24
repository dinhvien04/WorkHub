"use strict";

/**
 * Canonical net-paid calculation for all finance paths.
 * Includes successful + partially_refunded; subtracts RefundedAmount.
 */
const PaymentHistory = require("../models/Payment_History");
const Booking = require("../models/Booking");
const { NotFoundError } = require("./errors");

const NET_PAID_STATUSES = ["successful", "partially_refunded"];

/** Statuses that count as ordinary revenue in reports (excludes reconciliation). */
const REVENUE_STATUSES = ["successful", "partially_refunded"];

/** Non-revenue statuses that must never advance paid progress. */
const NON_REVENUE_STATUSES = new Set([
  "reconciliation_required",
  "overpayment_pending_refund",
  "provider_refund_pending",
  "failed",
  "pending",
  "refund_pending",
]);

function netOfRow(p) {
  if (!p) return 0;
  if (NON_REVENUE_STATUSES.has(p.Status)) return 0;
  if (!REVENUE_STATUSES.includes(p.Status)) return 0;
  return Math.max(0, Number(p.Amount || 0) - Number(p.RefundedAmount || 0));
}

async function getNetPaidForBooking(bookingId, { session = null } = {}) {
  const q = PaymentHistory.find({
    BookingID: bookingId,
    Status: { $in: NET_PAID_STATUSES },
  }).select("Amount RefundedAmount Status");
  if (session) q.session(session);
  const rows = await q.lean();
  return rows.reduce((sum, p) => sum + netOfRow(p), 0);
}

async function getRemainingForBooking(bookingId, { session = null } = {}) {
  const bq = Booking.findById(bookingId).select("TotalAmount");
  if (session) bq.session(session);
  const booking = await bq.lean();
  if (!booking) throw new NotFoundError("Không tìm thấy đơn hàng.");
  const paid = await getNetPaidForBooking(bookingId, { session });
  return {
    totalAmount: Math.round(Number(booking.TotalAmount) || 0),
    paidAmount: paid,
    remainingAmount: Math.max(
      0,
      Math.round(Number(booking.TotalAmount) || 0) - paid,
    ),
  };
}

module.exports = {
  NET_PAID_STATUSES,
  REVENUE_STATUSES,
  NON_REVENUE_STATUSES,
  netOfRow,
  getNetPaidForBooking,
  getRemainingForBooking,
};
