"use strict";

const Refund = require("../models/Refund");
const RefundAllocation = require("../models/RefundAllocation");
const PaymentHistory = require("../models/Payment_History");
const Booking = require("../models/Booking");
const LedgerEntry = require("../models/LedgerEntry");
const ledgerService = require("./ledgerService");
const { withTransaction } = require("../utils/mongoTransaction");
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require("../utils/errors");

/** Test-only failure injection hooks (cleared after each test). */
const _testHooks = {
  afterFirstPaymentUpdate: null,
  afterAllocation: null,
  afterLedger: null,
  beforeComplete: null,
};

function setTestHooks(hooks = {}) {
  Object.assign(_testHooks, hooks);
}

function clearTestHooks() {
  for (const k of Object.keys(_testHooks)) _testHooks[k] = null;
}

async function runHook(name) {
  const fn = _testHooks[name];
  if (typeof fn === "function") await fn();
}

async function getSuccessfulPaid(bookingId, session = null) {
  const { getNetPaidForBooking } = require("../utils/netPaid");
  return getNetPaidForBooking(bookingId, { session });
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
  session = null,
}) {
  if (!idempotencyKey) {
    throw new ValidationError(
      "Idempotency-Key là bắt buộc cho yêu cầu hoàn tiền.",
    );
  }

  const bookingQ = Booking.findById(bookingId);
  if (session) bookingQ.session(session);
  const booking = await bookingQ;
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");
  const isCustomer = String(booking.CustomerID) === String(userId);
  const isHost = String(booking.HostID) === String(userId);
  if (!isCustomer && !isHost && role !== "admin") {
    throw new ForbiddenError("Không có quyền yêu cầu hoàn tiền.");
  }

  const paid = await getSuccessfulPaid(bookingId, session);
  const pendingSumQ = Refund.find({
    BookingID: bookingId,
    Status: { $in: ["requested", "approved", "processing"] },
  });
  if (session) pendingSumQ.session(session);
  const pendingSum = (await pendingSumQ).reduce((s, r) => s + r.Amount, 0);

  const amt = Math.round(Number(amount));
  const netAvailable = paid;
  if (!amt || amt <= 0 || amt > netAvailable - pendingSum) {
    throw new ValidationError(
      `Số tiền hoàn không hợp lệ (tối đa ${Math.max(0, netAvailable - pendingSum)}).`,
    );
  }

  // Scope idempotency by requester + booking + operation via hash prefix
  const crypto = require("crypto");
  const scopedKey = crypto
    .createHash("sha256")
    .update(`refund:${userId}:${bookingId}:${idempotencyKey}`)
    .digest("hex");
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      `${userId}|${bookingId}|${amt}|${String(reason || "").slice(0, 200)}`,
    )
    .digest("hex");

  const existingQ = Refund.findOne({ IdempotencyKey: scopedKey });
  if (session) existingQ.session(session);
  const existing = await existingQ;
  if (existing) {
    if (existing.Amount !== amt) {
      throw new ConflictError("Idempotency-Key đã dùng với số tiền khác.");
    }
    if (
      existing.Meta?.fingerprint &&
      existing.Meta.fingerprint !== fingerprint
    ) {
      throw new ConflictError(
        "Idempotency-Key đã dùng với request fingerprint khác.",
      );
    }
    return existing;
  }

  try {
    const doc = {
      BookingID: bookingId,
      CustomerID: booking.CustomerID,
      HostID: booking.HostID,
      Amount: amt,
      Reason: String(reason || "").slice(0, 1000),
      Status: "requested",
      RequestedBy: userId,
      IdempotencyKey: scopedKey,
      Meta: { fingerprint, clientKey: String(idempotencyKey).slice(0, 100) },
    };
    let refund;
    if (session) {
      const created = await Refund.create([doc], { session });
      refund = created[0];
    } else {
      refund = await Refund.create(doc);
    }
    try {
      const outboxService = require("./outboxService");
      await outboxService.enqueueNotification(
        {
          userId: booking.HostID,
          title: "Yêu cầu hoàn tiền",
          body: `${amt.toLocaleString("vi-VN")}đ`,
          type: "payment",
          entityType: "Refund",
          entityId: refund._id,
          link: "/host/payments",
        },
        { idempotencyKey: `refund:${refund._id}:notify-request`, session },
      );
      // Worker owns delivery — no processPending / no direct notify fallback
    } catch {
      /* enqueue failure non-fatal for refund request record */
    }
    return refund;
  } catch (err) {
    if (err.code === 11000) {
      const againQ = Refund.findOne({ IdempotencyKey: scopedKey });
      if (session) againQ.session(session);
      const again = await againQ;
      if (again) {
        if (again.Amount !== amt) {
          throw new ConflictError("Idempotency-Key đã dùng với số tiền khác.");
        }
        return again;
      }
      throw new ConflictError("Refund trùng lặp.");
    }
    throw err;
  }
}

/**
 * Allocate refund across payments oldest-first within optional session.
 * On failure mid-way when no session, compensates mutations.
 */
async function allocateRefundToPayments(refund, session = null) {
  const q = PaymentHistory.find({
    BookingID: refund.BookingID,
    Status: { $in: ["successful", "partially_refunded"] },
  }).sort({ PaidAt: 1, createdAt: 1 });
  if (session) q.session(session);
  const payments = await q;

  let remaining = refund.Amount;
  const allocations = [];
  const compensation = []; // for non-txn rollback

  try {
    let first = true;
    for (const p of payments) {
      if (remaining <= 0) break;
      const already = Number(p.RefundedAmount || 0);
      const net = Math.max(0, p.Amount - already);
      if (net <= 0) continue;
      const take = Math.min(net, remaining);

      const updateQ = PaymentHistory.findOneAndUpdate(
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
      if (session) updateQ.session(session);
      const updated = await updateQ;
      if (!updated) continue;

      const newRefunded = Number(updated.RefundedAmount || 0);
      let newStatus = updated.Status;
      if (newRefunded >= updated.Amount) {
        newStatus = "refunded";
      } else if (newRefunded > 0) {
        newStatus = "partially_refunded";
      }
      if (newStatus !== updated.Status) {
        const statusQ = PaymentHistory.updateOne(
          { _id: updated._id },
          { $set: { Status: newStatus } },
        );
        if (session) statusQ.session(session);
        await statusQ;
      }

      compensation.push({
        paymentId: updated._id,
        amount: take,
        prevStatus: p.Status,
      });

      if (first) {
        await runHook("afterFirstPaymentUpdate");
        first = false;
      }

      const allocCreate = session
        ? RefundAllocation.create(
            [
              {
                RefundID: refund._id,
                PaymentID: updated._id,
                Amount: take,
              },
            ],
            { session },
          )
        : RefundAllocation.create({
            RefundID: refund._id,
            PaymentID: updated._id,
            Amount: take,
          });
      const allocDoc = session ? (await allocCreate)[0] : await allocCreate;
      allocations.push({
        paymentId: updated._id,
        amount: take,
        allocationId: allocDoc._id,
      });
      remaining -= take;

      await runHook("afterAllocation");
    }

    if (remaining > 0) {
      throw new ValidationError("Không đủ số dư payment để phân bổ hoàn tiền.");
    }
    return allocations;
  } catch (err) {
    if (!session && compensation.length) {
      await compensateAllocations(compensation, refund._id);
    }
    throw err;
  }
}

async function compensateAllocations(compensation, refundId) {
  for (const c of compensation) {
    await PaymentHistory.findOneAndUpdate(
      { _id: c.paymentId },
      {
        $inc: { RefundedAmount: -c.amount },
        $set: { Status: c.prevStatus },
      },
    );
  }
  await RefundAllocation.deleteMany({ RefundID: refundId });
}

async function processRefund({
  refundId,
  actorId,
  approve,
  role,
  transferReference = null,
  evidence = "",
  submitProvider = true,
  session = null,
}) {
  const refundQ = Refund.findById(refundId);
  if (session) refundQ.session(session);
  const refund = await refundQ;
  if (!refund) throw new NotFoundError("Không tìm thấy refund.");
  if (role !== "admin" && String(refund.HostID) !== String(actorId)) {
    throw new ForbiddenError("Không có quyền xử lý refund.");
  }

  // Provider settle / manual confirm entry points
  if (
    approve &&
    [
      "provider_pending",
      "provider_submitted",
      "manual_action_required",
    ].includes(refund.Status)
  ) {
    const providerRefundService = require("./providerRefundService");
    if (transferReference) {
      return providerRefundService.confirmManualRefund({
        refundId,
        actorId,
        transferReference,
        evidence,
      });
    }
    if (submitProvider) {
      return providerRefundService.submitProviderRefunds(refundId);
    }
  }

  if (refund.Status !== "requested" && refund.Status !== "approved") {
    throw new ValidationError("Refund không ở trạng thái xử lý được.");
  }

  if (!approve) {
    refund.Status = "rejected";
    refund.ProcessedBy = actorId;
    refund.ProcessedAt = new Date();
    await refund.save(session ? { session } : undefined);
    return refund;
  }

  const executeWork = async (activeSession) => {
    // CAS refund requested/approved -> processing
    const claimQ = Refund.findOneAndUpdate(
      { _id: refundId, Status: { $in: ["requested", "approved"] } },
      { $set: { Status: "processing", ProcessedBy: actorId } },
      { new: true },
    );
    if (activeSession) claimQ.session(activeSession);
    const claimed = await claimQ;
    if (!claimed) {
      throw new ConflictError("Refund đang được xử lý hoặc đã xong.");
    }

    const paid = await getSuccessfulPaid(claimed.BookingID, activeSession);
    if (claimed.Amount > paid) {
      const failQ = Refund.findOneAndUpdate(
        { _id: claimed._id },
        {
          $set: {
            Status: "failed",
            FailureReason: "Exceeds net paid",
          },
        },
        { new: true },
      );
      if (activeSession) failQ.session(activeSession);
      await failQ;
      throw new ValidationError("Hoàn sẽ vượt số đã thanh toán thành công.");
    }

    // Detect gateway payments in allocation set — cannot complete without provider
    const payQ = PaymentHistory.find({
      BookingID: claimed.BookingID,
      Status: { $in: ["successful", "partially_refunded"] },
    }).select("PaymentMethod");
    if (activeSession) payQ.session(activeSession);
    const payMethods = await payQ.lean();
    const hasGateway = payMethods.some((p) => p.PaymentMethod === "e_wallet");

    if (hasGateway) {
      // Reserve allocation + mark provider_pending — do NOT ledger complete yet
      await allocateRefundToPayments(claimed, activeSession);
      await runHook("afterAllocation");
      const pendQ = Refund.findOneAndUpdate(
        { _id: claimed._id, Status: "processing" },
        {
          $set: {
            Status: "provider_pending",
            ProcessedBy: actorId,
            FailureReason: "",
            Meta: {
              ...(claimed.Meta || {}),
              requiresProviderRefund: true,
            },
          },
        },
        { new: true },
      );
      if (activeSession) pendQ.session(activeSession);
      return pendQ;
    }

    // Offline/manual (bank_transfer/cash): require transfer evidence
    if (!transferReference || !String(transferReference).trim()) {
      // Allocate + hold as manual_refund_required until evidence provided
      await allocateRefundToPayments(claimed, activeSession);
      const manQ = Refund.findOneAndUpdate(
        { _id: claimed._id, Status: "processing" },
        {
          $set: {
            Status: "manual_refund_required",
            ProcessedBy: actorId,
            Meta: {
              ...(claimed.Meta || {}),
              channel: "manual_offline",
              needsTransferReference: true,
            },
          },
        },
        { new: true },
      );
      if (activeSession) manQ.session(activeSession);
      return manQ;
    }

    await allocateRefundToPayments(claimed, activeSession);

    await ledgerService.postEntry(
      {
        hostId: claimed.HostID,
        customerId: claimed.CustomerID,
        bookingId: claimed.BookingID,
        type: "refund",
        amount: claimed.Amount,
        direction: "debit",
        description: `Refund ${claimed._id}`,
        idempotencyKey: `refund:${claimed._id}:debit`,
        meta: {
          refundId: claimed._id,
          channel: "manual_offline",
          transferReference: String(transferReference).slice(0, 200),
          evidence: String(evidence || "").slice(0, 500),
        },
      },
      { session: activeSession },
    );
    await runHook("afterLedger");
    await runHook("beforeComplete");

    const doneQ = Refund.findOneAndUpdate(
      { _id: claimed._id, Status: "processing" },
      {
        $set: {
          Status: "completed",
          ProcessedAt: new Date(),
          ProcessedBy: actorId,
          TransferReference: String(transferReference).slice(0, 200),
          Meta: {
            ...(claimed.Meta || {}),
            channel: "manual_offline",
            evidence: String(evidence || "").slice(0, 500),
          },
        },
      },
      { new: true },
    );
    if (activeSession) doneQ.session(activeSession);
    const done = await doneQ;
    if (!done) {
      throw new ConflictError("Refund complete CAS failed.");
    }
    return done;
  };

  // Full financial settle in one transaction (or compensating path)
  let completed;
  if (session) {
    completed = await executeWork(session);
  } else {
    try {
      completed = await withTransaction(executeWork);
    } catch (err) {
      // Transaction path: abort rolls back all writes. Non-txn path: compensate.
      const current = await Refund.findById(refundId);
      if (current && current.Status === "processing") {
        const allocs = await RefundAllocation.find({ RefundID: refundId });
        for (const a of allocs) {
          await PaymentHistory.findOneAndUpdate(
            { _id: a.PaymentID },
            { $inc: { RefundedAmount: -a.Amount } },
          );
        }
        if (allocs.length) {
          await RefundAllocation.deleteMany({ RefundID: refundId });
          const payments = await PaymentHistory.find({
            BookingID: current.BookingID,
          });
          for (const p of payments) {
            const fresh = await PaymentHistory.findById(p._id);
            if (!fresh) continue;
            let r = Number(fresh.RefundedAmount || 0);
            if (r < 0) r = 0;
            fresh.RefundedAmount = r;
            if (r <= 0) fresh.Status = "successful";
            else if (r >= fresh.Amount) fresh.Status = "refunded";
            else fresh.Status = "partially_refunded";
            await fresh.save();
          }
        }
        // Compensating ledger credit if debit already posted (non-txn)
        const ledgerKey = `refund:${current._id}:debit`;
        const existingDebit = await LedgerEntry.findOne({
          IdempotencyKey: ledgerKey,
          Status: "posted",
        });
        if (existingDebit) {
          try {
            await ledgerService.postEntry({
              hostId: current.HostID,
              customerId: current.CustomerID,
              bookingId: current.BookingID,
              type: "adjustment",
              amount: current.Amount,
              direction: "credit",
              description: `Refund compensate ${current._id}`,
              idempotencyKey: `refund:${current._id}:compensate`,
              meta: { refundId: current._id, compensate: true },
            });
          } catch {
            /* best-effort compensate */
          }
        }
        current.Status = "failed";
        current.FailureReason = String(err.message || "error").slice(0, 300);
        await current.save();
      }
      throw err;
    }
  }

  // After provider_pending: submit provider refunds outside the txn
  if (completed && completed.Status === "provider_pending" && submitProvider) {
    try {
      const providerRefundService = require("./providerRefundService");
      completed = await providerRefundService.submitProviderRefunds(
        completed._id,
      );
    } catch (err) {
      // Leave provider_pending; ops can retry
      completed.FailureReason = String(err.message || "provider submit").slice(
        0,
        300,
      );
      await completed.save(session ? { session } : undefined).catch(() => {});
    }
  }

  // Outbox only — worker delivers (no direct notify)
  try {
    const outboxService = require("./outboxService");
    const title =
      completed.Status === "completed"
        ? "Hoàn tiền đã xử lý"
        : completed.Status === "provider_pending" ||
            completed.Status === "provider_submitted"
          ? "Hoàn tiền đang chờ nhà cung cấp"
          : completed.Status === "manual_refund_required"
            ? "Hoàn tiền cần bằng chứng chuyển khoản"
            : "Hoàn tiền đang xử lý";
    await outboxService.enqueueNotification(
      {
        userId: completed.CustomerID,
        title,
        body: `${completed.Amount.toLocaleString("vi-VN")}đ`,
        type: "payment",
        entityType: "Refund",
        entityId: completed._id,
      },
      { idempotencyKey: `refund:${completed._id}:notify-done`, session },
    );
  } catch {
    /* non-fatal */
  }

  return completed;
}

module.exports = {
  requestRefund,
  processRefund,
  getSuccessfulPaid,
  getRefundedTotal,
  allocateRefundToPayments,
  setTestHooks,
  clearTestHooks,
};
