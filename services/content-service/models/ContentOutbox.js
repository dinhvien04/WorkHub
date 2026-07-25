"use strict";

const mongoose = require("mongoose");

const contentOutboxSchema = new mongoose.Schema(
  {
    Type: { type: String, required: true, index: true },
    Payload: { type: mongoose.Schema.Types.Mixed, required: true },
    Status: { type: String, enum: ["pending", "processing", "published", "failed", "dead"], default: "pending", index: true },
    Attempts: { type: Number, default: 0 },
    IdempotencyKey: { type: String, required: true, unique: true },
    AvailableAt: { type: Date, default: Date.now, index: true },
    LeaseUntil: { type: Date, default: null },
    LastError: { type: String }
  },
  { collection: "content_outbox", timestamps: true }
);

contentOutboxSchema.index({ Status: 1, AvailableAt: 1 });
contentOutboxSchema.index({ Status: 1, LeaseUntil: 1 });

module.exports = mongoose.model("ContentOutbox", contentOutboxSchema);
