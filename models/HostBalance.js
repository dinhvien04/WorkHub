'use strict';

const mongoose = require('mongoose');

/**
 * Projected host financial balance — source of truth for available funds.
 * Updated atomically with ledger posts for payouts.
 */
const hostBalanceSchema = new mongoose.Schema(
  {
    HostID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    AvailableBalance: { type: Number, default: 0, min: 0 },
    ReservedBalance: { type: Number, default: 0, min: 0 },
    PaidOutBalance: { type: Number, default: 0, min: 0 },
    Version: { type: Number, default: 0 },
    Currency: { type: String, default: 'VND' },
  },
  { collection: 'host_balances', timestamps: true }
);

module.exports = mongoose.model('HostBalance', hostBalanceSchema);
