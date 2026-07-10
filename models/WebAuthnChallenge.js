'use strict';

const mongoose = require('mongoose');

const webAuthnChallengeSchema = new mongoose.Schema(
  {
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    Challenge: { type: String, required: true, unique: true, index: true },
    ChallengeHash: { type: String, default: '', index: true },
    Purpose: { type: String, enum: ['register', 'login'], required: true },
    ExpectedRpId: { type: String, default: '' },
    ExpectedOrigin: { type: String, default: '' },
    ExpiresAt: { type: Date, required: true, index: true },
    ConsumedAt: { type: Date, default: null },
  },
  { collection: 'webauthn_challenges', timestamps: true }
);

webAuthnChallengeSchema.index({ ExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('WebAuthnChallenge', webAuthnChallengeSchema);
