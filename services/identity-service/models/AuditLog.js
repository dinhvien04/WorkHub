"use strict";

const mongoose = require("mongoose");

/**
 * Identity's own audit trail.
 *
 * Written inside the same transaction as the action it records, so a rolled
 * back state change leaves no misleading audit entry — and, more importantly,
 * a committed security-relevant change can never go unrecorded because a log
 * sink happened to be unavailable.
 */
const auditLogSchema = new mongoose.Schema(
  {
    UserID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    Action: { type: String, required: true, index: true },
    EntityType: { type: String, default: null },
    EntityID: { type: String, default: null },
    Message: { type: String, default: "" },
    Level: {
      type: String,
      enum: ["info", "success", "warning", "error"],
      default: "info",
    },
    IP: { type: String, default: "" },
    UserAgent: { type: String, default: "" },
    OccurredAt: { type: Date, default: Date.now, index: true },
  },
  { collection: "identity_audit_logs", timestamps: true },
);

auditLogSchema.index({ UserID: 1, OccurredAt: -1 });
auditLogSchema.index({ Action: 1, OccurredAt: -1 });

module.exports = mongoose.model("IdentityAuditLog", auditLogSchema);
