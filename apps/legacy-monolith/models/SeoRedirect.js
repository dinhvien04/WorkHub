'use strict';

const mongoose = require('mongoose');

const seoRedirectSchema = new mongoose.Schema(
  {
    FromPath: { type: String, required: true, unique: true, trim: true, index: true },
    ToPath: { type: String, required: true, trim: true },
    StatusCode: { type: Number, enum: [301, 302], default: 301 },
    Active: { type: Boolean, default: true },
    Note: { type: String, default: '' },
  },
  { collection: 'seo_redirects', timestamps: true }
);

module.exports = mongoose.model('SeoRedirect', seoRedirectSchema);
