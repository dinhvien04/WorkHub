'use strict';
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    TokenVersion: { type: Number, default: 0 },
    UserAgent: { type: String, default: '' },
    IP: { type: String, default: '' },
    LastSeenAt: { type: Date, default: Date.now },
    RevokedAt: { type: Date, default: null },
  },
  { collection: 'user_sessions', timestamps: true }
);

sessionSchema.index({ UserID: 1, createdAt: -1 });

module.exports = mongoose.model('UserSession', sessionSchema);
