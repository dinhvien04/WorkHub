'use strict';

const PricingRule = require('../models/PricingRule');

/**
 * Apply active pricing rules (highest priority first).
 */
async function quotePrice({ hostId, spaceId, branchId, start, end, basePricePerHour }) {
  const hours = Math.max(0, (new Date(end) - new Date(start)) / 3600000);
  let unit = basePricePerHour;
  const rules = await PricingRule.find({
    HostID: hostId,
    Status: 'active',
    $or: [
      { SpaceID: spaceId },
      { BranchID: branchId, SpaceID: null },
      { BranchID: null, SpaceID: null },
    ],
  })
    .sort({ Priority: 1 })
    .lean();

  const startDate = new Date(start);
  const dow = startDate.getUTCDay();
  const hour = startDate.getUTCHours();
  const applied = [];

  for (const r of rules) {
    if (r.DayOfWeek?.length && !r.DayOfWeek.includes(dow)) continue;
    if (r.HourStart != null && r.HourEnd != null) {
      if (hour < r.HourStart || hour >= r.HourEnd) continue;
    }
    if (r.MinHours != null && hours < r.MinHours) continue;
    if (r.Type === 'weekend' && dow !== 0 && dow !== 6) continue;

    unit = unit * (r.Multiplier || 1) + (r.FixedAdjust || 0);
    applied.push({ name: r.Name, type: r.Type, multiplier: r.Multiplier });
  }

  const total = Math.max(0, Math.round(unit * hours));
  return {
    hours,
    pricePerHour: Math.round(unit),
    totalAmount: total,
    depositAmount: Math.round(total * 0.3),
    appliedRules: applied,
  };
}

module.exports = { quotePrice };
