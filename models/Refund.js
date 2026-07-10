'use strict';
const mongoose = require('mongoose');
const refundSchema = new mongoose.Schema({
  BookingID: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  PaymentID: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentHistory', default: null },
  CustomerID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  HostID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  Amount: { type: Number, required: true, min: 0 },
  Reason: { type: String, default: '' },
  Status: {
    type: String,
    enum: ['requested', 'approved', 'processing', 'completed', 'rejected', 'failed'],
    default: 'requested',
    index: true,
  },
  RequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ProcessedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  ProcessedAt: { type: Date, default: null },
  IdempotencyKey: { type: String, sparse: true, unique: true },
}, { collection: 'refunds', timestamps: true });
module.exports = mongoose.model('Refund', refundSchema);
