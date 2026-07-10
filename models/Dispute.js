'use strict';
const mongoose = require('mongoose');
const disputeSchema = new mongoose.Schema({
  BookingID: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  CustomerID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  HostID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  OpenedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  Reason: { type: String, required: true, maxlength: 2000 },
  Status: {
    type: String,
    enum: ['open', 'under_review', 'resolved', 'rejected', 'appealed', 'closed'],
    default: 'open',
    index: true,
  },
  Evidence: [{ url: String, note: String, uploadedAt: { type: Date, default: Date.now } }],
  AdminNotes: { type: String, default: '' },
  Resolution: { type: String, default: '' },
  RefundAmount: { type: Number, default: 0 },
  ResolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  ResolvedAt: { type: Date, default: null },
}, { collection: 'disputes', timestamps: true });
module.exports = mongoose.model('Dispute', disputeSchema);
