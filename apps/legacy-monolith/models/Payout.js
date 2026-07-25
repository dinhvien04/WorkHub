"use strict";
const mongoose = require("mongoose");

const payoutSchema = new mongoose.Schema(
  {
    HostID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    Amount: { type: Number, required: true, min: 1 },
    Currency: { type: String, default: "VND" },
    Status: {
      type: String,
      enum: ["requested", "processing", "paid", "failed", "cancelled"],
      default: "requested",
      index: true,
    },
    BankName: { type: String, default: "" },
    BankNumberMasked: { type: String, default: "" },
    FailureReason: { type: String, default: "" },
    ProcessedAt: { type: Date, default: null },
    ProcessedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    TransferReference: { type: String, default: "" },
    IdempotencyKey: { type: String, sparse: true, unique: true },
    Meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { collection: "payouts", timestamps: true },
);

module.exports = mongoose.model("Payout", payoutSchema);
