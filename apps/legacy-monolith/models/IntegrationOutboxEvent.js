"use strict";

const mongoose = require("mongoose");

const integrationOutboxSchema = new mongoose.Schema(
  {
    EventID: { type: String, required: true, unique: true },
    EventType: { type: String, required: true, index: true },
    AggregateID: { type: String, required: true },
    AggregateVersion: { type: Number, required: true },
    CorrelationID: { type: String, required: true },
    CausationID: { type: String },
    TraceID: { type: String },
    Payload: { type: mongoose.Schema.Types.Mixed, required: true },
    Status: {
      type: String,
      enum: ["pending", "processing", "published", "failed", "dead"],
      default: "pending",
      index: true,
    },
    Attempts: { type: Number, default: 0 },
    ProcessingBy: { type: String, default: null },
    LeaseUntil: { type: Date, default: null },
    LastError: { type: String },
    AvailableAt: { type: Date, default: Date.now, index: true },
  },
  {
    collection: "integration_outbox_events",
    timestamps: true,
  }
);

integrationOutboxSchema.index({ Status: 1, AvailableAt: 1 });

module.exports = mongoose.model("IntegrationOutboxEvent", integrationOutboxSchema);
