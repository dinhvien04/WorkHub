'use strict';

/**
 * Shared listing detail payload: SEO slug ensure, FAQ, reviews JSON-LD, images.
 */
const Branch = require('../models/Branch');
const Space = require('../models/Space');
const Review = require('../models/Review');
const { slugify, uniqueSlug } = require('../utils/slugify');
const { pictureSources } = require('../utils/imageUrl');
const {
  spaceIdsForBranch,
  ratingBreakdownForSpaces,
} = require('./reviewStatsService');

/**
 * Ensure Slug / CitySlug / DistrictSlug exist (persisted).
 */
async function ensureBranchSeo(branch) {
  if (!branch || !branch._id) return branch;
  const updates = {};
  if (!branch.Slug) {
    updates.Slug = await uniqueSlug(Branch, branch.Name || String(branch._id));
  }
  if (!branch.CitySlug && branch.City) {
    updates.CitySlug = slugify(branch.City);
  }
  if (!branch.DistrictSlug && branch.District) {
    updates.DistrictSlug = slugify(branch.District);
  }
  if (Object.keys(updates).length) {
    await Branch.updateOne({ _id: branch._id }, { $set: updates });
    Object.assign(branch, updates);
  }
  return branch;
}

function seoPathForBranch(branch) {
  if (!branch || !branch.Slug) return `/detail?branchId=${branch && branch._id}`;
  const city = branch.CitySlug || slugify(branch.City) || 'viet-nam';
  const dist = branch.DistrictSlug || slugify(branch.District) || 'khu-vuc';
  return `/khong-gian/${city}/${dist}/${branch.Slug}`;
}

/**
 * FAQ generated only from real branch/space facts (no fabricated claims).
 */
function buildBranchFaq(branch, spaces, breakdown) {
  const faq = [];
  if (branch.OpeningTime && branch.ClosingTime) {
    faq.push({
      question: `${branch.Name} mở cửa lúc mấy giờ?`,
      answer: `Cơ sở hoạt động từ ${branch.OpeningTime} đến ${branch.ClosingTime} (múi giờ ${branch.Timezone || 'Asia/Ho_Chi_Minh'}).`,
    });
  }
  if (branch.Address) {
    faq.push({
      question: `Địa chỉ ${branch.Name} ở đâu?`,
      answer: `${branch.Address}${branch.District ? `, ${branch.District}` : ''}${branch.City ? `, ${branch.City}` : ''}.`,
    });
  }
  const priced = (spaces || []).filter((s) => s.PricePerHour > 0);
  if (priced.length) {
    const min = Math.min(...priced.map((s) => s.PricePerHour));
    faq.push({
      question: `Giá thuê tại ${branch.Name} bao nhiêu?`,
      answer: `Giá từ ${min.toLocaleString('vi-VN')}đ/giờ tùy loại không gian. Xem từng phòng để biết giá chính xác.`,
    });
  }
  const instant = (spaces || []).some((s) => s.InstantBook);
  faq.push({
    question: `Đặt chỗ tại ${branch.Name} có xác nhận ngay không?`,
    answer: instant
      ? 'Một số không gian hỗ trợ instant book (xác nhận ngay). Các không gian khác cần host xác nhận.'
      : 'Đặt chỗ hiện cần host xác nhận. Bạn sẽ nhận thông báo khi đơn được duyệt.',
  });
  if (branch.DepositPercentage != null) {
    const pct = Math.round(Number(branch.DepositPercentage) * 100);
    faq.push({
      question: 'Chính sách đặt cọc như thế nào?',
      answer: `Tỷ lệ cọc mặc định của cơ sở là khoảng ${pct}% giá trị đơn (chi tiết theo từng không gian khi thanh toán).`,
    });
  }
  if (breakdown && breakdown.total > 0) {
    faq.push({
      question: `Đánh giá của khách về ${branch.Name}?`,
      answer: `Hiện có ${breakdown.total} đánh giá, điểm trung bình ${breakdown.average}/5 sao.`,
    });
  }
  return faq;
}

function faqJsonLd(faq) {
  if (!faq || !faq.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

async function loadRecentReviews(spaceIds, limit = 5) {
  if (!spaceIds.length) return [];
  return Review.find({
    SpaceID: { $in: spaceIds },
    Status: { $in: ['published', 'reported'] },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('CustomerID', 'FullName')
    .lean();
}

function reviewJsonLdBlocks(reviews, branchName) {
  return (reviews || [])
    .filter((r) => r.Rating && r.Comment)
    .slice(0, 5)
    .map((r) => ({
      '@context': 'https://schema.org',
      '@type': 'Review',
      itemReviewed: {
        '@type': 'LocalBusiness',
        name: branchName,
      },
      author: {
        '@type': 'Person',
        name: r.CustomerID?.FullName || 'Khách WorkHub',
      },
      datePublished: r.createdAt
        ? new Date(r.createdAt).toISOString().slice(0, 10)
        : undefined,
      reviewBody: String(r.Comment || '').slice(0, 500),
      reviewRating: {
        '@type': 'Rating',
        ratingValue: r.Rating,
        bestRating: 5,
        worstRating: 1,
      },
    }));
}

/**
 * Full detail view model + jsonLd list.
 */
async function buildDetailViewModel(branch, { req, spaces: preloadedSpaces } = {}) {
  await ensureBranchSeo(branch);
  const spaces =
    preloadedSpaces ||
    (await Space.find({ BranchID: branch._id, Status: 'available' })
      .sort({ Category: 1, Name: 1 })
      .lean());

  const spaceIds = await spaceIdsForBranch(branch._id);
  const breakdown = await ratingBreakdownForSpaces(spaceIds);
  const recentReviews = await loadRecentReviews(spaceIds, 5);
  const faq = buildBranchFaq(branch, spaces, breakdown);
  const seoPath = seoPathForBranch(branch);

  const images = (branch.Images || []).filter(Boolean);
  const gallery = images.map((url, i) => ({
    ...pictureSources(url, {
      widths: i === 0 ? [640, 960, 1280] : [160, 320],
      sizes: i === 0 ? '(max-width: 768px) 100vw, 800px' : '112px',
      h: i === 0 ? 600 : 160,
    }),
    alt: `${branch.Name} — ảnh ${i + 1}`,
  }));

  const base =
    req && req.protocol && req.get
      ? `${req.protocol}://${req.get('host')}`
      : '';
  const minPrice = spaces.length
    ? Math.min(...spaces.map((s) => s.PricePerHour || 0).filter(Boolean))
    : undefined;

  const title = branch.MetaTitle || `${branch.Name} — WorkHub`;
  const desc =
    branch.MetaDescription ||
    `${branch.Name} · ${branch.Address || ''} · Đặt chỗ co-working trên WorkHub`.slice(0, 160);

  const localBusiness = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: branch.Name,
    description: desc,
    address: {
      '@type': 'PostalAddress',
      streetAddress: branch.Address || '',
      addressLocality: branch.District || branch.City || '',
      addressRegion: branch.City || '',
      addressCountry: 'VN',
    },
    image: images[0] || undefined,
    url: base ? `${base}${seoPath}` : seoPath,
    priceRange: minPrice ? `Từ ${minPrice.toLocaleString('vi-VN')}đ/giờ` : undefined,
    geo:
      branch.Latitude != null && branch.Longitude != null
        ? {
            '@type': 'GeoCoordinates',
            latitude: branch.Latitude,
            longitude: branch.Longitude,
          }
        : undefined,
    openingHours:
      branch.OpeningTime && branch.ClosingTime
        ? `Mo-Su ${branch.OpeningTime}-${branch.ClosingTime}`
        : undefined,
    aggregateRating:
      breakdown.total > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: breakdown.average,
            reviewCount: breakdown.total,
            bestRating: 5,
            worstRating: 1,
          }
        : undefined,
  };

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Trang chủ', item: base ? `${base}/` : '/' },
      {
        '@type': 'ListItem',
        position: 2,
        name: branch.City || 'Thành phố',
        item: base
          ? `${base}/khong-gian/${branch.CitySlug || 'viet-nam'}`
          : `/khong-gian/${branch.CitySlug || 'viet-nam'}`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: branch.Name,
        item: base ? `${base}${seoPath}` : seoPath,
      },
    ],
  };

  const jsonLd = [localBusiness, breadcrumb];
  const faqLd = faqJsonLd(faq);
  if (faqLd) jsonLd.push(faqLd);
  jsonLd.push(...reviewJsonLdBlocks(recentReviews, branch.Name));

  // Expose real rating on branch for template
  branch.RatingAvg = breakdown.total ? breakdown.average : branch.RatingAvg || 0;
  branch.RatingCount = breakdown.total;

  // Aggregate amenities + policies from spaces (above-the-fold)
  const amenitySet = new Set();
  let hasInstant = false;
  let freeCancelHours = null;
  for (const s of spaces) {
    if (Array.isArray(s.Amenities)) s.Amenities.forEach((a) => a && amenitySet.add(String(a)));
    if (s.InstantBook) hasInstant = true;
    if (s.FreeCancelHours != null) {
      freeCancelHours =
        freeCancelHours == null
          ? s.FreeCancelHours
          : Math.max(freeCancelHours, s.FreeCancelHours);
    }
  }
  if (freeCancelHours == null) freeCancelHours = 24;
  const amenities = Array.from(amenitySet).slice(0, 24);
  const policies = {
    freeCancelHours,
    freeCancelSummary: `Hủy miễn phí trước ${freeCancelHours}h so với giờ bắt đầu (theo từng phòng).`,
    depositPercent:
      branch.DepositPercentage != null ? Math.round(Number(branch.DepositPercentage) * 100) : 30,
    instantBook: hasInstant,
    bookingModes: hasInstant
      ? 'Có phòng instant book; một số phòng cần host xác nhận.'
      : 'Đặt chỗ cần host xác nhận.',
  };

  return {
    branch,
    spaces,
    gallery,
    faq,
    breakdown,
    seoPath,
    pageTitle: title,
    metaDescription: desc,
    canonicalPath: seoPath,
    minPrice,
    jsonLd,
    ogImage: images[0] || '',
    amenities,
    policies,
  };
}

module.exports = {
  ensureBranchSeo,
  seoPathForBranch,
  buildBranchFaq,
  buildDetailViewModel,
  faqJsonLd,
};
