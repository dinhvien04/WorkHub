'use strict';
const mongoose = require('mongoose');

/** Simulated hosted checkout session (no real card data stored). */
const gatewayPaymentSchema = new mongoose.Schema(
  {
    BookingID: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    CustomerID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    HostID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    Amount: { type: Number, required: true, min: 1 },
    Currency: { type: String, default: 'VND' },
    Provider: { type: String, default: 'workhub_mock' },
    SessionId: { type: String, required: true, unique: true, index: true },
    Status: {
      type: String,
      enum: ['created', 'redirected', 'succeeded', 'failed', 'expired'],
      default: 'created',
      index: true,
    },
    IdempotencyKey: { type: String, sparse: true, unique: true },
    WebhookReceivedAt: { type: Date, default: null },
    ProviderRef: { type: String, default: '' },
  },
  { collection: 'gateway_payments', timestamps: true }
);

module.exports = mongoose.model('GatewayPayment', gatewayPaymentSchema);
