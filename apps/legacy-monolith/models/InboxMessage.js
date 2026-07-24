"use strict";

const mongoose = require("mongoose");

const inboxMessageSchema = new mongoose.Schema(
  {
    EventID: { type: String, required: true },
    ConsumerName: { type: String, required: true },
    Status: {
      type: String,
      enum: ["processing", "completed", "failed"],
      default: "processing",
      index: true,
    },
    ProcessedAt: { type: Date, default: null },
    Error: { type: String, default: "" },
  },
  {
    collection: "inbox_messages",
    timestamps: true,
  }
);

// Compound unique index ensuring an event is processed only once per consumer
inboxMessageSchema.index({ EventID: 1, ConsumerName: 1 }, { unique: true });

module.exports = mongoose.model("InboxMessage", inboxMessageSchema);
