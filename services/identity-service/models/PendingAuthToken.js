"use strict";

const mongoose = require("mongoose");

/**
 * One-time record backing a pre-auth (step-up) token.
 *
 * The JWT alone is not sufficient to complete a step-up: its `jti` must still
 * have an unconsumed row here. Consumption is a conditional update, so a
 * replayed token finds nothing to consume and is rejected.
 */
const pendingAuthTokenSchema = new mongoose.Schema(
  {
    JtiHash: { type: String, required: true, unique: true, index: true },
    UserID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    Purpose: {
      type: String,
      enum: ["2fa"],
      default: "2fa",
      required: true,
    },
    TokenVersion: { type: Number, required: true, default: 0 },
    AuthMethod: {
      type: String,
      enum: ["password", "google", "webauthn"],
      default: "password",
    },
    IP: { type: String, default: "" },
    UserAgent: { type: String, default: "" },
    ConsumedAt: { type: Date, default: null },
    ExpiresAt: { type: Date, required: true },
  },
  { collection: "pending_auth_tokens", timestamps: true },
);

pendingAuthTokenSchema.index({ UserID: 1, ConsumedAt: 1 });
// Reap expired rows; consumed rows are kept until expiry as replay evidence.
pendingAuthTokenSchema.index({ ExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PendingAuthToken", pendingAuthTokenSchema);
