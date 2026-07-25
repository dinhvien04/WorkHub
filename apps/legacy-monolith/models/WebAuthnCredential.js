'use strict';

const mongoose = require('mongoose');

const webAuthnCredentialSchema = new mongoose.Schema(
  {
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    CredentialId: { type: String, required: true, unique: true, index: true },
    PublicKey: { type: String, default: '' },
    Counter: { type: Number, default: 0 },
    Transports: [{ type: String }],
    DeviceName: { type: String, default: 'Passkey', maxlength: 100 },
    LastUsedAt: { type: Date, default: null },
  },
  { collection: 'webauthn_credentials', timestamps: true }
);

module.exports = mongoose.model('WebAuthnCredential', webAuthnCredentialSchema);
