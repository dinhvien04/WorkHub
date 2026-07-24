'use strict';
const mongoose = require('mongoose');
const planSchema = new mongoose.Schema({
  Name: { type: String, required: true },
  Code: { type: String, required: true, unique: true, uppercase: true },
  MonthlyPrice: { type: Number, required: true, min: 0 },
  IncludedHours: { type: Number, default: 0 },
  DiscountPercent: { type: Number, default: 0, min: 0, max: 100 },
  PriorityBooking: { type: Boolean, default: false },
  Status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { collection: 'membership_plans', timestamps: true });

const memberSchema = new mongoose.Schema({
  UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  PlanID: { type: mongoose.Schema.Types.ObjectId, ref: 'MembershipPlan', required: true },
  CreditsRemaining: { type: Number, default: 0 },
  StartsAt: { type: Date, default: Date.now },
  EndsAt: { type: Date, required: true },
  Status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active', index: true },
}, { collection: 'memberships', timestamps: true });

const MembershipPlan = mongoose.model('MembershipPlan', planSchema);
const Membership = mongoose.model('Membership', memberSchema);
module.exports = { MembershipPlan, Membership };
