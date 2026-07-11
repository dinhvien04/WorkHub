"use strict";

const mongoose = require("mongoose");

/**
 * Durable provider refund operation — network calls outside Mongo txn;
 * settlement happens after provider confirmation.
 */
const providerRefundOpSchema = new mongoose.Schema(
  {
    RefundID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Refund",
      required: true,
      index: true,
    },
    PaymentID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentHistory",
      required: true,
    },
    Provider: { type: String, required: true },
    ProviderPaymentID: { type: String, default: "" },
    ProviderRefundID: { type: String, default: "", index: true },
    Amount: { type: Number, required: true, min: 1 },
    Currency: { type: String, default: "VND" },
    Status: {
      type: String,
      enum: ["pending", "submitted", "succeeded", "failed", "manual_required"],
      default: "pending",
      index: true,
    },
    ClientKeyHash: { type: String, default: "" },
    RequestFingerprint: { type: String, default: "" },
    Attempts: { type: Number, default: 0 },
    FailureCode: { type: String, default: "" },
    Meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { collection: "provider_refund_operations", timestamps: true },
);

providerRefundOpSchema.index({ RefundID: 1, PaymentID: 1 }, { unique: true });
providerRefundOpSchema.index(
  { Provider: 1, ProviderRefundID: 1 },
  { sparse: true },
);

module.exports = mongoose.model(
  "ProviderRefundOperation",
  providerRefundOpSchema,
);
