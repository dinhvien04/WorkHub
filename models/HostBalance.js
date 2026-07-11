'use strict';

const mongoose = require('mongoose');

/**
 * Projected host financial balance.
 * AvailableBalance may go negative when refunds exceed available (debt policy).
 * DebtBalance tracks explicit platform-advance liability when preferred.
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
    // No min:0 — refunds above available create explicit negative/debt
    AvailableBalance: { type: Number, default: 0 },
    ReservedBalance: { type: Number, default: 0, min: 0 },
    PaidOutBalance: { type: Number, default: 0, min: 0 },
    DebtBalance: { type: Number, default: 0, min: 0 },
    Version: { type: Number, default: 0 },
    Currency: { type: String, default: 'VND' },
  },
  { collection: 'host_balances', timestamps: true }
);

module.exports = mongoose.model('HostBalance', hostBalanceSchema);
