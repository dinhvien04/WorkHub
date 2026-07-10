'use strict';
const mongoose = require('mongoose');
const incidentSchema = new mongoose.Schema({
  BookingID: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  HostID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  ReportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  Type: { type: String, enum: ['damage', 'late_checkout', 'violation', 'other'], default: 'other' },
  Description: { type: String, required: true, maxlength: 3000 },
  InternalNote: { type: String, default: '' },
  CustomerNote: { type: String, default: '' },
  Evidence: [{ url: String }],
  Status: { type: String, enum: ['open', 'closed'], default: 'open' },
}, { collection: 'incidents', timestamps: true });
module.exports = mongoose.model('Incident', incidentSchema);
