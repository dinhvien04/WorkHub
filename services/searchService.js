'use strict';

const Branch = require('../models/Branch');
const Space = require('../models/Space');
const { safeRegexQuery } = require('../utils/escapeRegex');
const { parsePagination, paginationMeta } = require('../utils/pagination');

/**
 * Advanced public search with filters + pagination (Mongo-side).
 */
async function searchBranches(query = {}) {
  const {
    location,
    city,
    district,
    minPrice,
    maxPrice,
    capacity,
    category,
    amenity,
    ratingMin,
    sort = 'relevance',
  } = query;
  const { page, limit, skip } = parsePagination(query, { page: 1, limit: 20, maxLimit: 50 });

  const filter = { Status: 'active' };
  if (city) filter.CitySlug = String(city).toLowerCase();
  if (district) filter.DistrictSlug = String(district).toLowerCase();
  if (ratingMin) filter.RatingAvg = { $gte: Number(ratingMin) || 0 };

  if (location && String(location).trim()) {
    const rx = safeRegexQuery(location, 100);
    if (rx) {
      filter.$or = [
        { Name: rx },
        { Address: rx },
        { District: rx },
        { City: rx },
      ];
    }
  }

  let sortSpec = { RatingAvg: -1, createdAt: -1 };
  if (sort === 'price_asc' || sort === 'price_desc' || category || capacity || amenity || minPrice || maxPrice) {
    // join via spaces
    const spaceFilter = { Status: 'available' };
    if (category) spaceFilter.Category = category === 'meeting' ? 'meeting_room' : category;
    if (capacity) spaceFilter.Capacity = { $gte: Number(capacity) || 1 };
    if (amenity) spaceFilter.Amenities = amenity;
    if (minPrice || maxPrice) {
      spaceFilter.PricePerHour = {};
      if (minPrice) spaceFilter.PricePerHour.$gte = Number(minPrice);
      if (maxPrice) spaceFilter.PricePerHour.$lte = Number(maxPrice);
    }
    const spaces = await Space.find(spaceFilter).select('BranchID PricePerHour').lean();
    const branchIds = [...new Set(spaces.map((s) => String(s.BranchID)))];
    filter._id = { $in: branchIds };
    if (sort === 'price_asc' || sort === 'price_desc') {
      // attach min price later
    }
  }

  if (sort === 'rating') sortSpec = { RatingAvg: -1 };
  if (sort === 'newest') sortSpec = { createdAt: -1 };

  const [items, total] = await Promise.all([
    Branch.find(filter).sort(sortSpec).skip(skip).limit(limit).lean(),
    Branch.countDocuments(filter),
  ]);

  // min price per branch
  const ids = items.map((b) => b._id);
  const spaces = await Space.find({ BranchID: { $in: ids }, Status: 'available' })
    .select('BranchID PricePerHour')
    .lean();
  const minMap = {};
  spaces.forEach((s) => {
    const k = String(s.BranchID);
    if (minMap[k] == null || s.PricePerHour < minMap[k]) minMap[k] = s.PricePerHour;
  });

  let enriched = items.map((b) => ({
    ...b,
    priceFrom: minMap[String(b._id)] || null,
  }));

  if (sort === 'price_asc') enriched.sort((a, b) => (a.priceFrom || 0) - (b.priceFrom || 0));
  if (sort === 'price_desc') enriched.sort((a, b) => (b.priceFrom || 0) - (a.priceFrom || 0));

  return { items: enriched, pagination: paginationMeta(total, page, limit) };
}

async function autocomplete(q) {
  const rx = safeRegexQuery(q, 50);
  if (!rx) return { suggestions: [] };
  const branches = await Branch.find({
    Status: 'active',
    $or: [{ Name: rx }, { City: rx }, { District: rx }],
  })
    .select('Name City District Slug CitySlug DistrictSlug')
    .limit(10)
    .lean();
  return {
    suggestions: branches.map((b) => ({
      type: 'branch',
      label: b.Name,
      sub: [b.District, b.City].filter(Boolean).join(', '),
      branchId: b._id,
      slug: b.Slug,
      citySlug: b.CitySlug,
      districtSlug: b.DistrictSlug,
    })),
  };
}

module.exports = { searchBranches, autocomplete };
