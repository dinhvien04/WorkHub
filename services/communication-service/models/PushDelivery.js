"use strict";

const mongoose = require("mongoose");

const pushDeliverySchema = new mongoose.Schema(
  {
    UserID: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    SubscriptionID: { type: mongoose.Schema.Types.ObjectId, ref: "PushSubscription", required: true },
    Payload: { type: mongoose.Schema.Types.Mixed, required: true },
    Status: { type: String, enum: ["success", "failed"], required: true, index: true },
    StatusCode: { type: Number },
    Error: { type: String }
  },
  { collection: "push_deliveries", timestamps: true }
);

module.exports = mongoose.model("PushDelivery", pushDeliverySchema);
