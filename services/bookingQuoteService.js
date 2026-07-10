"use strict";

/**
 * Server-side booking price quote (no booking created).
 * Source of truth for wizard step-3 breakdown.
 */
const Space = require("../models/Space");
const Branch = require("../models/Branch");
const AddOn = require("../models/AddOn");
const pricingService = require("./pricingService");
const { buildPolicySnapshot } = require("./cancellationPolicyService");
const { ValidationError, NotFoundError } = require("../utils/errors");

function parseRange(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ValidationError("startTime/endTime không hợp lệ.");
  }
  if (end <= start) throw new ValidationError("endTime phải sau startTime.");
  return { start, end };
}

/**
 * Build full price breakdown for a space + interval.
 * @param {object} opts
 * @param {string} opts.spaceId
 * @param {string|Date} opts.startTime
 * @param {string|Date} opts.endTime
 * @param {Array<{addOnId?:string,id?:string,quantity?:number}>} [opts.addOns]
 * @param {string} [opts.couponCode]
 * @param {string} [opts.userId] — required for real coupon validation
 */
async function quoteBooking({
  spaceId,
  startTime,
  endTime,
  addOns = [],
  couponCode = null,
  userId = null,
}) {
  if (!spaceId) throw new ValidationError("Thiếu spaceId.");
  const space = await Space.findById(spaceId).lean();
  if (!space || space.Status !== "available") {
    throw new NotFoundError("Không tìm thấy không gian khả dụng.");
  }
  const branch = await Branch.findById(space.BranchID)
    .select("Name DepositPercentage FreeCancelHours OpeningTime ClosingTime")
    .lean();

  const { start, end } = parseRange(startTime, endTime);
  const hours = Math.max(0, (end - start) / 3600000);

  const durationPrices = {
    PricePerHalfDay: space.PricePerHalfDay,
    PricePerDay: space.PricePerDay,
    PricePerWeek: space.PricePerWeek,
    PricePerMonth: space.PricePerMonth,
  };

  let quote;
  try {
    quote = await pricingService.quotePrice({
      hostId: space.HostID,
      spaceId: space._id,
      branchId: space.BranchID,
      start,
      end,
      basePricePerHour: space.PricePerHour || 0,
      durationPrices,
    });
  } catch {
    const total = Math.round(hours * (space.PricePerHour || 0));
    quote = {
      hours,
      pricePerHour: space.PricePerHour || 0,
      totalAmount: total,
      depositAmount: Math.round(total * 0.3),
      appliedRules: [],
      durationTier: "hourly",
    };
  }

  const baseAmount = quote.totalAmount;
  const appliedRules = quote.appliedRules || [];

  // Add-ons (server-priced, same logic as createBooking)
  const addOnLines = [];
  let addOnsTotal = 0;
  if (Array.isArray(addOns) && addOns.length) {
    for (const item of addOns.slice(0, 20)) {
      const id = item.addOnId || item.id;
      if (!id) continue;
      const doc = await AddOn.findOne({
        _id: id,
        HostID: space.HostID,
        Status: "active",
      }).lean();
      if (!doc) continue;
      const qty = Math.max(
        1,
        Math.min(99, Math.round(Number(item.quantity) || 1)),
      );
      if (doc.Inventory != null && qty > doc.Inventory) {
        throw new ValidationError(`Add-on "${doc.Name}" không đủ tồn kho.`);
      }
      const unit = doc.Price || 0;
      let line = unit * qty;
      if (doc.Unit === "hour") line = unit * qty * hours;
      if (doc.Unit === "person") line = unit * qty;
      line = Math.round(line);
      addOnLines.push({
        addOnId: String(doc._id),
        name: doc.Name,
        unit: doc.Unit || "item",
        unitPrice: unit,
        quantity: qty,
        lineTotal: line,
      });
      addOnsTotal += line;
    }
  }

  let subtotal = Math.round(baseAmount + addOnsTotal);
  let discountAmount = 0;
  let coupon = null;

  if (couponCode && userId) {
    try {
      const couponService = require("./couponService");
      const result = await couponService.validateCoupon({
        code: couponCode,
        userId,
        orderAmount: subtotal,
        branchId: space.BranchID,
        hostId: space.HostID,
      });
      discountAmount = result.discountAmount || 0;
      coupon = {
        code: result.coupon?.Code || String(couponCode).toUpperCase(),
        type: result.coupon?.Type,
        value: result.coupon?.Value,
      };
    } catch (err) {
      if (err.statusCode) {
        return {
          ok: false,
          error: err.message,
          code: err.code || "COUPON_INVALID",
        };
      }
      throw err;
    }
  } else if (couponCode && !userId) {
    // Guest: coupon applied only after login — flag estimate unavailable
    coupon = { code: String(couponCode).toUpperCase(), pendingLogin: true };
  }

  const totalAmount = Math.max(0, Math.round(subtotal - discountAmount));
  const depositPct =
    branch?.DepositPercentage != null ? Number(branch.DepositPercentage) : 0.3;
  const depositAmount =
    space.DepositAmount > 0
      ? Math.min(space.DepositAmount, totalAmount)
      : Math.round(totalAmount * depositPct);

  const freeCancelHours =
    space.FreeCancelHours != null
      ? space.FreeCancelHours
      : branch?.FreeCancelHours != null
        ? branch.FreeCancelHours
        : 24;
  const policy = buildPolicySnapshot({ freeCancelHours });

  const durationLabel = quote.durationLabel || "Theo giờ";
  const lines = [
    {
      key: "base",
      label:
        quote.durationTier && quote.durationTier !== "hourly"
          ? `${durationLabel} (${hours.toFixed(hours % 1 ? 1 : 0)}h)`
          : `Thuê ${hours.toFixed(hours % 1 ? 1 : 0)} giờ × ${Number(quote.pricePerHour).toLocaleString("vi-VN")}đ`,
      amount: baseAmount,
    },
  ];
  for (const a of addOnLines) {
    lines.push({
      key: `addon-${a.addOnId}`,
      label: `${a.name} × ${a.quantity}`,
      amount: a.lineTotal,
    });
  }
  if (discountAmount > 0) {
    lines.push({
      key: "discount",
      label: coupon?.code ? `Giảm giá (${coupon.code})` : "Giảm giá",
      amount: -discountAmount,
    });
  }
  lines.push({
    key: "total",
    label: "Tổng cộng",
    amount: totalAmount,
    emphasize: true,
  });
  lines.push({
    key: "deposit",
    label: "Cọc cần thanh toán",
    amount: depositAmount,
    emphasize: true,
  });

  return {
    ok: true,
    spaceId: String(space._id),
    spaceName: space.Name,
    spaceCode: space.SpaceCode,
    branchId: String(space.BranchID),
    branchName: branch?.Name || "",
    hostId: String(space.HostID),
    instantBook: !!space.InstantBook,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    hours,
    currency: "VND",
    pricePerHour: quote.pricePerHour,
    basePricePerHour: space.PricePerHour || 0,
    durationTier: quote.durationTier || "hourly",
    durationLabel: quote.durationLabel || "Theo giờ",
    packagePrice: quote.packagePrice ?? null,
    baseAmount,
    addOnsTotal,
    addOns: addOnLines,
    discountAmount,
    coupon,
    subtotal,
    totalAmount,
    depositAmount,
    depositPercent: depositPct,
    appliedRules,
    lines,
    policy,
    freeCancelHours,
    remainderAmount: Math.max(0, totalAmount - depositAmount),
  };
}

module.exports = { quoteBooking, parseRange };
