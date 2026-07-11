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
    enum: [
      'requested',
      'approved',
      'provider_pending',
      'provider_submitted',
      'processing',
      'completed',
      'rejected',
      'failed',
      'manual_action_required',
      'manual_refund_required',
      'manual_refund_confirmed',
    ],
    default: 'requested',
    index: true,
  },
  ProviderRefundID: { type: String, default: '' },
  TransferReference: { type: String, default: '' },
  RequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ProcessedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  ProcessedAt: { type: Date, default: null },
  FailureReason: { type: String, default: '' },
  IdempotencyKey: { type: String, sparse: true, unique: true },
  Meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { collection: 'refunds', timestamps: true });
module.exports = mongoose.model('Refund', refundSchema);
