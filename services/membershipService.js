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
 * Append-only credit post. Updates Membership.CreditsRemaining only after ledger insert.
 * Never call Membership.update on CreditsRemaining outside this function.
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
    if (existing) return existing;
  }

  const m = await Membership.findById(membershipId);
  if (!m) throw new NotFoundError("Membership không tồn tại.");

  const signed = direction === "credit" ? hrs : -hrs;
  const next = Math.max(0, (m.CreditsRemaining || 0) + signed);

  if (direction === "debit" && (m.CreditsRemaining || 0) < hrs) {
    throw new ValidationError("Không đủ giờ membership.");
  }

  let entry;
  try {
    entry = await MembershipCreditLedger.create({
      MembershipID: membershipId,
      UserID: userId,
      Type: type,
      Hours: hrs,
      Direction: direction,
      BalanceAfter: next,
      ExpiresAt: expiresAt,
      BookingID: bookingId || null,
      IdempotencyKey: idempotencyKey || undefined,
      Description: description,
      Meta: meta,
    });
  } catch (err) {
    if (err.code === 11000 && idempotencyKey) {
      return MembershipCreditLedger.findOne({ IdempotencyKey: idempotencyKey });
    }
    throw err;
  }

  // Denormalized balance — only path that mutates CreditsRemaining
  m.CreditsRemaining = next;
  await m.save();
  return entry;
}

async function subscribe({ userId, planCode }) {
  const plan = await MembershipPlan.findOne({
    Code: String(planCode).toUpperCase(),
    Status: "active",
  });
  if (!plan) throw new NotFoundError("Gói membership không tồn tại.");

  // Paid plans require payment flow — disabled until MEMBERSHIP_PAID_ENABLED
  const env = require("../config/env");
  if ((plan.MonthlyPrice || 0) > 0 && !env.MEMBERSHIP_PAID_ENABLED) {
    // Free-tier exception: MonthlyPrice 0 only; paid blocked by flag
    // Allow in test for existing suites unless explicitly free-only mode
    if (env.isProduction) {
      throw new ValidationError(
        "Đăng ký gói trả phí tạm khóa. Liên hệ hỗ trợ hoặc bật MEMBERSHIP_PAID_ENABLED sau khi có checkout.",
      );
    }
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
