'use strict';
const mongoose = require('mongoose');
const addOnSchema = new mongoose.Schema({
  HostID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  BranchID: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
  Name: { type: String, required: true, trim: true },
  Description: { type: String, default: '' },
  Price: { type: Number, required: true, min: 0 },
  Unit: { type: String, enum: ['booking', 'hour', 'person'], default: 'booking' },
  Inventory: { type: Number, default: null },
  Status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
  Refundable: { type: Boolean, default: true },
}, { collection: 'addons', timestamps: true });
module.exports = mongoose.model('AddOn', addOnSchema);
