'use strict';
const mongoose = require('mongoose');
const ledgerSchema = new mongoose.Schema({
  HostID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  CustomerID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  BookingID: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
  PaymentID: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentHistory', default: null },
  Type: {
    type: String,
    enum: ['payment', 'refund', 'credit', 'payout', 'fee', 'adjustment'],
    required: true,
    index: true,
  },
  Amount: { type: Number, required: true }, // minor unit integer VND
  Currency: { type: String, default: 'VND' },
  Direction: { type: String, enum: ['credit', 'debit'], required: true },
  Status: { type: String, enum: ['pending', 'posted', 'void'], default: 'posted', index: true },
  IdempotencyKey: { type: String, sparse: true, unique: true },
  Meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  Description: { type: String, default: '' },
}, { collection: 'ledger_entries', timestamps: true });
ledgerSchema.index({ HostID: 1, createdAt: -1 });
module.exports = mongoose.model('LedgerEntry', ledgerSchema);
