'use strict';

const mongoose = require('mongoose');

const emailVerificationTokenSchema = new mongoose.Schema(
  {
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    TokenHash: { type: String, required: true, index: true },
    ExpiresAt: { type: Date, required: true, index: true },
    UsedAt: { type: Date, default: null },
  },
  { collection: 'email_verification_tokens', timestamps: true }
);

emailVerificationTokenSchema.index({ ExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('EmailVerificationToken', emailVerificationTokenSchema);
