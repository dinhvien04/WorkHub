'use strict';
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Random public session id returned to client (not secret) */
    Sid: { type: String, required: true, unique: true, index: true },
    /** Hash of sid for lookups if needed; Sid is already random */
    SidHash: { type: String, default: '', index: true },
    TokenVersion: { type: Number, default: 0 },
    UserAgent: { type: String, default: '' },
    IP: { type: String, default: '' },
    LastSeenAt: { type: Date, default: Date.now },
    ExpiresAt: { type: Date, default: null, index: true },
    RevokedAt: { type: Date, default: null },
  },
  { collection: 'user_sessions', timestamps: true }
);

sessionSchema.index({ UserID: 1, createdAt: -1 });
sessionSchema.index({ UserID: 1, RevokedAt: 1, ExpiresAt: 1 });

module.exports = mongoose.model('UserSession', sessionSchema);
