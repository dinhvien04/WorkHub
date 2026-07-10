'use strict';

const LedgerEntry = require('../models/LedgerEntry');
const { ValidationError } = require('../utils/errors');

async function postEntry({
  hostId,
  customerId = null,
  bookingId = null,
  paymentId = null,
  type,
  amount,
  direction,
  description = '',
  idempotencyKey = null,
  meta = {},
}) {
  if (!hostId || !type || !amount || !direction) {
    throw new ValidationError('Ledger entry thiếu field bắt buộc.');
  }
  if (idempotencyKey) {
    const existing = await LedgerEntry.findOne({ IdempotencyKey: idempotencyKey });
    if (existing) return existing;
  }
  try {
    const entry = await LedgerEntry.create({
      HostID: hostId,
      CustomerID: customerId,
      BookingID: bookingId,
      PaymentID: paymentId,
      Type: type,
      Amount: Math.round(Math.abs(amount)),
      Direction: direction,
      Status: 'posted',
      IdempotencyKey: idempotencyKey || undefined,
      Meta: meta,
      Description: description,
    });
    // Keep HostBalance projection in sync for payment credits (payouts manage reserve themselves)
    if (type === 'payment' && direction === 'credit') {
      try {
        const HostBalance = require('../models/HostBalance');
        await HostBalance.findOneAndUpdate(
          { HostID: hostId },
          {
            $inc: { AvailableBalance: entry.Amount, Version: 1 },
            $setOnInsert: { ReservedBalance: 0, PaidOutBalance: 0, Currency: 'VND' },
          },
          { upsert: true }
        );
      } catch {
        /* non-fatal for ledger post */
      }
    }
    return entry;
  } catch (err) {
    if (err.code === 11000 && idempotencyKey) {
      return LedgerEntry.findOne({ IdempotencyKey: idempotencyKey });
    }
    throw err;
  }
}

async function getHostBalance(hostId) {
  // Prefer projected balance when present (O(1))
  try {
    const HostBalance = require('../models/HostBalance');
    const proj = await HostBalance.findOne({ HostID: hostId }).lean();
    if (proj) {
      return {
        available: Math.max(0, proj.AvailableBalance || 0),
        pending: Math.max(0, proj.ReservedBalance || 0),
        paidOut: Math.max(0, proj.PaidOutBalance || 0),
        currency: proj.Currency || 'VND',
        projected: true,
      };
    }
  } catch {
    /* fall through */
  }

  const entries = await LedgerEntry.find({ HostID: hostId, Status: 'posted' }).lean();
  let available = 0;
  let pending = 0;
  let paidOut = 0;
  for (const e of entries) {
    const signed = e.Direction === 'credit' ? e.Amount : -e.Amount;
    available += signed;
    if (e.Type === 'payout' && e.Direction === 'debit') {
      paidOut += e.Amount;
    }
  }
  return {
    available: Math.max(0, available),
    pending,
    paidOut,
    currency: 'VND',
    projected: false,
  };
}

async function listLedger(hostId, { page = 1, limit = 50 } = {}) {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    LedgerEntry.find({ HostID: hostId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    LedgerEntry.countDocuments({ HostID: hostId }),
  ]);
  return { items, total, page, limit };
}

module.exports = { postEntry, getHostBalance, listLedger };
