"use strict";

const Booking = require("../models/Booking");

/**
 * Build HostID + optional SpaceID filter for staff branch scope.
 * allowedSpaceIds:
 *   null/undefined = all spaces (owner / AllBranches)
 *   [] = deny all
 *   [ids] = only those spaces
 */
function baseHostFilter(hostId, spaceFilter = null) {
  const base = { HostID: hostId };
  if (spaceFilter && spaceFilter.SpaceID) {
    Object.assign(base, spaceFilter);
  } else if (Array.isArray(spaceFilter) && spaceFilter.length === 0) {
    // Explicit deny-all
    base._id = { $in: [] };
  } else if (
    spaceFilter &&
    Array.isArray(spaceFilter.spaceIds) &&
    spaceFilter.spaceIds.length === 0
  ) {
    base._id = { $in: [] };
  }
  return base;
}

async function hostInboxCounts(hostId, spaceFilter = null) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const soon = new Date(now.getTime() + 2 * 3600000);
  const base = baseHostFilter(hostId, spaceFilter);

  const [
    newCount,
    awaitingPayment,
    today,
    inUse,
    endingSoon,
    completed,
    cancelled,
  ] = await Promise.all([
    Booking.countDocuments({
      ...base,
      Status: { $in: ["pending", "hold", "awaiting_payment"] },
    }),
    Booking.countDocuments({
      ...base,
      Status: { $in: ["awaiting_payment", "payment_under_review"] },
    }),
    Booking.countDocuments({
      ...base,
      StartTime: { $lte: endOfDay },
      EndTime: { $gte: startOfDay },
      Status: {
        $in: ["confirmed", "in-use", "pending", "payment_under_review"],
      },
    }),
    Booking.countDocuments({ ...base, Status: "in-use" }),
    Booking.countDocuments({
      ...base,
      Status: "in-use",
      EndTime: { $gte: now, $lte: soon },
    }),
    Booking.countDocuments({ ...base, Status: "completed" }),
    Booking.countDocuments({
      ...base,
      Status: { $in: ["cancelled", "rejected", "expired"] },
    }),
  ]);

  return {
    new: newCount,
    awaiting_payment: awaitingPayment,
    today,
    in_use: inUse,
    ending_soon: endingSoon,
    completed,
    cancelled,
  };
}

function buildFilter(hostId, bucket, spaceFilter = null) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const soon = new Date(now.getTime() + 2 * 3600000);
  const base = baseHostFilter(hostId, spaceFilter);
  const filter = { ...base };

  switch (bucket) {
    case "new":
      filter.Status = { $in: ["pending", "hold", "awaiting_payment"] };
      break;
    case "awaiting_payment":
      filter.Status = { $in: ["awaiting_payment", "payment_under_review"] };
      break;
    case "awaiting_confirmation":
      filter.Status = "pending";
      break;
    case "today":
      filter.StartTime = { $lte: endOfDay };
      filter.EndTime = { $gte: startOfDay };
      filter.Status = {
        $in: ["confirmed", "in-use", "pending", "payment_under_review"],
      };
      break;
    case "in_use":
      filter.Status = "in-use";
      break;
    case "ending_soon":
      filter.Status = "in-use";
      filter.EndTime = { $gte: now, $lte: soon };
      break;
    case "completed":
      filter.Status = "completed";
      break;
    case "cancelled":
      filter.Status = { $in: ["cancelled", "rejected", "expired"] };
      break;
    default:
      break;
  }
  return filter;
}

/**
 * @param {string} hostId
 * @param {{ bucket?, page?, limit?, spaceFilter?, hostContext? }} opts
 * spaceFilter from branchScopedSpaceFilter: null | { SpaceID: { $in: [...] } } | deny via empty $in
 */
async function listHostInbox(hostId, opts = {}) {
  const bucket = opts.bucket || "all";
  const page = Number(opts.page) || 1;
  const limit = Math.min(100, Number(opts.limit) || 30);

  let spaceFilter = opts.spaceFilter || null;
  // Explicit deny-all signal
  if (opts.denyAll === true) {
    spaceFilter = { SpaceID: { $in: [] } };
  }

  const filter = buildFilter(hostId, bucket, spaceFilter);
  const skip = (Math.max(1, page) - 1) * limit;

  const [items, total, counts] = await Promise.all([
    Booking.find(filter)
      .sort({ StartTime: ["completed", "cancelled"].includes(bucket) ? -1 : 1 })
      .skip(skip)
      .limit(limit)
      .populate("CustomerID", "FullName Email")
      .populate("SpaceID", "Name SpaceCode BranchID")
      .lean(),
    Booking.countDocuments(filter),
    hostInboxCounts(hostId, spaceFilter),
  ]);

  return { items, total, page, limit, bucket, counts };
}

module.exports = {
  listHostInbox,
  hostInboxCounts,
  buildFilter,
};
