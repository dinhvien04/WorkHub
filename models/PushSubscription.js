'use strict';

const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema(
  {
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    Endpoint: { type: String, required: true },
    Keys: {
      p256dh: { type: String, default: '' },
      auth: { type: String, default: '' },
    },
    UserAgent: { type: String, default: '' },
    Status: { type: String, enum: ['active', 'revoked'], default: 'active', index: true },
  },
  { collection: 'push_subscriptions', timestamps: true }
);

pushSubscriptionSchema.index({ UserID: 1, Endpoint: 1 }, { unique: true });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
