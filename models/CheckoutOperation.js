'use strict';

const mongoose = require('mongoose');

/**
 * Tenant-scoped checkout idempotency operation.
 * Client raw keys are never used as global uniqueness keys.
 */
const checkoutOperationSchema = new mongoose.Schema(
  {
    CustomerID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    BookingID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    HostID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    Operation: { type: String, default: 'checkout', index: true },
    ClientKeyHash: { type: String, required: true },
    RequestFingerprint: { type: String, required: true },
    PaymentType: {
      type: String,
      enum: ['deposit', 'remaining_balance', 'full_payment'],
      required: true,
    },
    Amount: { type: Number, required: true, min: 1 },
    Currency: { type: String, default: 'VND' },
    Provider: { type: String, required: true },
    Status: {
      type: String,
      enum: ['open', 'succeeded', 'failed', 'expired'],
      default: 'open',
      index: true,
    },
    CurrentAttemptID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GatewayPayment',
      default: null,
    },
    SucceededAttemptID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GatewayPayment',
      default: null,
    },
    AttemptCount: { type: Number, default: 0 },
  },
  { collection: 'checkout_operations', timestamps: true }
);

checkoutOperationSchema.index(
  { CustomerID: 1, BookingID: 1, Operation: 1, ClientKeyHash: 1 },
  { unique: true }
);

module.exports = mongoose.model('CheckoutOperation', checkoutOperationSchema);
