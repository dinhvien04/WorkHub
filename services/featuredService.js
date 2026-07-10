'use strict';

const Branch = require('../models/Branch');
const Space = require('../models/Space');
const Booking = require('../models/Booking');

/**
 * Featured / popular listings for homepage (real aggregates only).
 */
async function getFeaturedListings({ limit = 8 } = {}) {
  const lim = Math.min(24, Math.max(1, Number(limit) || 8));

  // Popular by confirmed+ booking count (last 90d)
  const since = new Date(Date.now() - 90 * 86400000);
  const popularSpace = await Booking.aggregate([
    {
      $match: {
        createdAt: { $gte: since },
        Status: { $in: ['confirmed', 'in-use', 'completed', 'payment_under_review'] },
      },
    },
    { $group: { _id: '$SpaceID', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 50 },
  ]);

  const spaceIds = popularSpace.map((p) => p._id).filter(Boolean);
  const spaces = spaceIds.length
    ? await Space.find({ _id: { $in: spaceIds }, Status: 'available' })
        .select('BranchID Name PricePerHour InstantBook RatingAvg')
        .lean()
    : [];
  const branchIdsFromPopular = [...new Set(spaces.map((s) => String(s.BranchID)))];

  let featured = [];
  if (branchIdsFromPopular.length) {
    featured = await Branch.find({
      _id: { $in: branchIdsFromPopular },
      Status: 'active',
    })
      .select('Name Address City District Images RatingAvg RatingCount Slug CitySlug DistrictSlug Latitude Longitude')
      .lean();
    // order by popularity
    const order = new Map(branchIdsFromPopular.map((id, i) => [id, i]));
    featured.sort((a, b) => (order.get(String(a._id)) ?? 99) - (order.get(String(b._id)) ?? 99));
  }

  // Fill with top-rated if not enough
  if (featured.length < lim) {
    const more = await Branch.find({
      Status: 'active',
      _id: { $nin: featured.map((b) => b._id) },
    })
      .sort({ RatingAvg: -1, createdAt: -1 })
      .limit(lim - featured.length)
      .select('Name Address City District Images RatingAvg RatingCount Slug CitySlug DistrictSlug Latitude Longitude')
      .lean();
    featured = featured.concat(more);
  }

  featured = featured.slice(0, lim);

  // priceFrom
  const ids = featured.map((b) => b._id);
  const priceSpaces = await Space.find({ BranchID: { $in: ids }, Status: 'available' })
    .select('BranchID PricePerHour InstantBook')
    .lean();
  const minMap = {};
  const instantMap = {};
  for (const s of priceSpaces) {
    const k = String(s.BranchID);
    if (minMap[k] == null || s.PricePerHour < minMap[k]) minMap[k] = s.PricePerHour;
    if (s.InstantBook) instantMap[k] = true;
  }

  return featured.map((b) => ({
    ...b,
    priceFrom: minMap[String(b._id)] ?? null,
    hasInstantBook: !!instantMap[String(b._id)],
  }));
}

async function getNewListings({ limit = 6 } = {}) {
  const lim = Math.min(24, Math.max(1, Number(limit) || 6));
  const items = await Branch.find({ Status: 'active' })
    .sort({ createdAt: -1 })
    .limit(lim)
    .select('Name Address City District Images RatingAvg Slug CitySlug DistrictSlug createdAt')
    .lean();
  return items;
}

module.exports = { getFeaturedListings, getNewListings };
