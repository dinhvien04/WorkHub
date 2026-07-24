'use strict';

const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    Code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    Type: { type: String, enum: ['percent', 'fixed'], required: true },
    Value: { type: Number, required: true, min: 0 },
    MinOrderAmount: { type: Number, default: 0, min: 0 },
    MaxDiscountAmount: { type: Number, default: null },
    StartsAt: { type: Date, default: null },
    EndsAt: { type: Date, default: null },
    UsageLimit: { type: Number, default: null },
    UsedCount: { type: Number, default: 0 },
    PerUserLimit: { type: Number, default: 1 },
    HostID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    BranchIDs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
    FundedBy: { type: String, enum: ['platform', 'host'], default: 'platform' },
    Status: { type: String, enum: ['active', 'inactive', 'expired'], default: 'active', index: true },
    Description: { type: String, default: '' },
  },
  { collection: 'coupons', timestamps: true }
);

module.exports = mongoose.model('Coupon', couponSchema);
