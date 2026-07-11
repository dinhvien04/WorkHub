'use strict';
const mongoose = require('mongoose');

/**
 * User session store.
 * JWT carries raw SID secret; DB stores only SidHash + PublicSessionID.
 * Never store reusable bearer SID in plaintext.
 */
const sessionSchema = new mongoose.Schema(
  {
    UserID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Public id for session list / revoke APIs (not the JWT secret). */
    PublicSessionID: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    /** sha256(hex) of JWT sid — only lookup key for session revoke checks */
    SidHash: { type: String, required: true, unique: true, index: true },
    /**
     * @deprecated Legacy plaintext SID — do not write new values.
     * Kept optional for migration/read of old rows only.
     */
    Sid: { type: String, default: '', sparse: true },
    TokenVersion: { type: Number, default: 0 },
    UserAgent: { type: String, default: '' },
    IP: { type: String, default: '' },
    AuthMethod: {
      type: String,
      enum: ['password', 'google', 'webauthn', 'recovery', '2fa', 'unknown'],
      default: 'unknown',
    },
    LastSeenAt: { type: Date, default: Date.now },
    ExpiresAt: { type: Date, default: null, index: true },
    RevokedAt: { type: Date, default: null },
  },
  { collection: 'user_sessions', timestamps: true }
);

sessionSchema.index({ UserID: 1, createdAt: -1 });
sessionSchema.index({ UserID: 1, RevokedAt: 1, ExpiresAt: 1 });

module.exports = mongoose.model('UserSession', sessionSchema);
