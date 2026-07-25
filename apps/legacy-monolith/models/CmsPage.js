'use strict';
const mongoose = require('mongoose');
const cmsPageSchema = new mongoose.Schema({
  Slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  Title: { type: String, required: true },
  Body: { type: String, default: '' },
  MetaTitle: { type: String, default: '' },
  MetaDescription: { type: String, default: '' },
  Type: { type: String, enum: ['guide', 'faq', 'city', 'policy', 'announcement', 'homepage'], default: 'guide' },
  Status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
  CitySlug: { type: String, default: '', index: true },
  PublishedAt: { type: Date, default: null },
  AuthorID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { collection: 'cms_pages', timestamps: true });
module.exports = mongoose.model('CmsPage', cmsPageSchema);
