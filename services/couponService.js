"use strict";

const Coupon = require("../models/Coupon");
const CouponRedemption = require("../models/CouponRedemption");
const CouponUserUsage = require("../models/CouponUserUsage");
const {
  ValidationError,
  NotFoundError,
  ConflictError,
} = require("../utils/errors");

function computeDiscount(coupon, orderAmount) {
  let discount = 0;
  if (coupon.Type === "percent") {
    discount = Math.round((orderAmount * coupon.Value) / 100);
  } else {
    discount = Math.round(coupon.Value);
  }
  if (coupon.MaxDiscountAmount != null) {
    discount = Math.min(discount, coupon.MaxDiscountAmount);
  }
  discount = Math.min(discount, orderAmount);
  return Math.max(0, discount);
}

async function validateCoupon({
  code,
  userId,
  orderAmount,
  branchId = null,
  hostId = null,
}) {
  if (!code) throw new ValidationError("Thiếu mã giảm giá.");
  const coupon = await Coupon.findOne({
    Code: String(code).trim().toUpperCase(),
    Status: "active",
  });
  if (!coupon) throw new NotFoundError("Mã giảm giá không hợp lệ.");

  const now = new Date();
  if (coupon.StartsAt && now < coupon.StartsAt)
    throw new ValidationError("Mã chưa có hiệu lực.");
  if (coupon.EndsAt && now > coupon.EndsAt)
    throw new ValidationError("Mã đã hết hạn.");
  if (coupon.MinOrderAmount && orderAmount < coupon.MinOrderAmount) {
    throw new ValidationError(
      `Đơn tối thiểu ${coupon.MinOrderAmount.toLocaleString("vi-VN")}đ.`,
    );
  }
  if (coupon.UsageLimit != null && coupon.UsedCount >= coupon.UsageLimit) {
    throw new ValidationError("Mã đã hết lượt sử dụng.");
  }
  if (coupon.HostID && hostId && String(coupon.HostID) !== String(hostId)) {
    throw new ValidationError("Mã không áp dụng cho host này.");
  }
  if (coupon.BranchIDs?.length && branchId) {
    const ok = coupon.BranchIDs.some((b) => String(b) === String(branchId));
    if (!ok) throw new ValidationError("Mã không áp dụng cho cơ sở này.");
  }
  if (userId && coupon.PerUserLimit) {
    const usage = await CouponUserUsage.findOne({
      CouponID: coupon._id,
      UserID: userId,
    }).lean();
    const used = usage?.UsedCount || 0;
    if (used >= coupon.PerUserLimit)
      throw new ValidationError("Bạn đã dùng hết lượt mã này.");
  }

  const discountAmount = computeDiscount(coupon, orderAmount);
  return {
    coupon,
    discountAmount,
    finalAmount: Math.max(0, orderAmount - discountAmount),
  };
}

/**
 * Atomic redemption: global UsedCount + per-user CAS + redemption row.
 * All writes share the caller's Mongo session when provided.
 */
async function redeemCoupon({
  couponId,
  userId,
  bookingId,
  discountAmount,
  session = null,
}) {
  const findQ = Coupon.findById(couponId);
  if (session) findQ.session(session);
  const coupon = await findQ;
  if (!coupon) throw new NotFoundError("Coupon không tồn tại.");

  // Conditional global usage limit
  const filter = { _id: couponId, Status: "active" };
  if (coupon.UsageLimit != null) {
    filter.UsedCount = { $lt: coupon.UsageLimit };
  }
  const updateQ = Coupon.findOneAndUpdate(
    filter,
    { $inc: { UsedCount: 1 } },
    { new: true },
  );
  if (session) updateQ.session(session);
  const updated = await updateQ;
  if (!updated) {
    throw new ConflictError("Mã đã hết lượt sử dụng.");
  }

  // Atomic per-user counter: UsedCount < PerUserLimit
  if (coupon.PerUserLimit) {
    // Ensure row exists
    try {
      const ensure = CouponUserUsage.findOneAndUpdate(
        { CouponID: couponId, UserID: userId },
        {
          $setOnInsert: { UsedCount: 0, Version: 0 },
        },
        { upsert: true, new: true },
      );
      if (session) ensure.session(session);
      await ensure;
    } catch (err) {
      if (err.code !== 11000) {
        // rollback global
        const rb = Coupon.updateOne(
          { _id: couponId },
          { $inc: { UsedCount: -1 } },
        );
        if (session) rb.session(session);
        await rb;
        throw err;
      }
    }

    const perUser = CouponUserUsage.findOneAndUpdate(
      {
        CouponID: couponId,
        UserID: userId,
        UsedCount: { $lt: coupon.PerUserLimit },
      },
      { $inc: { UsedCount: 1, Version: 1 } },
      { new: true },
    );
    if (session) perUser.session(session);
    const usageOk = await perUser;
    if (!usageOk) {
      const rb = Coupon.updateOne(
        { _id: couponId },
        { $inc: { UsedCount: -1 } },
      );
      if (session) rb.session(session);
      await rb;
      throw new ConflictError("Bạn đã dùng hết lượt mã này.");
    }
  }

  try {
    if (session) {
      await CouponRedemption.create(
        [
          {
            CouponID: couponId,
            UserID: userId,
            BookingID: bookingId,
            DiscountAmount: discountAmount,
            IdempotencyKey: `redeem-${couponId}-${bookingId}`,
          },
        ],
        { session },
      );
    } else {
      await CouponRedemption.create({
        CouponID: couponId,
        UserID: userId,
        BookingID: bookingId,
        DiscountAmount: discountAmount,
        IdempotencyKey: `redeem-${couponId}-${bookingId}`,
      });
    }
  } catch (err) {
    const rb = Coupon.updateOne({ _id: couponId }, { $inc: { UsedCount: -1 } });
    if (session) rb.session(session);
    await rb;
    if (coupon.PerUserLimit) {
      const rbU = CouponUserUsage.updateOne(
        { CouponID: couponId, UserID: userId, UsedCount: { $gte: 1 } },
        { $inc: { UsedCount: -1, Version: 1 } },
      );
      if (session) rbU.session(session);
      await rbU;
    }
    if (err.code === 11000) {
      throw new ConflictError("Coupon đã được áp dụng cho booking này.");
    }
    throw err;
  }
}

module.exports = { validateCoupon, redeemCoupon, computeDiscount };
