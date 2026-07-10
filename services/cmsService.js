'use strict';

const CmsPage = require('../models/CmsPage');
const { slugify } = require('../utils/slugify');
const { NotFoundError, ValidationError } = require('../utils/errors');

async function listPublished({ type, citySlug, page = 1, limit = 20 } = {}) {
  const filter = { Status: 'published' };
  if (type) filter.Type = type;
  if (citySlug) filter.CitySlug = citySlug;
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    CmsPage.find(filter).sort({ PublishedAt: -1 }).skip(skip).limit(limit).lean(),
    CmsPage.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

async function getBySlug(slug) {
  const page = await CmsPage.findOne({ Slug: slug, Status: 'published' }).lean();
  if (!page) throw new NotFoundError('Trang không tồn tại.');
  return page;
}

async function upsertPage(data, authorId) {
  if (!data.Title) throw new ValidationError('Thiếu title.');
  const slug = data.Slug || slugify(data.Title);
  return CmsPage.findOneAndUpdate(
    { Slug: slug },
    {
      ...data,
      Slug: slug,
      AuthorID: authorId,
      PublishedAt: data.Status === 'published' ? new Date() : data.PublishedAt,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

module.exports = { listPublished, getBySlug, upsertPage };
