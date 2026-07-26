"use strict";

const mongoose = require("mongoose");

/**
 * Transactional outbox for identity integration events.
 *
 * Rows are written inside the same Mongo transaction as the state change they
 * describe, so an event can never be published for a change that rolled back,
 * and a committed change can never silently fail to notify anyone.
 *
 * Payloads that carry a secret (email verification token, password reset OTP)
 * are stored under CipherPayload rather than Payload — those rows outlive the
 * request and would otherwise sit in plaintext in any database backup.
 */
const identityOutboxSchema = new mongoose.Schema(
  {
    EventId: { type: String, required: true, unique: true, index: true },
    EventType: { type: String, required: true, index: true },
    AggregateId: { type: String, required: true },

    // Exactly one of these is set; CipherPayload is keyring ciphertext whose
    // AAD is the EventId.
    Payload: { type: mongoose.Schema.Types.Mixed, default: null },
    CipherPayload: { type: String, default: null },

    Status: {
      type: String,
      enum: ["pending", "processing", "published", "failed", "dead"],
      default: "pending",
      index: true,
    },
    Attempts: { type: Number, default: 0 },
    MaxAttempts: { type: Number, default: 8 },
    IdempotencyKey: { type: String, required: true, unique: true },

    AvailableAt: { type: Date, default: Date.now, index: true },
    LeaseUntil: { type: Date, default: null },
    ProcessingBy: { type: String, default: null },

    LastError: { type: String, default: null },
    PublishedAt: { type: Date, default: null },
  },
  { collection: "identity_outbox", timestamps: true },
);

// Claim query: pending/failed that are due, or processing whose lease expired.
identityOutboxSchema.index({ Status: 1, AvailableAt: 1 });
identityOutboxSchema.index({ Status: 1, LeaseUntil: 1 });

module.exports = mongoose.model("IdentityOutbox", identityOutboxSchema);
