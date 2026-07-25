'use strict';

const mongoose = require('mongoose');

const featureFlagSchema = new mongoose.Schema(
  {
    Key: { type: String, required: true, unique: true, trim: true, index: true },
    Enabled: { type: Boolean, default: false },
    Description: { type: String, default: '' },
    Percentage: { type: Number, min: 0, max: 100, default: 100 },
    Roles: [{ type: String }],
    Environments: [{ type: String }],
  },
  { collection: 'feature_flags', timestamps: true }
);

module.exports = mongoose.model('FeatureFlag', featureFlagSchema);
