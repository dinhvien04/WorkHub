'use strict';

const Payout = require('../models/Payout');
const HostProfile = require('../models/Host_Profile');
const ledgerService = require('./ledgerService');
const { ValidationError, NotFoundError, ConflictError } = require('../utils/errors');
const { notifyUser } = require('./notificationService');

async function requestPayout({ hostId, amount, idempotencyKey }) {
  const amt = Math.round(Number(amount));
  if (!amt || amt < 50000) {
    throw new ValidationError('Số tiền rút tối thiểu 50.000đ.');
  }
  const balance = await ledgerService.getHostBalance(hostId);
  if (amt > balance.available) {
    throw new ValidationError('Số dư khả dụng không đủ.');
  }

  if (idempotencyKey) {
    const existing = await Payout.findOne({ IdempotencyKey: idempotencyKey });
    if (existing) return existing;
  }

  const profile = await HostProfile.findOne({ UserID: hostId }).lean();
  const masked = profile?.BankNumber
    ? `****${String(profile.BankNumber).slice(-4)}`
    : '';

  try {
    const payout = await Payout.create({
      HostID: hostId,
      Amount: amt,
      Status: 'requested',
      BankName: profile?.BankName || '',
      BankNumberMasked: masked,
      IdempotencyKey: idempotencyKey || undefined,
    });

    // Reserve funds immediately via ledger debit
    await ledgerService.postEntry({
      hostId,
      type: 'payout',
      amount: amt,
      direction: 'debit',
      description: `Payout request ${payout._id}`,
      idempotencyKey: `payout-ledger-${payout._id}`,
      meta: { payoutId: payout._id, status: 'requested' },
    });

    return payout;
  } catch (err) {
    if (err.code === 11000) {
      const existing = await Payout.findOne({ IdempotencyKey: idempotencyKey });
      if (existing) return existing;
      throw new ConflictError('Payout trùng lặp.');
    }
    throw err;
  }
}

async function processPayout({ payoutId, approve, adminId }) {
  const payout = await Payout.findById(payoutId);
  if (!payout) throw new NotFoundError('Không tìm thấy payout.');
  if (payout.Status !== 'requested' && payout.Status !== 'processing') {
    throw new ValidationError('Payout không thể xử lý.');
  }
  if (!approve) {
    payout.Status = 'failed';
    payout.FailureReason = 'Rejected by admin';
    payout.ProcessedAt = new Date();
    await payout.save();
    // credit back
    await ledgerService.postEntry({
      hostId: payout.HostID,
      type: 'adjustment',
      amount: payout.Amount,
      direction: 'credit',
      description: `Payout failed restore ${payout._id}`,
      idempotencyKey: `payout-restore-${payout._id}`,
    });
    return payout;
  }
  payout.Status = 'paid';
  payout.ProcessedAt = new Date();
  await payout.save();
  await notifyUser({
    userId: payout.HostID,
    title: 'Payout đã chuyển',
    body: `${payout.Amount.toLocaleString('vi-VN')}đ`,
    type: 'payment',
    entityType: 'Payout',
    entityId: payout._id,
  });
  return payout;
}

async function listHostPayouts(hostId) {
  return Payout.find({ HostID: hostId }).sort({ createdAt: -1 }).limit(50).lean();
}

module.exports = { requestPayout, processPayout, listHostPayouts };
