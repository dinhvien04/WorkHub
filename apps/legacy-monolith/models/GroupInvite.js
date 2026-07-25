'use strict';

const mongoose = require('mongoose');

const groupInviteSchema = new mongoose.Schema(
  {
    BookingID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    OrganizerID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    Email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    Name: { type: String, default: '', trim: true, maxlength: 120 },
    Token: { type: String, required: true, unique: true, index: true },
    RsvpStatus: {
      type: String,
      enum: ['pending', 'accepted', 'declined'],
      default: 'pending',
      index: true,
    },
    RsvpAt: { type: Date, default: null },
    Note: { type: String, default: '', maxlength: 500 },
  },
  { collection: 'group_invites', timestamps: true }
);

groupInviteSchema.index({ BookingID: 1, Email: 1 }, { unique: true });

module.exports = mongoose.model('GroupInvite', groupInviteSchema);
