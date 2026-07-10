'use strict';

/**
 * Public host profile (safe fields only — no bank/tax docs).
 */
const User = require('../models/User');
const HostProfile = require('../models/Host_Profile');
const Branch = require('../models/Branch');
const Space = require('../models/Space');
const { NotFoundError } = require('../utils/errors');
const {
  spaceIdsForHost,
  ratingBreakdownForSpaces,
} = require('./reviewStatsService');

async function getPublicHostProfile(hostId) {
  if (!hostId || !String(hostId).match(/^[a-f\d]{24}$/i)) {
    throw new NotFoundError('Không tìm thấy host.');
  }

  const user = await User.findOne({
    _id: hostId,
    Role: 'host',
    Status: 'active',
  })
    .select('FullName createdAt')
    .lean();
  if (!user) throw new NotFoundError('Không tìm thấy host.');

  const profile = await HostProfile.findOne({ UserID: hostId }).lean();
  if (!profile || !profile.IsVerified) {
    throw new NotFoundError('Host chưa được xác minh công khai.');
  }

  const branches = await Branch.find({
    HostID: hostId,
    Status: 'active',
    $or: [{ PublishStatus: 'published' }, { PublishStatus: { $exists: false } }],
  })
    .select(
      'Name Slug CitySlug DistrictSlug Address City District RatingAvg Images OpeningTime ClosingTime'
    )
    .sort({ RatingAvg: -1 })
    .limit(50)
    .lean();

  const spaceCount = await Space.countDocuments({
    HostID: hostId,
    Status: { $in: ['available', 'maintenance'] },
  });

  const spaceIds = await spaceIdsForHost(hostId);
  const rating = await ratingBreakdownForSpaces(spaceIds);

  // Mask hotline partially for privacy on public page
  const hotline = String(profile.Hotline || '');
  const hotlineMasked =
    hotline.length >= 7
      ? `${hotline.slice(0, 3)}***${hotline.slice(-3)}`
      : hotline
        ? `${hotline.slice(0, 2)}***`
        : '';

  return {
    hostId: String(user._id),
    companyName: profile.CompanyName,
    logo: profile.Logo || '',
    hotlineMasked,
    isVerified: !!profile.IsVerified,
    memberSince: user.createdAt,
    displayName: user.FullName || profile.CompanyName,
    stats: {
      branchCount: branches.length,
      spaceCount,
      ratingAverage: rating.average,
      ratingTotal: rating.total,
      ratingBreakdown: rating,
    },
    branches: branches.map((b) => {
      let detailPath = `/detail?branchId=${b._id}`;
      if (b.Slug && b.CitySlug) {
        const dist = b.DistrictSlug || 'khu-vuc';
        detailPath = `/khong-gian/${b.CitySlug}/${dist}/${b.Slug}`;
      }
      return {
        _id: b._id,
        name: b.Name,
        slug: b.Slug || null,
        address: b.Address,
        city: b.City || '',
        district: b.District || '',
        ratingAvg: b.RatingAvg || 0,
        image: (b.Images && b.Images[0]) || '',
        hours: `${b.OpeningTime || ''}–${b.ClosingTime || ''}`,
        detailPath,
      };
    }),
  };
}

module.exports = { getPublicHostProfile };
