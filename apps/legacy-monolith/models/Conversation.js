'use strict';

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    SenderID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    Body: { type: String, required: true, maxlength: 4000 },
    IsSystem: { type: Boolean, default: false },
    ReadBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

const conversationSchema = new mongoose.Schema(
  {
    BookingID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      unique: true,
      index: true,
    },
    CustomerID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    HostID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    Messages: { type: [messageSchema], default: [] },
    LastMessageAt: { type: Date, default: Date.now, index: true },
    Reports: [
      {
        MessageID: { type: mongoose.Schema.Types.ObjectId },
        ReportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        Reason: { type: String, default: '', maxlength: 500 },
        CreatedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { collection: 'conversations', timestamps: true }
);

module.exports = mongoose.model('Conversation', conversationSchema);
