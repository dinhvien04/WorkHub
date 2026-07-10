"use strict";

/**
 * Rating breakdown + branch review listing helpers.
 */
const mongoose = require("mongoose");
const Review = require("../models/Review");
const Space = require("../models/Space");

const EMPTY_BREAKDOWN = {
  total: 0,
  average: 0,
  counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  percentages: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};

/**
 * Aggregate star counts for a set of space IDs (published reviews only).
 */
async function ratingBreakdownForSpaces(spaceIds) {
  if (!spaceIds || spaceIds.length === 0) {
    return {
      ...EMPTY_BREAKDOWN,
      counts: { ...EMPTY_BREAKDOWN.counts },
      percentages: { ...EMPTY_BREAKDOWN.percentages },
    };
  }
  const ids = spaceIds.map((id) =>
    id instanceof mongoose.Types.ObjectId
      ? id
      : new mongoose.Types.ObjectId(String(id)),
  );

  const rows = await Review.aggregate([
    {
      $match: {
        SpaceID: { $in: ids },
        Status: { $in: ["published", "reported"] },
      },
    },
    {
      $group: {
        _id: "$Rating",
        count: { $sum: 1 },
        sum: { $sum: "$Rating" },
      },
    },
  ]);

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let sum = 0;
  for (const r of rows) {
    const star = Number(r._id);
    if (star >= 1 && star <= 5) {
      counts[star] = r.count;
      total += r.count;
      sum += r.sum;
    }
  }
  const average = total ? Math.round((sum / total) * 10) / 10 : 0;
  const percentages = {};
  for (let s = 1; s <= 5; s++) {
    percentages[s] = total ? Math.round((counts[s] / total) * 1000) / 10 : 0;
  }
  return { total, average, counts, percentages };
}

async function spaceIdsForBranch(branchId) {
  const spaces = await Space.find({ BranchID: branchId }).select("_id").lean();
  return spaces.map((s) => s._id);
}

async function spaceIdsForHost(hostId) {
  const spaces = await Space.find({ HostID: hostId }).select("_id").lean();
  return spaces.map((s) => s._id);
}

/**
 * Full branch reviews payload with breakdown.
 */
async function getBranchReviewsPayload(
  branchId,
  { limit = 50, skip = 0 } = {},
) {
  const spaceIds = await spaceIdsForBranch(branchId);
  if (spaceIds.length === 0) {
    return {
      reviews: [],
      breakdown: {
        ...EMPTY_BREAKDOWN,
        counts: { ...EMPTY_BREAKDOWN.counts },
        percentages: { ...EMPTY_BREAKDOWN.percentages },
      },
    };
  }

  const [breakdown, reviews] = await Promise.all([
    ratingBreakdownForSpaces(spaceIds),
    Review.find({
      SpaceID: { $in: spaceIds },
      Status: { $in: ["published", "reported"] },
    })
      .sort({ createdAt: -1 })
      .skip(Math.max(0, Number(skip) || 0))
      .limit(Math.min(100, Math.max(1, Number(limit) || 50)))
      .populate("CustomerID", "FullName fullName Avatar avatarUrl")
      .lean(),
  ]);

  const formatted = reviews.map((r) => ({
    _id: r._id,
    spaceId: r.SpaceID,
    customerId: r.CustomerID?._id,
    customerName: r.CustomerID?.FullName || r.CustomerID?.fullName || "",
    customerAvatar: r.CustomerID?.Avatar || r.CustomerID?.avatarUrl || "",
    rating: r.Rating,
    comment: r.Comment,
    hostReply: r.HostReply || "",
    hostRepliedAt: r.HostRepliedAt || null,
    status: r.Status,
    createdAt: r.createdAt,
  }));

  return { reviews: formatted, breakdown };
}

module.exports = {
  ratingBreakdownForSpaces,
  spaceIdsForBranch,
  spaceIdsForHost,
  getBranchReviewsPayload,
  EMPTY_BREAKDOWN,
};
