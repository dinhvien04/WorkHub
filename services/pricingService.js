'use strict';

const PricingRule = require('../models/PricingRule');

/** Duration tier bounds (hours). Longest matching package with a price wins when cheaper. */
const DURATION_TIERS = [
  { key: 'monthly', minHours: 160, field: 'PricePerMonth', label: 'Theo tháng' },
  { key: 'weekly', minHours: 40, field: 'PricePerWeek', label: 'Theo tuần' },
  { key: 'daily', minHours: 8, field: 'PricePerDay', label: 'Theo ngày' },
  { key: 'half_day', minHours: 4, field: 'PricePerHalfDay', label: 'Nửa ngày' },
  { key: 'hourly', minHours: 0, field: null, label: 'Theo giờ' },
];

/**
 * Pick duration package: use the longest tier that hours meet and price is set.
 * Fall back to pure hourly when no package price exists.
 */
function selectDurationPackage(hours, durationPrices = {}, basePricePerHour = 0) {
  const hourlyTotal = Math.max(0, Math.round(basePricePerHour * hours));
  let chosen = {
    tier: 'hourly',
    label: 'Theo giờ',
    packagePrice: null,
    billableHours: hours,
    baseAmount: hourlyTotal,
  };

  for (const tier of DURATION_TIERS) {
    if (tier.key === 'hourly') continue;
    if (hours < tier.minHours) continue;
    const price = durationPrices[tier.field];
    if (price == null || Number(price) <= 0) continue;

    // How many packages needed (ceil)
    const units = Math.max(1, Math.ceil(hours / tier.minHours));
    const packageTotal = Math.round(Number(price) * units);
    // Prefer package when not more expensive than pure hourly (or always when host set package)
    if (packageTotal <= hourlyTotal || hourlyTotal === 0) {
      chosen = {
        tier: tier.key,
        label: tier.label,
        packagePrice: Number(price),
        packageUnits: units,
        billableHours: hours,
        baseAmount: packageTotal,
      };
      break; // longest first (list is longest → shortest)
    }
  }

  return chosen;
}

/**
 * Apply rule multipliers/fixed adjusts to a unit hourly rate.
 * Rules sorted by Priority ascending (lower = higher priority / applied first).
 */
function applyRulesToUnit(unit, hours, startDate, rules) {
  const dow = startDate.getUTCDay();
  const hour = startDate.getUTCHours();
  const applied = [];
  let next = unit;

  const sorted = [...rules].sort((a, b) => (a.Priority ?? 100) - (b.Priority ?? 100));

  for (const r of sorted) {
    if (r.Status && r.Status !== 'active' && r.Status !== 'preview') continue;
    if (r.DayOfWeek?.length && !r.DayOfWeek.includes(dow)) continue;
    if (r.HourStart != null && r.HourEnd != null) {
      if (hour < r.HourStart || hour >= r.HourEnd) continue;
    }
    if (r.MinHours != null && hours < r.MinHours) continue;
    if (r.Type === 'weekend' && dow !== 0 && dow !== 6) continue;
    if (r.Type === 'last_minute') {
      const hoursUntil = (startDate - new Date()) / 3600000;
      if (hoursUntil > 24) continue;
    }

    next = next * (r.Multiplier || 1) + (r.FixedAdjust || 0);
    applied.push({
      name: r.Name,
      type: r.Type,
      multiplier: r.Multiplier,
      fixedAdjust: r.FixedAdjust || 0,
      priority: r.Priority ?? 100,
      status: r.Status || 'active',
    });
  }

  return { unit: next, applied };
}

/**
 * Core quote. durationPrices may include PricePerHalfDay/Day/Week/Month.
 * extraRules: in-memory rules treated as active (for preview).
 * includeDraftIds: also load these draft rule docs as if active.
 */
async function quotePrice({
  hostId,
  spaceId,
  branchId,
  start,
  end,
  basePricePerHour,
  durationPrices = {},
  extraRules = [],
  includeDraftIds = [],
}) {
  const hours = Math.max(0, (new Date(end) - new Date(start)) / 3600000);
  const startDate = new Date(start);

  const pkg = selectDurationPackage(hours, durationPrices, basePricePerHour);

  const query = {
    HostID: hostId,
    $or: [
      { SpaceID: spaceId },
      { BranchID: branchId, SpaceID: null },
      { BranchID: null, SpaceID: null },
    ],
  };

  // Active rules always; optional draft IDs for preview-before-publish
  if (includeDraftIds?.length) {
    query.$and = [
      {
        $or: [
          { Status: 'active' },
          { _id: { $in: includeDraftIds }, Status: 'draft' },
        ],
      },
    ];
  } else {
    query.Status = 'active';
  }

  const dbRules = await PricingRule.find(query).sort({ Priority: 1 }).lean();

  // Mark draft ones as preview for appliedRules display
  const rules = [
    ...dbRules.map((r) =>
      r.Status === 'draft' ? { ...r, Status: 'preview' } : r
    ),
    ...extraRules.map((r) => ({ ...r, Status: r.Status || 'preview' })),
  ];

  // For package tiers, apply rules as a factor on package total via effective hourly
  let unit = basePricePerHour;
  const { unit: adjustedUnit, applied } = applyRulesToUnit(unit, hours, startDate, rules);
  unit = adjustedUnit;

  let totalAmount;
  let pricePerHour;
  if (pkg.tier === 'hourly' || !pkg.packagePrice) {
    totalAmount = Math.max(0, Math.round(unit * hours));
    pricePerHour = Math.round(unit);
  } else {
    // Scale package by same ratio as hourly adjustment
    const ratio = basePricePerHour > 0 ? unit / basePricePerHour : 1;
    totalAmount = Math.max(0, Math.round(pkg.baseAmount * ratio));
    pricePerHour = hours > 0 ? Math.round(totalAmount / hours) : Math.round(unit);
  }

  return {
    hours,
    pricePerHour,
    totalAmount,
    depositAmount: Math.round(totalAmount * 0.3),
    appliedRules: applied,
    durationTier: pkg.tier,
    durationLabel: pkg.label,
    packagePrice: pkg.packagePrice,
    packageUnits: pkg.packageUnits || 1,
  };
}

/**
 * Preview a draft rule (or unsaved payload) against a booking window.
 * Compares quote without rule vs with rule applied.
 */
async function previewPricingRule({
  hostId,
  spaceId,
  branchId,
  start,
  end,
  basePricePerHour,
  durationPrices = {},
  rule, // { name, type, multiplier, ... } or existing draft rule id
  draftRuleId = null,
}) {
  const without = await quotePrice({
    hostId,
    spaceId,
    branchId,
    start,
    end,
    basePricePerHour,
    durationPrices,
  });

  let extraRules = [];
  let includeDraftIds = [];
  if (draftRuleId) {
    includeDraftIds = [draftRuleId];
  } else if (rule) {
    extraRules = [
      {
        Name: rule.name || rule.Name || 'Preview',
        Type: rule.type || rule.Type || 'peak_hour',
        Multiplier: Number(rule.multiplier ?? rule.Multiplier ?? 1),
        FixedAdjust: Number(rule.fixedAdjust ?? rule.FixedAdjust ?? 0),
        Priority: Number(rule.priority ?? rule.Priority ?? 100),
        DayOfWeek: rule.dayOfWeek || rule.DayOfWeek || [],
        HourStart: rule.hourStart ?? rule.HourStart ?? null,
        HourEnd: rule.hourEnd ?? rule.HourEnd ?? null,
        MinHours: rule.minHours ?? rule.MinHours ?? null,
        Status: 'preview',
      },
    ];
  }

  const withRule = await quotePrice({
    hostId,
    spaceId,
    branchId,
    start,
    end,
    basePricePerHour,
    durationPrices,
    extraRules,
    includeDraftIds,
  });

  return {
    withoutRule: without,
    withRule,
    delta: withRule.totalAmount - without.totalAmount,
    deltaPercent:
      without.totalAmount > 0
        ? Math.round(((withRule.totalAmount - without.totalAmount) / without.totalAmount) * 10000) / 100
        : 0,
  };
}

/**
 * Publish (activate) a draft pricing rule owned by host.
 */
async function publishPricingRule({ hostId, ruleId }) {
  const rule = await PricingRule.findOne({ _id: ruleId, HostID: hostId });
  if (!rule) {
    const { NotFoundError } = require('../utils/errors');
    throw new NotFoundError('Không tìm thấy pricing rule.');
  }
  if (rule.Status === 'active') return rule;
  rule.Status = 'active';
  await rule.save();
  return rule;
}

module.exports = {
  quotePrice,
  previewPricingRule,
  publishPricingRule,
  selectDurationPackage,
  DURATION_TIERS,
};
