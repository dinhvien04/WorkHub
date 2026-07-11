'use strict';

const mongoose = require('mongoose');

/**
 * Atomic per-user coupon usage counter (CAS: UsedCount < PerUserLimit).
 */
const couponUserUsageSchema = new mongoose.Schema(
  {
    CouponID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon',
      required: true,
    },
    UserID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    UsedCount: { type: Number, default: 0, min: 0 },
    Version: { type: Number, default: 0 },
  },
  { collection: 'coupon_user_usages', timestamps: true }
);

couponUserUsageSchema.index({ CouponID: 1, UserID: 1 }, { unique: true });

module.exports = mongoose.model('CouponUserUsage', couponUserUsageSchema);
