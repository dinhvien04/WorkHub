"use strict";

const Dispute = require("../models/Dispute");
const Booking = require("../models/Booking");
const refundService = require("./refundService");
const { notifyUser } = require("./notificationService");
const { withTransaction } = require("../utils/mongoTransaction");
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} = require("../utils/errors");

async function openDispute({ bookingId, userId, reason }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");
  if (
    String(booking.CustomerID) !== String(userId) &&
    String(booking.HostID) !== String(userId)
  ) {
    throw new ForbiddenError("Không có quyền mở dispute.");
  }
  const existing = await Dispute.findOne({
    BookingID: bookingId,
    Status: { $in: ["open", "under_review", "appealed"] },
  });
  if (existing) throw new ValidationError("Đã có dispute đang mở.");

  const d = await Dispute.create({
    BookingID: bookingId,
    CustomerID: booking.CustomerID,
    HostID: booking.HostID,
    OpenedBy: userId,
    Reason: String(reason || "").slice(0, 2000),
    Status: "open",
  });
  booking.Status =
    booking.Status === "completed" ? "completed" : booking.Status;
  await booking.save();

  await notifyUser({
    userId:
      String(booking.CustomerID) === String(userId)
        ? booking.HostID
        : booking.CustomerID,
    title: "Dispute mới",
    body: String(reason || "").slice(0, 120),
    type: "admin",
    entityType: "Dispute",
    entityId: d._id,
  });
  return d;
}

async function listDisputes({ role, userId, status, page = 1, limit = 20 }) {
  const filter = {};
  if (role === "customer") filter.CustomerID = userId;
  else if (role === "host") filter.HostID = userId;
  if (status) filter.Status = status;
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Dispute.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Dispute.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

async function resolveDispute({
  disputeId,
  adminId,
  resolution,
  refundAmount = 0,
  reject = false,
}) {
  return withTransaction(async (session) => {
    const findQ = Dispute.findById(disputeId);
    if (session) findQ.session(session);
    const d = await findQ;
    if (!d) throw new NotFoundError("Không tìm thấy dispute.");
    if (!["open", "under_review", "appealed"].includes(d.Status)) {
      throw new ValidationError("Dispute không thể resolve.");
    }
    if (reject) {
      d.Status = "rejected";
      d.Resolution = resolution || "Rejected";
      d.ResolvedBy = adminId;
      d.ResolvedAt = new Date();
      await d.save(session ? { session } : undefined);
      return d;
    }
    d.Status = "resolved";
    d.Resolution = resolution || "Resolved";
    d.RefundAmount = Math.max(0, Number(refundAmount) || 0);
    d.ResolvedBy = adminId;
    d.ResolvedAt = new Date();
    await d.save(session ? { session } : undefined);

    if (d.RefundAmount > 0) {
      await refundService.requestRefund({
        bookingId: d.BookingID,
        userId: adminId,
        role: "admin",
        amount: d.RefundAmount,
        reason: `Dispute ${d._id}: ${d.Resolution}`,
        idempotencyKey: `dispute-refund-${d._id}`,
        session,
      });
      const refund = await RefundLatest(d.BookingID, session);
      if (refund) {
        await refundService.processRefund({
          refundId: refund._id,
          actorId: adminId,
          approve: true,
          role: "admin",
          session,
        });
      }
    }
    return d;
  });
}

async function RefundLatest(bookingId, session = null) {
  const Refund = require("../models/Refund");
  const q = Refund.findOne({ BookingID: bookingId }).sort({ createdAt: -1 });
  if (session) q.session(session);
  return q;
}

module.exports = { openDispute, listDisputes, resolveDispute };
