'use strict';

const mongoose = require('mongoose');

const webhookEventSchema = new mongoose.Schema(
  {
    Provider: { type: String, required: true, index: true },
    ProviderEventID: { type: String, required: true },
    PayloadHash: { type: String, required: true },
    ReceivedAt: { type: Date, default: Date.now, index: true },
    ProcessingStatus: {
      type: String,
      enum: ['received', 'processing', 'processed', 'failed'],
      default: 'received',
      index: true,
    },
    ProcessingLeaseUntil: { type: Date, default: null },
    ProcessingBy: { type: String, default: '' },
    Attempts: { type: Number, default: 0 },
    ProcessedAt: { type: Date, default: null },
    FailureReason: { type: String, default: '' },
  },
  { collection: 'webhook_events', timestamps: true }
);

webhookEventSchema.index({ Provider: 1, ProviderEventID: 1 }, { unique: true });
webhookEventSchema.index({ ProcessingStatus: 1, ProcessingLeaseUntil: 1 });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
