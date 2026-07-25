"use strict";

const mongoose = require("mongoose");

const commOutboxSchema = new mongoose.Schema(
  {
    Type: { type: String, enum: ["email", "push"], required: true, index: true },
    RecipientID: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    Payload: { type: mongoose.Schema.Types.Mixed, required: true },
    Status: { type: String, enum: ["pending", "processing", "sent", "failed", "dead"], default: "pending", index: true },
    Attempts: { type: Number, default: 0 },
    IdempotencyKey: { type: String, required: true, unique: true },
    AvailableAt: { type: Date, default: Date.now, index: true },
    LeaseUntil: { type: Date, default: null },
    LastError: { type: String }
  },
  { collection: "communication_outbox", timestamps: true }
);

commOutboxSchema.index({ Status: 1, AvailableAt: 1 });

module.exports = mongoose.model("CommunicationOutbox", commOutboxSchema);
