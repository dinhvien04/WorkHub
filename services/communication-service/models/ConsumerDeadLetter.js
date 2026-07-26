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


// Dead letters are diagnostic, not a record of account state. Without an
// expiry they accumulate forever — and any payload they hold outlives the
// TTL of the credential it describes by an unbounded margin.
deadLetterSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model("ConsumerDeadLetter", deadLetterSchema);
