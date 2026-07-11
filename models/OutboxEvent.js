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
        'email_secure_verify',
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
    /** Authenticated-encryption ciphertext for secrets (email verify raw token, etc.) */
    PayloadEncrypted: { type: String, default: '' },
    PayloadWipedAt: { type: Date, default: null },
    PayloadHash: { type: String, default: '' },
    IdempotencyKey: { type: String, required: true, unique: true },
    Status: {
      type: String,
      enum: ['pending', 'processing', 'sent', 'failed', 'dead'],
      default: 'pending',
      index: true,
    },
    Attempts: { type: Number, default: 0 },
    ProcessingBy: { type: String, default: '', index: true },
    ClaimedAt: { type: Date, default: null },
    LeaseUntil: { type: Date, default: null },
    AvailableAt: { type: Date, default: Date.now, index: true },
    CompletedBy: { type: String, default: '' },
    LastError: { type: String, default: '' },
    ProcessedAt: { type: Date, default: null },
    ExpiresAt: { type: Date, default: null },
  },
  { collection: 'outbox_events', timestamps: true }
);

outboxEventSchema.index({ Status: 1, AvailableAt: 1 });
outboxEventSchema.index({ Status: 1, LeaseUntil: 1 });
outboxEventSchema.index({ Type: 1, Status: 1, AvailableAt: 1 });

module.exports = mongoose.model('OutboxEvent', outboxEventSchema);
