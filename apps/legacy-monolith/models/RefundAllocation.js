'use strict';

const mongoose = require('mongoose');

const refundAllocationSchema = new mongoose.Schema(
  {
    RefundID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Refund',
      required: true,
      index: true,
    },
    PaymentID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentHistory',
      required: true,
      index: true,
    },
    Amount: { type: Number, required: true, min: 1 },
  },
  { collection: 'refund_allocations', timestamps: true }
);

refundAllocationSchema.index({ RefundID: 1, PaymentID: 1 }, { unique: true });

module.exports = mongoose.model('RefundAllocation', refundAllocationSchema);
