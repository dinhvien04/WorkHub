'use strict';
const mongoose = require('mongoose');
const blackoutSchema = new mongoose.Schema({
  HostID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  SpaceID: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true, index: true },
  StartTime: { type: Date, required: true },
  EndTime: { type: Date, required: true },
  Reason: { type: String, default: 'maintenance' },
  NotifyCustomers: { type: Boolean, default: true },
}, { collection: 'blackouts', timestamps: true });
blackoutSchema.index({ SpaceID: 1, StartTime: 1, EndTime: 1 });
module.exports = mongoose.model('Blackout', blackoutSchema);
