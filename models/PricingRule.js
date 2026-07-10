'use strict';
const mongoose = require('mongoose');
const pricingRuleSchema = new mongoose.Schema({
  HostID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  BranchID: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
  SpaceID: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', default: null },
  Name: { type: String, required: true },
  Type: {
    type: String,
    enum: ['peak_hour', 'weekend', 'holiday', 'last_minute', 'long_stay', 'corporate'],
    required: true,
  },
  Multiplier: { type: Number, default: 1 },
  FixedAdjust: { type: Number, default: 0 },
  Priority: { type: Number, default: 100 },
  DayOfWeek: [{ type: Number, min: 0, max: 6 }],
  HourStart: { type: Number, min: 0, max: 23, default: null },
  HourEnd: { type: Number, min: 0, max: 23, default: null },
  MinHours: { type: Number, default: null },
  Status: { type: String, enum: ['draft', 'active', 'inactive'], default: 'active' },
}, { collection: 'pricing_rules', timestamps: true });
module.exports = mongoose.model('PricingRule', pricingRuleSchema);
