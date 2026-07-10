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
    ProcessedAt: { type: Date, default: null },
    FailureReason: { type: String, default: '' },
  },
  { collection: 'webhook_events', timestamps: true }
);

webhookEventSchema.index({ Provider: 1, ProviderEventID: 1 }, { unique: true });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
