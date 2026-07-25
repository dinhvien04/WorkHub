"use strict";

const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    UserID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    PublicSessionID: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    SidHash: { type: String, required: true, unique: true, index: true },
    Sid: { type: String, default: "", sparse: true },
    TokenVersion: { type: Number, default: 0 },
    UserAgent: { type: String, default: "" },
    IP: { type: String, default: "" },
    AuthMethod: {
      type: String,
      enum: ["password", "google", "webauthn", "recovery", "2fa", "unknown"],
      default: "unknown",
    },
    LastSeenAt: { type: Date, default: Date.now },
    ExpiresAt: { type: Date, default: null },
    RevokedAt: { type: Date, default: null },
  },
  { collection: "user_sessions", timestamps: true },
);

sessionSchema.index({ UserID: 1, createdAt: -1 });
sessionSchema.index({ UserID: 1, RevokedAt: 1, ExpiresAt: 1 });
sessionSchema.index({ ExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("UserSession", sessionSchema);
