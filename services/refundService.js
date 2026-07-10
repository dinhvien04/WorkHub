"use strict";

const Refund = require("../models/Refund");
const RefundAllocation = require("../models/RefundAllocation");
const PaymentHistory = require("../models/Payment_History");
const Booking = require("../models/Booking");
const ledgerService = require("./ledgerService");
const { notifyUser } = require("./notificationService");
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require("../utils/errors");

async function getSuccessfulPaid(bookingId) {
  const rows = await PaymentHistory.find({
    BookingID: bookingId,
    Status: { $in: ["successful", "partially_refunded"] },
  }).lean();
  return rows.reduce(
    (s, p) => s + Math.max(0, (p.Amount || 0) - (p.RefundedAmount || 0)),
    0,
  );
}

async function getRefundedTotal(bookingId) {
  const rows = await Refund.find({
    BookingID: bookingId,
    Status: { $in: ["approved", "processing", "completed"] },
  });
  return rows.reduce((s, r) => s + r.Amount, 0);
}

async function requestRefund({
  bookingId,
  userId,
  role,
  amount,
  reason,
  idempotencyKey,
}) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");
  const isCustomer = String(booking.CustomerID) === String(userId);
  const isHost = String(booking.HostID) === String(userId);
  if (!isCustomer && !isHost && role !== "admin") {
    throw new ForbiddenError("Không có quyền yêu cầu hoàn tiền.");
  }

  const paid = await getSuccessfulPaid(bookingId);
  const already = await getRefundedTotal(bookingId);
  const maxRefund = paid; // net already accounts for partials on payments; requested not completed
  // Count only completed for max; pending requests shouldn't double-count paid net incorrectly
  const completedSum = (
    await Refund.find({ BookingID: bookingId, Status: "completed" })
  ).reduce((s, r) => s + r.Amount, 0);
  const pendingSum = (
    await Refund.find({
      BookingID: bookingId,
      Status: { $in: ["requested", "approved", "processing"] },
    })
  ).reduce((s, r) => s + r.Amount, 0);

  const amt = Math.round(Number(amount));
  const netAvailable = paid; // successful - already allocated refunds on payments
  if (!amt || amt <= 0 || amt > netAvailable - pendingSum) {
    throw new ValidationError(
      `Số tiền hoàn không hợp lệ (tối đa ${Math.max(0, netAvailable - pendingSum)}).`,
    );
  }

  if (idempotencyKey) {
    const existing = await Refund.findOne({ IdempotencyKey: idempotencyKey });
    if (existing) return existing;
  }

  try {
    const refund = await Refund.create({
      BookingID: bookingId,
      CustomerID: booking.CustomerID,
      HostID: booking.HostID,
      Amount: amt,
      Reason: String(reason || "").slice(0, 1000),
      Status: "requested",
      RequestedBy: userId,
      IdempotencyKey: idempotencyKey || undefined,
    });
    await notifyUser({
      userId: booking.HostID,
      title: "Yêu cầu hoàn tiền",
      body: `${amt.toLocaleString("vi-VN")}đ`,
      type: "payment",
      entityType: "Refund",
      entityId: refund._id,
      link: "/host/payments",
    });
    return refund;
  } catch (err) {
    if (err.code === 11000) {
      const existing = await Refund.findOne({ IdempotencyKey: idempotencyKey });
      if (existing) return existing;
      throw new ConflictError("Refund trùng lặp.");
    }
    throw err;
  }
}

/**
 * Allocate refund across payments oldest-first; update RefundedAmount;
 * never mark fully refunded unless net is zero.
 */
async function allocateRefundToPayments(refund) {
  const payments = await PaymentHistory.find({
    BookingID: refund.BookingID,
    Status: { $in: ["successful", "partially_refunded"] },
  }).sort({ PaidAt: 1, createdAt: 1 });

  let remaining = refund.Amount;
  const allocations = [];

  for (const p of payments) {
    if (remaining <= 0) break;
    const already = Number(p.RefundedAmount || 0);
    const net = Math.max(0, p.Amount - already);
    if (net <= 0) continue;
    const take = Math.min(net, remaining);

    // Atomic increment refunded amount without exceeding payment amount
    const updated = await PaymentHistory.findOneAndUpdate(
      {
        _id: p._id,
        $expr: {
          $lte: [
            { $add: [{ $ifNull: ["$RefundedAmount", 0] }, take] },
            "$Amount",
          ],
        },
      },
      {
        $inc: { RefundedAmount: take },
        $set: { RefundedAt: new Date() },
      },
      { new: true },
    );
    if (!updated) continue;

    const newRefunded = Number(updated.RefundedAmount || 0);
    if (newRefunded >= updated.Amount) {
      updated.Status = "refunded";
    } else if (newRefunded > 0) {
      updated.Status = "partially_refunded";
    }
    await updated.save();

    await RefundAllocation.create({
      RefundID: refund._id,
      PaymentID: updated._id,
      Amount: take,
    });
    allocations.push({ paymentId: updated._id, amount: take });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new ValidationError("Không đủ số dư payment để phân bổ hoàn tiền.");
  }
  return allocations;
}

async function processRefund({ refundId, actorId, approve, role }) {
  const refund = await Refund.findById(refundId);
  if (!refund) throw new NotFoundError("Không tìm thấy refund.");
  if (role !== "admin" && String(refund.HostID) !== String(actorId)) {
    throw new ForbiddenError("Không có quyền xử lý refund.");
  }
  if (refund.Status !== "requested" && refund.Status !== "approved") {
    throw new ValidationError("Refund không ở trạng thái xử lý được.");
  }

  if (!approve) {
    refund.Status = "rejected";
    refund.ProcessedBy = actorId;
    refund.ProcessedAt = new Date();
    await refund.save();
    return refund;
  }

  // CAS to processing
  const claimed = await Refund.findOneAndUpdate(
    { _id: refundId, Status: { $in: ["requested", "approved"] } },
    { $set: { Status: "processing", ProcessedBy: actorId } },
    { new: true },
  );
  if (!claimed) throw new ConflictError("Refund đang được xử lý hoặc đã xong.");

  const paid = await getSuccessfulPaid(claimed.BookingID);
  // paid is net after previous refunds; this refund not yet allocated
  if (claimed.Amount > paid) {
    claimed.Status = "failed";
    claimed.FailureReason = "Exceeds net paid";
    await claimed.save();
    throw new ValidationError("Hoàn sẽ vượt số đã thanh toán thành công.");
  }

  try {
    await allocateRefundToPayments(claimed);

    await ledgerService.postEntry({
      hostId: claimed.HostID,
      customerId: claimed.CustomerID,
      bookingId: claimed.BookingID,
      type: "refund",
      amount: claimed.Amount,
      direction: "debit",
      description: `Refund ${claimed._id}`,
      idempotencyKey: `refund-ledger-${claimed._id}`,
    });

    claimed.Status = "completed";
    claimed.ProcessedAt = new Date();
    await claimed.save();

    await notifyUser({
      userId: claimed.CustomerID,
      title: "Hoàn tiền đã xử lý",
      body: `${claimed.Amount.toLocaleString("vi-VN")}đ`,
      type: "payment",
      entityType: "Refund",
      entityId: claimed._id,
    });

    return claimed;
  } catch (err) {
    claimed.Status = "failed";
    claimed.FailureReason = String(err.message || "error").slice(0, 300);
    await claimed.save();
    throw err;
  }
}

module.exports = {
  requestRefund,
  processRefund,
  getSuccessfulPaid,
  getRefundedTotal,
  allocateRefundToPayments,
};
