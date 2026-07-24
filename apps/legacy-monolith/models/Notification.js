'use strict';

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    Title: { type: String, required: true, trim: true, maxlength: 200 },
    Body: { type: String, default: '', maxlength: 2000 },
    Type: {
      type: String,
      enum: ['system', 'booking', 'payment', 'host', 'admin', 'message'],
      default: 'system',
      index: true,
    },
    EntityType: { type: String, default: '' },
    EntityID: { type: mongoose.Schema.Types.ObjectId, default: null },
    IsRead: { type: Boolean, default: false, index: true },
    Link: { type: String, default: '' },
  },
  { collection: 'notifications', timestamps: true }
);

notificationSchema.index({ UserID: 1, IsRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
