'use strict';

const express = require('express');
const Branch = require('../models/Branch');
const Space = require('../models/Space');
const { slugify } = require('../utils/slugify');

const router = express.Router();

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
      `Sitemap: ${req.protocol}://${req.get('host')}/sitemap.xml`,
      '',
    ].join('\n')
  );
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
      // legacy detail still works
      urls.push({
        loc: `${base}/detail?branchId=${b._id}`,
        priority: '0.5',
      });
    }

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map(
        (u) =>
          `<url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`
      ),
      '</urlset>',
    ].join('');

    res.type('application/xml').send(xml);
  } catch (e) {
    res.status(500).type('text/plain').send('sitemap error');
  }
});

async function renderListing(req, res, next, { city, district, slug }) {
  try {
    if (!slug) {
      const filter = { Status: 'active' };
      if (city) filter.CitySlug = city;
      if (district) filter.DistrictSlug = district;
      const branches = await Branch.find(filter).limit(50).lean();
      return res.render('customer/search', {
        branches,
        keyword: city || '',
        pageTitle: city ? `Không gian tại ${city}` : 'Tất cả không gian',
        metaDescription: 'Tìm và đặt chỗ co-working, phòng họp trên WorkHub.',
        scripts: res.locals.scriptsFrom
          ? res.locals.scriptsFrom(['/js/customer-main.js'])
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

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: branch.Name,
      address: branch.Address,
      image: (branch.Images && branch.Images[0]) || undefined,
      url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      aggregateRating:
        branch.RatingAvg > 0
          ? { '@type': 'AggregateRating', ratingValue: branch.RatingAvg, reviewCount: 1 }
          : undefined,
    };

    return res.render('customer/detail', {
      branch,
      spaces,
      pageTitle: title,
      metaDescription: desc,
      canonicalPath: req.path,
      jsonLd,
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
