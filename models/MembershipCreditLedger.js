'use strict';

const mongoose = require('mongoose');

/**
 * Append-only membership credit ledger.
 * Balance (Membership.CreditsRemaining) is denormalized cache only —
 * never update balance without posting a ledger entry first.
 */
const membershipCreditLedgerSchema = new mongoose.Schema(
  {
    MembershipID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Membership',
      required: true,
      index: true,
    },
    UserID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    Type: {
      type: String,
      enum: ['grant', 'consume', 'expire', 'adjust', 'refund'],
      required: true,
      index: true,
    },
    /** Absolute hours for this entry (always >= 0). Sign via Direction. */
    Hours: { type: Number, required: true, min: 0 },
    Direction: { type: String, enum: ['credit', 'debit'], required: true },
    BalanceAfter: { type: Number, required: true, min: 0 },
    ExpiresAt: { type: Date, default: null },
    BookingID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    IdempotencyKey: { type: String, sparse: true, unique: true },
    Description: { type: String, default: '' },
    Meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { collection: 'membership_credit_ledger', timestamps: true }
);

membershipCreditLedgerSchema.index({ MembershipID: 1, createdAt: -1 });
membershipCreditLedgerSchema.index({ UserID: 1, createdAt: -1 });

module.exports = mongoose.model('MembershipCreditLedger', membershipCreditLedgerSchema);
