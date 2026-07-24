'use strict';

const mongoose = require('mongoose');

const passwordResetTokenSchema = new mongoose.Schema(
  {
    UserID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    Email: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    TokenHash: {
      type: String,
      required: true,
    },
    Attempts: {
      type: Number,
      default: 0,
    },
    MaxAttempts: {
      type: Number,
      default: 5,
    },
    ExpiresAt: {
      type: Date,
      required: true,
    },
    UsedAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'password_reset_tokens',
    timestamps: true,
  }
);

// Auto-delete expired tokens
passwordResetTokenSchema.index({ ExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PasswordResetToken', passwordResetTokenSchema);
