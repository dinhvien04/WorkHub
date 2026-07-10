'use strict';

const Branch = require('../models/Branch');
const Space = require('../models/Space');
const { safeRegexQuery } = require('../utils/escapeRegex');
const { parsePagination, paginationMeta } = require('../utils/pagination');

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Advanced public search with filters + pagination.
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
    lat,
    lng,
    radiusKm,
  } = query;
  const { page, limit, skip } = parsePagination(query, { page: 1, limit: 20, maxLimit: 50 });

  const filter = { Status: 'active' };
  if (city) filter.CitySlug = String(city).toLowerCase();
  if (district) filter.DistrictSlug = String(district).toLowerCase();
  if (ratingMin) filter.RatingAvg = { $gte: Number(ratingMin) || 0 };

  if (location && String(location).trim()) {
    const rx = safeRegexQuery(location, 100);
    if (rx) {
      filter.$or = [{ Name: rx }, { Address: rx }, { District: rx }, { City: rx }];
    }
  }

  const userLat = lat != null && lat !== '' ? Number(lat) : null;
  const userLng = lng != null && lng !== '' ? Number(lng) : null;
  const radius = radiusKm != null && radiusKm !== '' ? Number(radiusKm) : null;
  const hasGeo = Number.isFinite(userLat) && Number.isFinite(userLng);
  const useNear =
    hasGeo && (sort === 'near' || (Number.isFinite(radius) && radius > 0));

  let spaceBranchIds = null;
  if (category || capacity || amenity || minPrice || maxPrice || sort === 'price_asc' || sort === 'price_desc') {
    const spaceFilter = { Status: 'available' };
    if (category) spaceFilter.Category = category === 'meeting' ? 'meeting_room' : category;
    if (capacity) spaceFilter.Capacity = { $gte: Number(capacity) || 1 };
    if (amenity) spaceFilter.Amenities = amenity;
    if (minPrice || maxPrice) {
      spaceFilter.PricePerHour = {};
      if (minPrice) spaceFilter.PricePerHour.$gte = Number(minPrice);
      if (maxPrice) spaceFilter.PricePerHour.$lte = Number(maxPrice);
    }
    const spaces = await Space.find(spaceFilter).select('BranchID').lean();
    spaceBranchIds = [...new Set(spaces.map((s) => String(s.BranchID)))];
    if (!useNear) {
      filter._id = { $in: spaceBranchIds };
    }
  }

  let sortSpec = { RatingAvg: -1, createdAt: -1 };
  if (sort === 'rating') sortSpec = { RatingAvg: -1 };
  if (sort === 'newest') sortSpec = { createdAt: -1 };

  let items;
  let total;

  if (useNear) {
    // Haversine in-app (works without 2dsphere index readiness in all envs)
    const batch = await Branch.find({
      ...filter,
      Latitude: { $ne: null },
      Longitude: { $ne: null },
    })
      .limit(400)
      .lean();
    let list = batch.map((b) => ({
      ...b,
      distanceKm:
        Math.round(haversineKm(userLat, userLng, b.Latitude, b.Longitude) * 100) / 100,
    }));
    if (Number.isFinite(radius) && radius > 0) {
      list = list.filter((b) => b.distanceKm <= radius);
    }
    if (spaceBranchIds) {
      const set = new Set(spaceBranchIds);
      list = list.filter((b) => set.has(String(b._id)));
    }
    list.sort((a, b) => a.distanceKm - b.distanceKm);
    total = list.length;
    items = list.slice(skip, skip + limit);
  } else {
    [items, total] = await Promise.all([
      Branch.find(filter).sort(sortSpec).skip(skip).limit(limit).lean(),
      Branch.countDocuments(filter),
    ]);
  }

  const ids = items.map((b) => b._id);
  const spaces = await Space.find({ BranchID: { $in: ids }, Status: 'available' })
    .select('BranchID PricePerHour')
    .lean();
  const minMap = {};
  spaces.forEach((s) => {
    const k = String(s.BranchID);
    if (minMap[k] == null || s.PricePerHour < minMap[k]) minMap[k] = s.PricePerHour;
  });

  let enriched = items.map((b) => {
    const row = {
      ...b,
      priceFrom: minMap[String(b._id)] ?? null,
    };
    if (hasGeo && b.Latitude != null && b.Longitude != null && row.distanceKm == null) {
      row.distanceKm =
        Math.round(haversineKm(userLat, userLng, b.Latitude, b.Longitude) * 100) / 100;
    }
    return row;
  });

  if (sort === 'price_asc') enriched.sort((a, b) => (a.priceFrom || 0) - (b.priceFrom || 0));
  if (sort === 'price_desc') enriched.sort((a, b) => (b.priceFrom || 0) - (a.priceFrom || 0));
  if (sort === 'near' && hasGeo) {
    enriched.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
  }

  const result = {
    items: enriched,
    pagination: paginationMeta(total, page, limit),
  };

  if (!enriched.length) {
    result.zeroResult = await buildZeroResultSuggestions(query);
  }

  return result;
}

async function buildZeroResultSuggestions(query = {}) {
  const tips = [
    'Thử xóa bớt bộ lọc (giá, sức chứa, tiện nghi).',
    'Mở rộng khung giờ hoặc chọn ngày khác.',
    'Tìm theo thành phố/quận thay vì từ khóa quá cụ thể.',
  ];
  if (query.radiusKm) tips.push('Tăng bán kính tìm kiếm (radiusKm).');
  if (query.minPrice || query.maxPrice) tips.push('Nới khoảng giá.');

  const popularCities = await Branch.aggregate([
    { $match: { Status: 'active', CitySlug: { $exists: true, $nin: [null, ''] } } },
    { $group: { _id: '$CitySlug', count: { $sum: 1 }, city: { $first: '$City' } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]);

  const nearbyDistricts = [];
  if (query.city) {
    const districts = await Branch.aggregate([
      { $match: { Status: 'active', CitySlug: String(query.city).toLowerCase() } },
      { $group: { _id: '$DistrictSlug', n: { $sum: 1 }, name: { $first: '$District' } } },
      { $sort: { n: -1 } },
      { $limit: 5 },
    ]);
    nearbyDistricts.push(
      ...districts
        .filter((d) => d._id)
        .map((d) => ({
          type: 'district',
          label: d.name || d._id,
          citySlug: String(query.city).toLowerCase(),
          districtSlug: d._id,
        }))
    );
  }

  return {
    tips,
    popularCities: popularCities.map((c) => ({
      citySlug: c._id,
      label: c.city || c._id,
      count: c.count,
    })),
    nearbyDistricts,
    suggestedActions: [
      { action: 'clear_filters', label: 'Xóa bộ lọc' },
      { action: 'expand_radius', label: 'Mở rộng bán kính' },
      { action: 'browse_all', label: 'Xem tất cả không gian', href: '/khong-gian' },
    ],
  };
}

async function autocomplete(q) {
  const rx = safeRegexQuery(q, 50);
  if (!rx) return { suggestions: [] };
  const branches = await Branch.find({
    Status: 'active',
    $or: [{ Name: rx }, { City: rx }, { District: rx }],
  })
    .select('Name City District Slug CitySlug DistrictSlug Latitude Longitude')
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

module.exports = {
  searchBranches,
  autocomplete,
  buildZeroResultSuggestions,
  haversineKm,
};
