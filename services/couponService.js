"use strict";

const Coupon = require("../models/Coupon");
const CouponRedemption = require("../models/CouponRedemption");
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
    const used = await CouponRedemption.countDocuments({
      CouponID: coupon._id,
      UserID: userId,
    });
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
 * Atomic redemption: conditional UsedCount + unique (Coupon, User, Booking).
 * Throws if limit exceeded — caller must not keep discount without redemption.
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

  // Per-user limit after claim
  if (coupon.PerUserLimit) {
    const countQ = CouponRedemption.countDocuments({
      CouponID: couponId,
      UserID: userId,
    });
    if (session) countQ.session(session);
    const used = await countQ;
    if (used >= coupon.PerUserLimit) {
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
    const rb = Coupon.updateOne(
      { _id: couponId },
      { $inc: { UsedCount: -1 } },
    );
    if (session) rb.session(session);
    await rb;
    if (err.code === 11000) {
      throw new ConflictError("Coupon đã được áp dụng cho booking này.");
    }
    throw err;
  }
}

module.exports = { validateCoupon, redeemCoupon, computeDiscount };
