'use strict';

const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const { ValidationError, NotFoundError } = require('../utils/errors');

function computeDiscount(coupon, orderAmount) {
  let discount = 0;
  if (coupon.Type === 'percent') {
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

async function validateCoupon({ code, userId, orderAmount, branchId = null, hostId = null }) {
  if (!code) throw new ValidationError('Thiếu mã giảm giá.');
  const coupon = await Coupon.findOne({ Code: String(code).trim().toUpperCase(), Status: 'active' });
  if (!coupon) throw new NotFoundError('Mã giảm giá không hợp lệ.');

  const now = new Date();
  if (coupon.StartsAt && now < coupon.StartsAt) throw new ValidationError('Mã chưa có hiệu lực.');
  if (coupon.EndsAt && now > coupon.EndsAt) throw new ValidationError('Mã đã hết hạn.');
  if (coupon.MinOrderAmount && orderAmount < coupon.MinOrderAmount) {
    throw new ValidationError(`Đơn tối thiểu ${coupon.MinOrderAmount.toLocaleString('vi-VN')}đ.`);
  }
  if (coupon.UsageLimit != null && coupon.UsedCount >= coupon.UsageLimit) {
    throw new ValidationError('Mã đã hết lượt sử dụng.');
  }
  if (coupon.HostID && hostId && String(coupon.HostID) !== String(hostId)) {
    throw new ValidationError('Mã không áp dụng cho host này.');
  }
  if (coupon.BranchIDs?.length && branchId) {
    const ok = coupon.BranchIDs.some((b) => String(b) === String(branchId));
    if (!ok) throw new ValidationError('Mã không áp dụng cho cơ sở này.');
  }
  if (userId && coupon.PerUserLimit) {
    const used = await CouponRedemption.countDocuments({ CouponID: coupon._id, UserID: userId });
    if (used >= coupon.PerUserLimit) throw new ValidationError('Bạn đã dùng hết lượt mã này.');
  }

  const discountAmount = computeDiscount(coupon, orderAmount);
  return {
    coupon,
    discountAmount,
    finalAmount: Math.max(0, orderAmount - discountAmount),
  };
}

async function redeemCoupon({ couponId, userId, bookingId, discountAmount }) {
  await CouponRedemption.create({
    CouponID: couponId,
    UserID: userId,
    BookingID: bookingId,
    DiscountAmount: discountAmount,
  });
  await Coupon.updateOne({ _id: couponId }, { $inc: { UsedCount: 1 } });
}

module.exports = { validateCoupon, redeemCoupon, computeDiscount };
