"use strict";

const mongoose = require("mongoose");

const processedMessageSchema = new mongoose.Schema(
  {
    EventID: { type: String, required: true },
    ConsumerName: { type: String, required: true },
    Status: { type: String, enum: ["processing", "completed", "failed"], default: "processing", index: true },
    ProcessedAt: { type: Date, default: null },
    Error: { type: String, default: "" }
  },
  { collection: "processed_messages", timestamps: true }
);

processedMessageSchema.index({ EventID: 1, ConsumerName: 1 }, { unique: true });

module.exports = mongoose.model("ProcessedMessage", processedMessageSchema);
