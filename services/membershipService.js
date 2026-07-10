'use strict';

const { MembershipPlan, Membership } = require('../models/Membership');
const { NotFoundError, ValidationError, ConflictError } = require('../utils/errors');

async function listPlans() {
  return MembershipPlan.find({ Status: 'active' }).lean();
}

async function getActiveMembership(userId) {
  return Membership.findOne({
    UserID: userId,
    Status: 'active',
    EndsAt: { $gt: new Date() },
  })
    .populate('PlanID')
    .lean();
}

async function subscribe({ userId, planCode }) {
  const plan = await MembershipPlan.findOne({
    Code: String(planCode).toUpperCase(),
    Status: 'active',
  });
  if (!plan) throw new NotFoundError('Gói membership không tồn tại.');

  const existing = await Membership.findOne({
    UserID: userId,
    Status: 'active',
    EndsAt: { $gt: new Date() },
  });
  if (existing) throw new ConflictError('Bạn đã có membership đang active.');

  const starts = new Date();
  const ends = new Date(starts);
  ends.setMonth(ends.getMonth() + 1);

  return Membership.create({
    UserID: userId,
    PlanID: plan._id,
    CreditsRemaining: plan.IncludedHours || 0,
    StartsAt: starts,
    EndsAt: ends,
    Status: 'active',
  });
}

async function consumeCredit(userId, hours = 1) {
  const m = await Membership.findOne({
    UserID: userId,
    Status: 'active',
    EndsAt: { $gt: new Date() },
  });
  if (!m) throw new ValidationError('Không có membership active.');
  if (m.CreditsRemaining < hours) {
    throw new ValidationError('Không đủ giờ membership.');
  }
  m.CreditsRemaining -= hours;
  await m.save();
  return m;
}

module.exports = { listPlans, getActiveMembership, subscribe, consumeCredit };
