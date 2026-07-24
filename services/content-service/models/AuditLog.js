"use strict";

const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    ActorID: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    Action: { type: String, required: true, index: true },
    TargetEntity: { type: String, required: true },
    TargetID: { type: mongoose.Schema.Types.ObjectId, required: true },
    Reason: { type: String, required: true }
  },
  { collection: "audit_logs", timestamps: true }
);

module.exports = mongoose.model("AuditLog", auditLogSchema);
