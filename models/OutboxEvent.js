'use strict';

const mongoose = require('mongoose');

/**
 * Durable outbox for post-commit side effects (email, push, notify, audit).
 * Workers claim by lease and process exactly once per IdempotencyKey.
 */
const outboxEventSchema = new mongoose.Schema(
  {
    Type: {
      type: String,
      required: true,
      index: true,
      enum: [
        'notification',
        'email',
        'email_template',
        'audit',
        'push',
        'socket',
        'metrics',
      ],
    },
    EntityType: { type: String, default: '' },
    EntityID: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    RecipientID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    Payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    IdempotencyKey: { type: String, required: true, unique: true },
    Status: {
      type: String,
      enum: ['pending', 'processing', 'sent', 'failed', 'dead'],
      default: 'pending',
      index: true,
    },
    Attempts: { type: Number, default: 0 },
    LeaseUntil: { type: Date, default: null },
    AvailableAt: { type: Date, default: Date.now, index: true },
    LastError: { type: String, default: '' },
    ProcessedAt: { type: Date, default: null },
  },
  { collection: 'outbox_events', timestamps: true }
);

outboxEventSchema.index({ Status: 1, AvailableAt: 1 });
outboxEventSchema.index({ Type: 1, Status: 1, AvailableAt: 1 });

module.exports = mongoose.model('OutboxEvent', outboxEventSchema);
