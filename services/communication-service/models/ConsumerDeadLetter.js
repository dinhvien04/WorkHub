"use strict";

const mongoose = require("mongoose");

const deadLetterSchema = new mongoose.Schema(
  {
    MessageID: { type: String, required: true, unique: true },
    QueueName: { type: String, required: true, index: true },
    RoutingKey: { type: String, required: true },
    Payload: { type: mongoose.Schema.Types.Mixed, required: true },
    Headers: { type: mongoose.Schema.Types.Mixed },
    Error: { type: String },
    Status: { type: String, enum: ["pending", "replayed", "discarded"], default: "pending", index: true }
  },
  { collection: "consumer_dead_letters", timestamps: true }
);

module.exports = mongoose.model("ConsumerDeadLetter", deadLetterSchema);
