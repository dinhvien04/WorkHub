"use strict";

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    Email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    PasswordHash: {
      type: String,
      required: function requiredPassword() {
        return this.AuthProvider === "local" || !this.AuthProvider;
      },
    },
    AuthProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
      index: true,
    },
    GoogleSub: { type: String, sparse: true, unique: true },
    FullName: { type: String, trim: true, required: true },
    Role: {
      type: String,
      enum: ["customer", "host", "admin"],
      default: "customer",
      index: true,
    },
    Status: {
      type: String,
      enum: ["active", "inactive", "banned"],
      default: "inactive",
    },
    tokenVersion: { type: Number, default: 0 },
    EmailVerified: { type: Boolean, default: false },
    EmailVerifiedAt: { type: Date, default: null },
    TotpEnabled: { type: Boolean, default: false },
    TotpSecret: { type: String, default: null, select: false },
    TotpRecoveryHashes: { type: [String], default: [], select: false },
    NotifyEmail: { type: Boolean, default: true },
    NotifyPush: { type: Boolean, default: true },
    NotifySms: { type: Boolean, default: false },
    MarketingOptIn: { type: Boolean, default: false },
    PreferredLang: { type: String, default: "vi", maxlength: 8 },
    Timezone: { type: String, default: "Asia/Ho_Chi_Minh", maxlength: 64 },
  },
  { collection: "users", timestamps: true },
);

userSchema.index({ Role: 1, Status: 1 });

module.exports = mongoose.model("User", userSchema);
