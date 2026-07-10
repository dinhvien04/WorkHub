'use strict';

const express = require('express');
const Branch = require('../models/Branch');
const Space = require('../models/Space');
const CmsPage = require('../models/CmsPage');
const SeoRedirect = require('../models/SeoRedirect');
const { slugify } = require('../utils/slugify');

const router = express.Router();

// SEO redirects (DB-driven 301/302)
router.use(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  try {
    const hit = await SeoRedirect.findOne({ FromPath: req.path, Active: true }).lean();
    if (hit) return res.redirect(hit.StatusCode || 301, hit.ToPath);
  } catch {
    /* ignore */
  }
  return next();
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /admin/',
      'Disallow: /host/',
      'Disallow: /login',
      'Disallow: /register',
      'Disallow: /payment',
      'Disallow: /history',
      'Disallow: /profile',
      'Disallow: /security',
      `Sitemap: ${req.protocol}://${req.get('host')}/sitemap_index.xml`,
      `Sitemap: ${req.protocol}://${req.get('host')}/sitemap.xml`,
      '',
    ].join('\n')
  );
});

router.get('/sitemap_index.xml', async (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const now = new Date().toISOString();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<sitemap><loc>${base}/sitemap.xml</loc><lastmod>${now}</lastmod></sitemap>`,
    `<sitemap><loc>${base}/sitemap-cities.xml</loc><lastmod>${now}</lastmod></sitemap>`,
    `<sitemap><loc>${base}/sitemap-guides.xml</loc><lastmod>${now}</lastmod></sitemap>`,
    '</sitemapindex>',
  ].join('');
  res.type('application/xml').send(xml);
});

router.get('/sitemap.xml', async (req, res) => {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const branches = await Branch.find({ Status: 'active' })
      .select('Slug CitySlug DistrictSlug updatedAt Name City District')
      .lean();

    const urls = [
      { loc: `${base}/`, priority: '1.0' },
      { loc: `${base}/search`, priority: '0.9' },
      { loc: `${base}/khong-gian`, priority: '0.9' },
      { loc: `${base}/membership`, priority: '0.5' },
      { loc: `${base}/compare`, priority: '0.4' },
    ];

    for (const b of branches) {
      const city = b.CitySlug || slugify(b.City) || 'viet-nam';
      const district = b.DistrictSlug || slugify(b.District) || 'khu-vuc';
      const slug = b.Slug || slugify(b.Name) || String(b._id);
      urls.push({
        loc: `${base}/khong-gian/${city}/${district}/${slug}`,
        lastmod: b.updatedAt ? new Date(b.updatedAt).toISOString() : undefined,
        priority: '0.8',
      });
    }

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map(
        (u) =>
          `<url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`
      ),
      '</urlset>',
    ].join('');

    res.type('application/xml').send(xml);
  } catch (e) {
    res.status(500).type('text/plain').send('sitemap error');
  }
});

router.get('/sitemap-cities.xml', async (req, res) => {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const cities = await Branch.aggregate([
      { $match: { Status: 'active', CitySlug: { $exists: true, $nin: [null, ''] } } },
      { $group: { _id: '$CitySlug', districts: { $addToSet: '$DistrictSlug' } } },
    ]);
    const urls = [];
    for (const c of cities) {
      if (!c._id) continue;
      urls.push({ loc: `${base}/khong-gian/${c._id}`, priority: '0.7' });
      for (const d of c.districts || []) {
        if (d) urls.push({ loc: `${base}/khong-gian/${c._id}/${d}`, priority: '0.65' });
      }
    }
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map((u) => `<url><loc>${escapeXml(u.loc)}</loc><priority>${u.priority}</priority></url>`),
      '</urlset>',
    ].join('');
    res.type('application/xml').send(xml);
  } catch {
    res.status(500).type('text/plain').send('sitemap error');
  }
});

router.get('/sitemap-guides.xml', async (req, res) => {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const pages = await CmsPage.find({ Status: 'published' }).select('Slug updatedAt').lean();
    const urls = pages.map((p) => ({
      loc: `${base}/huong-dan/${p.Slug}`,
      lastmod: p.updatedAt ? new Date(p.updatedAt).toISOString() : undefined,
      priority: '0.6',
    }));
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map(
        (u) =>
          `<url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`
      ),
      '</urlset>',
    ].join('');
    res.type('application/xml').send(xml);
  } catch {
    res.status(500).type('text/plain').send('sitemap error');
  }
});

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CITY_BLURBS = {
  'ho-chi-minh':
    'Khám phá không gian co-working và phòng họp tại TP. Hồ Chí Minh — quận 1, 3, Bình Thạnh, Thủ Đức và nhiều khu vực khác. So sánh giá, tiện nghi và đặt chỗ linh hoạt theo giờ.',
  'ha-noi':
    'Tìm phòng họp, hot desk và private office tại Hà Nội. Lọc theo quận, sức chứa và giá; xem lịch trống realtime trước khi đặt.',
  'da-nang':
    'Không gian làm việc linh hoạt tại Đà Nẵng — gần trung tâm và ven biển, phù hợp team remote và meeting ngắn.',
};

async function renderListing(req, res, next, { city, district, slug }) {
  try {
    if (!slug) {
      const filter = { Status: 'active' };
      if (city) filter.CitySlug = city;
      if (district) filter.DistrictSlug = district;
      const branches = await Branch.find(filter).limit(50).lean();

      const cityLabel = (city || '').replace(/-/g, ' ');
      const districtLabel = (district || '').replace(/-/g, ' ');
      const titleParts = ['Không gian co-working'];
      if (districtLabel) titleParts.push(districtLabel);
      if (cityLabel) titleParts.push(cityLabel);
      const pageTitle = titleParts.join(' · ') + ' — WorkHub';

      let blurb =
        CITY_BLURBS[city] ||
        (city
          ? `Danh sách không gian co-working và phòng họp tại ${cityLabel}. Mỗi listing có địa chỉ, giá từ, tiện nghi và lịch trống thật — không thin content.`
          : 'Tất cả không gian co-working trên WorkHub. Lọc theo thành phố, loại phòng và đặt chỗ trong 3 bước.');
      if (district) {
        blurb = `Không gian tại ${districtLabel}${cityLabel ? ', ' + cityLabel : ''}. ${blurb}`;
      }

      const base = `${req.protocol}://${req.get('host')}`;
      const breadcrumb = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Trang chủ', item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: 'Không gian', item: `${base}/khong-gian` },
        ],
      };
      if (city) {
        breadcrumb.itemListElement.push({
          '@type': 'ListItem',
          position: 3,
          name: cityLabel,
          item: `${base}/khong-gian/${city}`,
        });
      }
      if (district) {
        breadcrumb.itemListElement.push({
          '@type': 'ListItem',
          position: 4,
          name: districtLabel,
          item: `${base}/khong-gian/${city}/${district}`,
        });
      }

      return res.render('customer/search', {
        branches,
        keyword: city || '',
        citySlug: city || '',
        districtSlug: district || '',
        listingBlurb: blurb,
        pageTitle,
        metaDescription: blurb.slice(0, 160),
        canonicalPath: req.path,
        jsonLd: breadcrumb,
        scripts: res.locals.scriptsFrom
          ? res.locals.scriptsFrom(['/js/customer-main.js', '/js/search-filters.js'])
          : '',
      });
    }

    let branch = await Branch.findOne({ Slug: slug, Status: 'active' }).lean();
    if (!branch) {
      branch = await Branch.findOne({
        Status: 'active',
        Name: new RegExp(slug.replace(/-/g, ' '), 'i'),
      }).lean();
    }
    if (!branch) {
      return res.status(404).render('customer/search', {
        branches: [],
        keyword: '',
        pageTitle: 'Không tìm thấy',
        scripts: '',
      });
    }

    const spaces = await Space.find({ BranchID: branch._id, Status: 'available' })
      .sort({ Category: 1, Name: 1 })
      .lean();

    const title = branch.MetaTitle || `${branch.Name} — WorkHub`;
    const desc =
      branch.MetaDescription ||
      `${branch.Name} · ${branch.Address || ''} · Đặt chỗ co-working trên WorkHub`.slice(0, 160);

    const base = `${req.protocol}://${req.get('host')}`;
    const minPrice = spaces.length
      ? Math.min(...spaces.map((s) => s.PricePerHour || 0).filter(Boolean))
      : undefined;

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
      image: (branch.Images && branch.Images[0]) || undefined,
      telephone: branch.Phone || undefined,
      url: `${base}${req.path}`,
      priceRange: minPrice ? `Từ ${minPrice.toLocaleString('vi-VN')}đ/giờ` : undefined,
      geo:
        branch.Latitude != null && branch.Longitude != null
          ? {
              '@type': 'GeoCoordinates',
              latitude: branch.Latitude,
              longitude: branch.Longitude,
            }
          : undefined,
      openingHours: branch.OpeningTime && branch.ClosingTime
        ? `Mo-Su ${branch.OpeningTime}-${branch.ClosingTime}`
        : undefined,
      aggregateRating:
        branch.RatingAvg > 0 && branch.RatingCount > 0
          ? {
              '@type': 'AggregateRating',
              ratingValue: branch.RatingAvg,
              reviewCount: branch.RatingCount,
            }
          : undefined,
    };

    const breadcrumb = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Trang chủ', item: `${base}/` },
        {
          '@type': 'ListItem',
          position: 2,
          name: branch.City || 'Thành phố',
          item: `${base}/khong-gian/${branch.CitySlug || city || 'viet-nam'}`,
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: branch.Name,
          item: `${base}${req.path}`,
        },
      ],
    };

    return res.render('customer/detail', {
      branch,
      spaces,
      pageTitle: title,
      metaDescription: desc,
      canonicalPath: req.path,
      jsonLd: [localBusiness, breadcrumb],
      scripts: res.locals.scriptsFrom
        ? res.locals.scriptsFrom(['/js/customer-main.js'])
        : '',
    });
  } catch (e) {
    return next(e);
  }
}

// Express 5 path-to-regexp: separate routes instead of optional params
router.get('/khong-gian', (req, res, next) => renderListing(req, res, next, {}));
router.get('/khong-gian/:city', (req, res, next) =>
  renderListing(req, res, next, { city: req.params.city })
);
router.get('/khong-gian/:city/:district', (req, res, next) =>
  renderListing(req, res, next, { city: req.params.city, district: req.params.district })
);
router.get('/khong-gian/:city/:district/:slug', (req, res, next) =>
  renderListing(req, res, next, {
    city: req.params.city,
    district: req.params.district,
    slug: req.params.slug,
  })
);

module.exports = router;
