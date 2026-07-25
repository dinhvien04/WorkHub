"use strict";

const mongoose = require("mongoose");

const idempotencyRecordSchema = new mongoose.Schema(
  {
    ScopeKey: { type: String, required: true, unique: true, index: true },
    RequestFingerprint: { type: String, required: true },
    Status: { type: String, enum: ["pending", "completed"], default: "pending" },
    ResponseStatus: { type: Number, required: true },
    ResponseBody: { type: mongoose.Schema.Types.Mixed, default: {} },
    ExpiresAt: { type: Date, required: true, index: true },
  },
  { collection: "idempotency_records", timestamps: true }
);

idempotencyRecordSchema.index({ ExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("IdempotencyRecord", idempotencyRecordSchema);
