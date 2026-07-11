"use strict";

const { MembershipPlan, Membership } = require("../models/Membership");
const MembershipCreditLedger = require("../models/MembershipCreditLedger");
const {
  NotFoundError,
  ValidationError,
  ConflictError,
} = require("../utils/errors");

async function listPlans() {
  return MembershipPlan.find({ Status: "active" }).lean();
}

async function getActiveMembership(userId) {
  return Membership.findOne({
    UserID: userId,
    Status: "active",
    EndsAt: { $gt: new Date() },
  })
    .populate("PlanID")
    .lean();
}

/**
 * Append-only credit post — balance update + ledger insert in one transaction.
 * Requires idempotency key for financial mutations when provided by callers.
 */
async function postCreditEntry({
  membershipId,
  userId,
  type,
  hours,
  direction,
  description = "",
  expiresAt = null,
  bookingId = null,
  idempotencyKey = null,
  meta = {},
}) {
  const hrs = Math.abs(Number(hours) || 0);
  if (!membershipId || !userId || !type || !direction) {
    throw new ValidationError("Credit ledger thiếu field bắt buộc.");
  }
  if (hrs <= 0 && type !== "adjust") {
    throw new ValidationError("Hours phải > 0.");
  }

  if (idempotencyKey) {
    const existing = await MembershipCreditLedger.findOne({
      IdempotencyKey: idempotencyKey,
    });
    if (existing) {
      // Same key different hours → conflict
      if (Math.abs(Number(existing.Hours) || 0) !== hrs) {
        throw new ConflictError("Idempotency-Key đã dùng với số giờ khác.");
      }
      return existing;
    }
  }

  const { withTransaction } = require("../utils/mongoTransaction");
  const env = require("../config/env");
  const fingerprint = [
    String(membershipId),
    String(userId),
    String(type),
    String(direction),
    String(hrs),
    String(bookingId || ""),
  ].join("|");

  if (idempotencyKey) {
    const existing = await MembershipCreditLedger.findOne({
      IdempotencyKey: idempotencyKey,
    });
    if (existing) {
      const prevFp = existing.Meta?.fingerprint;
      if (prevFp && prevFp !== fingerprint) {
        throw new ConflictError(
          "Idempotency-Key đã dùng với request fingerprint khác.",
        );
      }
      if (Math.abs(Number(existing.Hours) || 0) !== hrs) {
        throw new ConflictError("Idempotency-Key đã dùng với số giờ khác.");
      }
      return existing;
    }
  }

  try {
    return await withTransaction(
      async (session) => {
        // Re-check inside txn
        if (idempotencyKey) {
          const againQ = MembershipCreditLedger.findOne({
            IdempotencyKey: idempotencyKey,
          });
          if (session) againQ.session(session);
          const existing = await againQ;
          if (existing) return existing;
        }

        // Ledger-first intent insert (unique key) BEFORE balance mutation.
        // On concurrent race the loser gets 11000 and aborts the whole txn.
        let provisional;
        try {
          const intent = {
            MembershipID: membershipId,
            UserID: userId,
            Type: type,
            Hours: hrs,
            Direction: direction,
            BalanceAfter: 0, // updated after balance CAS
            ExpiresAt: expiresAt,
            BookingID: bookingId || null,
            IdempotencyKey: idempotencyKey || undefined,
            Description: description,
            Meta: { ...meta, fingerprint, provisional: true },
          };
          if (session) {
            [provisional] = await MembershipCreditLedger.create([intent], {
              session,
            });
          } else {
            provisional = await MembershipCreditLedger.create(intent);
          }
        } catch (err) {
          if (err.code === 11000 && idempotencyKey) {
            // Abort txn by throwing — caller loads existing outside
            const race = new Error("IDEMPOTENCY_RACE");
            race.code = "IDEMPOTENCY_RACE";
            race.idempotencyKey = idempotencyKey;
            throw race;
          }
          throw err;
        }

        const filter = { _id: membershipId };
        let inc = 0;
        if (direction === "credit") {
          inc = hrs;
        } else {
          inc = -hrs;
          filter.CreditsRemaining = { $gte: hrs };
        }

        const updQ = Membership.findOneAndUpdate(
          filter,
          { $inc: { CreditsRemaining: inc } },
          { new: true },
        );
        if (session) updQ.session(session);
        const updated = await updQ;
        if (!updated) {
          if (direction === "debit") {
            throw new ValidationError("Không đủ giờ membership.");
          }
          throw new NotFoundError("Membership không tồn tại.");
        }

        const next = Math.max(0, updated.CreditsRemaining || 0);
        const finQ = MembershipCreditLedger.findOneAndUpdate(
          { _id: provisional._id },
          {
            $set: {
              BalanceAfter: next,
              Meta: { ...meta, fingerprint, provisional: false },
            },
          },
          { new: true },
        );
        if (session) finQ.session(session);
        return finQ;
      },
      { required: env.isProduction },
    );
  } catch (err) {
    if (err.code === "IDEMPOTENCY_RACE" && err.idempotencyKey) {
      return MembershipCreditLedger.findOne({
        IdempotencyKey: err.idempotencyKey,
      });
    }
    throw err;
  }
}

async function subscribe({ userId, planCode }) {
  const plan = await MembershipPlan.findOne({
    Code: String(planCode).toUpperCase(),
    Status: "active",
  });
  if (!plan) throw new NotFoundError("Gói membership không tồn tại.");

  // Paid plans (MonthlyPrice > 0) always require verified payment flow.
  // MEMBERSHIP_PAID_ENABLED alone must NEVER activate paid plans for free.
  if ((plan.MonthlyPrice || 0) > 0) {
    throw new ValidationError(
      "Gói trả phí yêu cầu thanh toán đã xác minh. Đăng ký trực tiếp chưa khả dụng.",
    );
  }

  const existing = await Membership.findOne({
    UserID: userId,
    Status: "active",
    EndsAt: { $gt: new Date() },
  });
  if (existing) throw new ConflictError("Bạn đã có membership đang active.");

  const starts = new Date();
  const ends = new Date(starts);
  ends.setMonth(ends.getMonth() + 1);

  // Create with 0 credits; grant via ledger so balance always has ledger trail
  const membership = await Membership.create({
    UserID: userId,
    PlanID: plan._id,
    CreditsRemaining: 0,
    StartsAt: starts,
    EndsAt: ends,
    Status: "active",
  });

  const grantHours = plan.IncludedHours || 0;
  if (grantHours > 0) {
    await postCreditEntry({
      membershipId: membership._id,
      userId,
      type: "grant",
      hours: grantHours,
      direction: "credit",
      description: `Cấp ${grantHours}h gói ${plan.Code}`,
      expiresAt: ends,
      idempotencyKey: `grant-sub-${membership._id}`,
      meta: { planCode: plan.Code, planId: String(plan._id) },
    });
    await membership.populate("PlanID");
    // refresh credits
    const fresh = await Membership.findById(membership._id);
    return fresh;
  }

  return membership;
}

async function consumeCredit(
  userId,
  hours = 1,
  { bookingId = null, idempotencyKey = null } = {},
) {
  const m = await Membership.findOne({
    UserID: userId,
    Status: "active",
    EndsAt: { $gt: new Date() },
  });
  if (!m) throw new ValidationError("Không có membership active.");

  const entry = await postCreditEntry({
    membershipId: m._id,
    userId,
    type: "consume",
    hours,
    direction: "debit",
    description: `Sử dụng ${hours}h membership`,
    bookingId,
    idempotencyKey:
      idempotencyKey || (bookingId ? `consume-${bookingId}-${hours}` : null),
    meta: bookingId ? { bookingId: String(bookingId) } : {},
  });

  const fresh = await Membership.findById(m._id);
  return { membership: fresh, entry };
}

/**
 * Expire remaining credits when membership ends (or force).
 * Writes expire ledger debit for remaining balance.
 */
async function expireCredits(
  membershipId,
  { reason = "membership_ended" } = {},
) {
  const m = await Membership.findById(membershipId);
  if (!m) throw new NotFoundError("Membership không tồn tại.");
  const remaining = m.CreditsRemaining || 0;
  if (remaining <= 0) {
    if (m.Status === "active" && m.EndsAt <= new Date()) {
      m.Status = "expired";
      await m.save();
    }
    return { membership: m, entry: null };
  }

  const entry = await postCreditEntry({
    membershipId: m._id,
    userId: m.UserID,
    type: "expire",
    hours: remaining,
    direction: "debit",
    description: `Hết hạn ${remaining}h credit`,
    idempotencyKey: `expire-${m._id}`,
    meta: { reason },
  });

  // Reload — postCreditEntry already zeroed CreditsRemaining on a separate doc instance
  const fresh = await Membership.findById(m._id);
  fresh.Status = "expired";
  await fresh.save();
  return { membership: fresh, entry };
}

async function listCreditLedger(userId, { page = 1, limit = 50 } = {}) {
  const skip = (page - 1) * limit;
  const filter = { UserID: userId };
  const [items, total] = await Promise.all([
    MembershipCreditLedger.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    MembershipCreditLedger.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

/**
 * Grant extra credits (admin/host promo) via ledger only.
 */
async function grantCredits({
  userId,
  hours,
  description = "Cấp thêm credit",
  meta = {},
}) {
  const m = await Membership.findOne({
    UserID: userId,
    Status: "active",
    EndsAt: { $gt: new Date() },
  });
  if (!m) throw new ValidationError("Không có membership active.");
  const entry = await postCreditEntry({
    membershipId: m._id,
    userId,
    type: "grant",
    hours,
    direction: "credit",
    description,
    expiresAt: m.EndsAt,
    meta,
  });
  const fresh = await Membership.findById(m._id);
  return { membership: fresh, entry };
}

module.exports = {
  listPlans,
  getActiveMembership,
  subscribe,
  consumeCredit,
  expireCredits,
  listCreditLedger,
  grantCredits,
  postCreditEntry,
};
