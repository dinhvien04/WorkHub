'use strict';
const mongoose = require('mongoose');
const crypto = require('crypto');

const apiKeySchema = new mongoose.Schema(
  {
    Name: { type: String, required: true },
    OwnerUserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    KeyPrefix: { type: String, required: true, index: true },
    KeyHash: { type: String, required: true },
    Scopes: [{ type: String }],
    Status: { type: String, enum: ['active', 'revoked'], default: 'active', index: true },
    LastUsedAt: { type: Date, default: null },
    ExpiresAt: { type: Date, default: null },
  },
  { collection: 'api_keys', timestamps: true }
);

apiKeySchema.statics.generate = function generate() {
  const raw = `wh_${crypto.randomBytes(24).toString('hex')}`;
  const prefix = raw.slice(0, 10);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, prefix, hash };
};

module.exports = mongoose.model('ApiKey', apiKeySchema);
