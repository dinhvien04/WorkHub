'use strict';
const mongoose = require('mongoose');
const supportTicketSchema = new mongoose.Schema({
  UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  BookingID: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
  Subject: { type: String, required: true, maxlength: 200 },
  Body: { type: String, required: true, maxlength: 5000 },
  Status: {
    type: String,
    enum: ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'],
    default: 'open',
    index: true,
  },
  Priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
  Messages: [{
    AuthorID: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    Body: String,
    createdAt: { type: Date, default: Date.now },
  }],
}, { collection: 'support_tickets', timestamps: true });
module.exports = mongoose.model('SupportTicket', supportTicketSchema);
