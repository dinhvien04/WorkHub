'use strict';

const mongoose = require('mongoose');

const couponRedemptionSchema = new mongoose.Schema(
  {
    CouponID: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    BookingID: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    DiscountAmount: { type: Number, required: true, min: 0 },
    IdempotencyKey: { type: String, sparse: true, unique: true },
  },
  { collection: 'coupon_redemptions', timestamps: true }
);

couponRedemptionSchema.index({ CouponID: 1, UserID: 1 });
couponRedemptionSchema.index({ CouponID: 1, UserID: 1, BookingID: 1 }, { unique: true });

module.exports = mongoose.model('CouponRedemption', couponRedemptionSchema);
