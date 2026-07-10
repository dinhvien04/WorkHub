"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const PaymentHistory = require("../models/Payment_History");
const Booking = require("../models/Booking");
const logActivity = require("../utils/auditLogger");
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} = require("../utils/errors");

function validateIdempotencyKey(key) {
  if (!key || typeof key !== "string") {
    throw new ValidationError("Thiếu Idempotency-Key.");
  }
  const k = key.trim();
  if (k.length < 16 || k.length > 128) {
    throw new ValidationError("Idempotency-Key không hợp lệ.");
  }
  return k;
}

async function getSuccessfulPaidAmount(bookingId, session = null) {
  const q = PaymentHistory.find({
    BookingID: bookingId,
    Status: "successful",
  }).select("Amount");
  if (session) q.session(session);
  const rows = await q.lean();
  return rows.reduce((sum, p) => sum + (p.Amount || 0), 0);
}

async function getRemainingAmount(bookingId) {
  const booking = await Booking.findById(bookingId)
    .select("TotalAmount")
    .lean();
  if (!booking) throw new NotFoundError("Không tìm thấy đơn hàng.");
  const paid = await getSuccessfulPaidAmount(bookingId);
  return Math.max(0, booking.TotalAmount - paid);
}

async function getPaymentProgress(bookingId) {
  const booking = await Booking.findById(bookingId)
    .select("TotalAmount DepositAmount")
    .lean();
  if (!booking) throw new NotFoundError("Không tìm thấy đơn hàng.");
  const paid = await getSuccessfulPaidAmount(bookingId);
  const total = booking.TotalAmount || 0;
  const percent =
    total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  return {
    totalAmount: total,
    depositAmount: booking.DepositAmount || 0,
    paidAmount: paid,
    remainingAmount: Math.max(0, total - paid),
    percentPaid: percent,
  };
}

async function createPendingPayment({
  customerId,
  bookingId,
  paymentType,
  paymentMethod = "bank_transfer",
  idempotencyKey,
}) {
  const key = validateIdempotencyKey(idempotencyKey);

  const booking = await Booking.findOne({
    _id: bookingId,
    CustomerID: customerId,
  });
  if (!booking) throw new NotFoundError("Không tìm thấy đơn hàng của bạn.");

  if (!["pending", "confirmed", "in-use"].includes(booking.Status)) {
    throw new ValidationError("Đơn hàng không ở trạng thái có thể thanh toán.");
  }

  const existing = await PaymentHistory.findOne({
    BookingID: bookingId,
    CustomerID: customerId,
    IdempotencyKey: key,
  });
  if (existing) return { payment: existing, duplicate: true };

  const typeStr = String(paymentType || "deposit")
    .toLowerCase()
    .trim();
  let actualPaymentType = "deposit";
  let amountToPay = booking.DepositAmount;

  if (typeStr === "full" || typeStr === "full_payment" || typeStr === "100") {
    actualPaymentType = "full_payment";
    amountToPay = booking.TotalAmount;
  } else if (typeStr === "remaining" || typeStr === "remaining_balance") {
    actualPaymentType = "remaining_balance";
    amountToPay = await getRemainingAmount(bookingId);
  }

  if (!amountToPay || amountToPay <= 0) {
    throw new ValidationError("Số tiền thanh toán không hợp lệ.");
  }

  const paid = await getSuccessfulPaidAmount(bookingId);
  if (paid + amountToPay > booking.TotalAmount) {
    throw new ValidationError(
      "Không thể thanh toán vượt tổng giá trị đơn hàng.",
    );
  }

  const pendingSameType = await PaymentHistory.findOne({
    BookingID: bookingId,
    CustomerID: customerId,
    PaymentType: actualPaymentType,
    Status: "pending",
  });
  if (pendingSameType) return { payment: pendingSameType, duplicate: true };

  const txn = `TXN-${booking._id}-${crypto.randomBytes(4).toString("hex")}-${Date.now()}`;

  try {
    const payment = await PaymentHistory.create({
      BookingID: booking._id,
      CustomerID: customerId,
      HostID: booking.HostID,
      TransactionCode: txn,
      Amount: amountToPay,
      PaymentType: actualPaymentType,
      PaymentMethod: paymentMethod,
      Status: "pending",
      IdempotencyKey: key,
    });

    await logActivity(
      customerId,
      "PAYMENT_PENDING",
      "PaymentHistory",
      payment._id,
      `Khách báo cáo thanh toán ${amountToPay.toLocaleString("vi-VN")}đ`,
      "info",
    );

    try {
      const User = require("../models/User");
      const emailService = require("./emailService");
      const { notifyUser } = require("./notificationService");
      const [customer, host] = await Promise.all([
        User.findById(customerId).select("Email FullName NotifyEmail").lean(),
        User.findById(booking.HostID)
          .select("Email FullName NotifyEmail")
          .lean(),
      ]);
      await notifyUser({
        userId: booking.HostID,
        title: "Thanh toán chờ xác minh",
        body: `${amountToPay.toLocaleString("vi-VN")}đ · ${booking.Snapshot?.SpaceName || ""}`,
        type: "payment",
        entityType: "Booking",
        entityId: booking._id,
        link: "/host/payments",
      });
      if (customer?.Email && customer.NotifyEmail !== false) {
        emailService.safeSendTemplate("payment_received", {
          to: customer.Email,
          toName: customer.FullName,
          amount: amountToPay,
          bookingId: booking._id,
        });
      }
      if (host?.Email && host.NotifyEmail !== false) {
        emailService.safeSendTemplate("generic", {
          to: host.Email,
          subject: "WorkHub: thanh toán chờ xác minh",
          title: "Khách đã báo cáo thanh toán",
          body: `Khoản ${amountToPay.toLocaleString("vi-VN")}đ cần bạn xác minh trên trang Payments.`,
          ctaLabel: "Mở payments",
          ctaUrl: `${emailService.publicBaseUrl()}/host/payments`,
        });
      }
    } catch {
      /* ignore */
    }

    return { payment, duplicate: false };
  } catch (err) {
    if (err.code === 11000) {
      const again = await PaymentHistory.findOne({
        BookingID: bookingId,
        CustomerID: customerId,
        IdempotencyKey: key,
      });
      if (again) return { payment: again, duplicate: true };
      const stagePending = await PaymentHistory.findOne({
        BookingID: bookingId,
        CustomerID: customerId,
        PaymentType: actualPaymentType,
        Status: "pending",
      });
      if (stagePending) return { payment: stagePending, duplicate: true };
      throw new ConflictError("Giao dịch trùng lặp.");
    }
    throw err;
  }
}

/**
 * Atomic verify with invariant: successfulPaid <= TotalAmount always.
 * Uses compare-and-set on pending + post-check rollback if race exceeds total.
 */
async function verifyPayment(hostId, paymentId) {
  const payment = await PaymentHistory.findOne({
    _id: paymentId,
    HostID: hostId,
  });
  if (!payment) throw new NotFoundError("Không tìm thấy giao dịch.");
  if (payment.Status !== "pending") {
    throw new ValidationError("Chỉ có thể xác minh giao dịch đang pending.");
  }

  const booking = await Booking.findOne({
    _id: payment.BookingID,
    HostID: hostId,
  });
  if (!booking) throw new NotFoundError("Không tìm thấy đơn hàng.");

  const paidBefore = await getSuccessfulPaidAmount(payment.BookingID);
  if (paidBefore + payment.Amount > booking.TotalAmount) {
    throw new ValidationError("Xác minh sẽ làm vượt tổng đơn hàng.");
  }

  const now = new Date();
  const updated = await PaymentHistory.findOneAndUpdate(
    {
      _id: paymentId,
      HostID: hostId,
      Status: "pending",
    },
    {
      $set: {
        Status: "successful",
        PaidAt: now,
        VerifiedAt: now,
        VerifiedBy: hostId,
      },
    },
    { returnDocument: "after" },
  );

  if (!updated) {
    throw new ConflictError("Giao dịch đã được xử lý bởi request khác.");
  }

  // Reconcile: keep earliest successful payments until TotalAmount; demote the rest.
  // Handles concurrent verify races without dropping ALL payments.
  await reconcileSuccessfulCap(payment.BookingID, booking.TotalAmount);

  const stillOk = await PaymentHistory.findById(paymentId);
  if (!stillOk || stillOk.Status !== "successful") {
    throw new ConflictError(
      "Không thể xác minh: vượt tổng đơn hàng do race condition.",
    );
  }

  await logActivity(
    hostId,
    "VERIFY_PAYMENT",
    "PaymentHistory",
    updated._id,
    "Host xác minh thanh toán",
    "success",
  );
  try {
    require("../utils/metrics").incPaymentsVerified();
  } catch {
    /* ignore */
  }

  // Notify customer: payment verified
  try {
    const User = require("../models/User");
    const emailService = require("./emailService");
    const { notifyUser } = require("./notificationService");
    const customer = await User.findById(stillOk.CustomerID)
      .select("Email FullName NotifyEmail")
      .lean();
    await notifyUser({
      userId: stillOk.CustomerID,
      title: "Thanh toán đã xác minh",
      body: `${Number(stillOk.Amount || 0).toLocaleString("vi-VN")}đ đã được host xác nhận.`,
      type: "payment",
      entityType: "Booking",
      entityId: stillOk.BookingID,
      link: `/booking/detail?id=${stillOk.BookingID}`,
    });
    if (customer?.Email && customer.NotifyEmail !== false) {
      emailService.safeSendTemplate("generic", {
        to: customer.Email,
        subject: "WorkHub: thanh toán đã được host xác minh",
        title: "Thanh toán thành công",
        body: `Khoản ${Number(stillOk.Amount || 0).toLocaleString("vi-VN")}đ cho booking đã được host xác minh.`,
        ctaLabel: "Xem booking",
        ctaUrl: `${emailService.publicBaseUrl()}/booking/detail?id=${stillOk.BookingID}`,
      });
    }
  } catch {
    /* ignore */
  }

  return stillOk;
}

/**
 * Canonical manual payment verify + single ledger credit (P0.7).
 * All UI routes must call this — never separate verify vs verify-ledger paths.
 */
async function verifyManualPaymentAndPostLedger({
  hostOwnerId,
  actorUserId,
  paymentId,
  idempotencyKey,
}) {
  const payment = await verifyPayment(hostOwnerId, paymentId);
  const ledgerService = require("./ledgerService");
  const entry = await ledgerService.postEntry({
    hostId: hostOwnerId,
    customerId: payment.CustomerID,
    bookingId: payment.BookingID,
    paymentId: payment._id,
    type: "payment",
    amount: payment.Amount,
    direction: "credit",
    description: `Payment ${payment.TransactionCode}`,
    idempotencyKey: idempotencyKey || `ledger-pay-${payment._id}`,
    meta: { actorUserId: String(actorUserId || hostOwnerId) },
  });
  return { payment, ledgerEntry: entry };
}

/**
 * Ensure sum(successful) <= total by demoting later payments to failed.
 */
async function reconcileSuccessfulCap(bookingId, totalAmount) {
  const successful = await PaymentHistory.find({
    BookingID: bookingId,
    Status: "successful",
  }).sort({ VerifiedAt: 1, createdAt: 1 });

  let sum = 0;
  for (const p of successful) {
    if (sum + (p.Amount || 0) <= totalAmount) {
      sum += p.Amount || 0;
    } else {
      p.Status = "failed";
      p.FailureReason =
        "Overpayment race — demoted to preserve successfulPaid <= TotalAmount";
      p.PaidAt = null;
      await p.save();
    }
  }
}

async function rejectPayment(hostId, paymentId, reason = "") {
  const safeReason = String(reason || "Rejected by host").slice(0, 500);
  const now = new Date();
  const updated = await PaymentHistory.findOneAndUpdate(
    { _id: paymentId, HostID: hostId, Status: "pending" },
    {
      $set: {
        Status: "failed",
        FailureReason: safeReason,
        VerifiedAt: now,
        VerifiedBy: hostId,
      },
    },
    { returnDocument: "after" },
  );

  if (!updated) {
    const exists = await PaymentHistory.findOne({ _id: paymentId });
    if (!exists) throw new NotFoundError("Không tìm thấy giao dịch.");
    if (String(exists.HostID) !== String(hostId)) {
      throw new ForbiddenError("Bạn không có quyền từ chối giao dịch này.");
    }
    throw new ValidationError("Chỉ có thể từ chối giao dịch đang pending.");
  }

  await logActivity(
    hostId,
    "REJECT_PAYMENT",
    "PaymentHistory",
    updated._id,
    "Host từ chối thanh toán",
    "warning",
  );
  return updated;
}

async function listHostPayments(hostId, { page = 1, limit = 20, status } = {}) {
  const filter = { HostID: hostId };
  if (status) filter.Status = status;
  const skip = (page - 1) * limit;
  const [payments, total] = await Promise.all([
    PaymentHistory.find(filter)
      .select("-__v")
      .populate("CustomerID", "FullName Email")
      .populate(
        "BookingID",
        "Status TotalAmount DepositAmount StartTime EndTime",
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PaymentHistory.countDocuments(filter),
  ]);
  return { payments, total, page, limit };
}

async function getHostRevenueMetrics(
  hostId,
  { spaceIds = null, from = null, to = null } = {},
) {
  const match = {
    HostID:
      hostId instanceof mongoose.Types.ObjectId
        ? hostId
        : new mongoose.Types.ObjectId(String(hostId)),
  };
  if (from || to) {
    match.PaidAt = {};
    if (from) match.PaidAt.$gte = from;
    if (to) match.PaidAt.$lte = to;
  }

  let payments = await PaymentHistory.find(match).lean();
  if (spaceIds) {
    const bookings = await Booking.find({
      HostID: hostId,
      SpaceID: { $in: spaceIds },
    })
      .select("_id")
      .lean();
    const set = new Set(bookings.map((b) => String(b._id)));
    payments = payments.filter((p) => set.has(String(p.BookingID)));
  }

  let actualRevenue = 0;
  let pendingAmount = 0;
  let refundedAmount = 0;
  for (const p of payments) {
    if (p.Status === "successful") actualRevenue += p.Amount || 0;
    if (p.Status === "pending") pendingAmount += p.Amount || 0;
    if (p.Status === "refunded") refundedAmount += p.Amount || 0;
  }

  return { actualRevenue, pendingAmount, refundedAmount };
}

module.exports = {
  getSuccessfulPaidAmount,
  getRemainingAmount,
  getPaymentProgress,
  createPendingPayment,
  verifyPayment,
  verifyManualPaymentAndPostLedger,
  rejectPayment,
  listHostPayments,
  getHostRevenueMetrics,
  validateIdempotencyKey,
};
