'use strict';
const mongoose = require('mongoose');

/** Hosted checkout session (no real card data stored). */
const gatewayPaymentSchema = new mongoose.Schema(
  {
    BookingID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    CustomerID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    HostID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    OperationID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckoutOperation',
      default: null,
      index: true,
    },
    AttemptNumber: { type: Number, default: 1 },
    Amount: { type: Number, required: true, min: 1 },
    Currency: { type: String, default: 'VND' },
    PaymentType: {
      type: String,
      enum: ['deposit', 'remaining_balance', 'full_payment'],
      default: 'deposit',
      index: true,
    },
    Provider: {
      type: String,
      enum: ['workhub_mock', 'stripe_mock', 'momo_mock', 'stripe', 'momo'],
      default: 'workhub_mock',
      index: true,
    },
    SessionId: { type: String, required: true, unique: true, index: true },
    Status: {
      type: String,
      enum: ['created', 'redirected', 'pending', 'succeeded', 'failed', 'expired'],
      default: 'created',
      index: true,
    },
    /** @deprecated Prefer CheckoutOperation scoped key; kept for unique-session legacy. */
    IdempotencyKey: { type: String, sparse: true, unique: true },
    ClientKeyHash: { type: String, default: '', index: true },
    RequestFingerprint: { type: String, default: '' },
    WebhookReceivedAt: { type: Date, default: null },
    ProviderRef: { type: String, default: '' },
    Meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { collection: 'gateway_payments', timestamps: true }
);

gatewayPaymentSchema.index({ OperationID: 1, AttemptNumber: 1 });

module.exports = mongoose.model('GatewayPayment', gatewayPaymentSchema);
