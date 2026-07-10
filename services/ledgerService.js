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
    return await LedgerEntry.create({
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
  } catch (err) {
    if (err.code === 11000 && idempotencyKey) {
      return LedgerEntry.findOne({ IdempotencyKey: idempotencyKey });
    }
    throw err;
  }
}

async function getHostBalance(hostId) {
  const entries = await LedgerEntry.find({ HostID: hostId, Status: 'posted' }).lean();
  let available = 0;
  let pending = 0;
  let paidOut = 0;
  for (const e of entries) {
    const signed = e.Direction === 'credit' ? e.Amount : -e.Amount;
    if (e.Type === 'payout') paidOut += e.Amount;
    else if (e.Type === 'payment') available += signed;
    else if (e.Type === 'refund') available += signed;
    else if (e.Type === 'fee') available += signed;
    else available += signed;
  }
  return {
    available: Math.max(0, available),
    pending,
    paidOut,
    currency: 'VND',
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
