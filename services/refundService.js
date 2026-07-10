'use strict';

const Refund = require('../models/Refund');
const PaymentHistory = require('../models/Payment_History');
const Booking = require('../models/Booking');
const ledgerService = require('./ledgerService');
const { notifyUser } = require('./notificationService');
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require('../utils/errors');

async function getSuccessfulPaid(bookingId) {
  const rows = await PaymentHistory.find({ BookingID: bookingId, Status: 'successful' });
  return rows.reduce((s, p) => s + p.Amount, 0);
}

async function getRefundedTotal(bookingId) {
  const rows = await Refund.find({
    BookingID: bookingId,
    Status: { $in: ['approved', 'processing', 'completed'] },
  });
  return rows.reduce((s, r) => s + r.Amount, 0);
}

async function requestRefund({ bookingId, userId, role, amount, reason, idempotencyKey }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new NotFoundError('Không tìm thấy booking.');
  const isCustomer = String(booking.CustomerID) === String(userId);
  const isHost = String(booking.HostID) === String(userId);
  if (!isCustomer && !isHost && role !== 'admin') {
    throw new ForbiddenError('Không có quyền yêu cầu hoàn tiền.');
  }

  const paid = await getSuccessfulPaid(bookingId);
  const already = await getRefundedTotal(bookingId);
  const maxRefund = paid - already;
  const amt = Math.round(Number(amount));
  if (!amt || amt <= 0 || amt > maxRefund) {
    throw new ValidationError(`Số tiền hoàn không hợp lệ (tối đa ${maxRefund}).`);
  }

  if (idempotencyKey) {
    const existing = await Refund.findOne({ IdempotencyKey: idempotencyKey });
    if (existing) return existing;
  }

  try {
    const refund = await Refund.create({
      BookingID: bookingId,
      CustomerID: booking.CustomerID,
      HostID: booking.HostID,
      Amount: amt,
      Reason: String(reason || '').slice(0, 1000),
      Status: 'requested',
      RequestedBy: userId,
      IdempotencyKey: idempotencyKey || undefined,
    });
    await notifyUser({
      userId: booking.HostID,
      title: 'Yêu cầu hoàn tiền',
      body: `${amt.toLocaleString('vi-VN')}đ`,
      type: 'payment',
      entityType: 'Refund',
      entityId: refund._id,
      link: '/host/payments',
    });
    return refund;
  } catch (err) {
    if (err.code === 11000) {
      const existing = await Refund.findOne({ IdempotencyKey: idempotencyKey });
      if (existing) return existing;
      throw new ConflictError('Refund trùng lặp.');
    }
    throw err;
  }
}

async function processRefund({ refundId, actorId, approve, role }) {
  const refund = await Refund.findById(refundId);
  if (!refund) throw new NotFoundError('Không tìm thấy refund.');
  if (role !== 'admin' && String(refund.HostID) !== String(actorId)) {
    throw new ForbiddenError('Không có quyền xử lý refund.');
  }
  if (refund.Status !== 'requested' && refund.Status !== 'approved') {
    throw new ValidationError('Refund không ở trạng thái xử lý được.');
  }

  if (!approve) {
    refund.Status = 'rejected';
    refund.ProcessedBy = actorId;
    refund.ProcessedAt = new Date();
    await refund.save();
    return refund;
  }

  const paid = await getSuccessfulPaid(refund.BookingID);
  const already = await getRefundedTotal(refund.BookingID);
  // already includes this if approved before — only count completed
  const completed = await Refund.find({
    BookingID: refund.BookingID,
    Status: 'completed',
  });
  const completedSum = completed.reduce((s, r) => s + r.Amount, 0);
  if (completedSum + refund.Amount > paid) {
    throw new ValidationError('Hoàn sẽ vượt số đã thanh toán thành công.');
  }

  refund.Status = 'completed';
  refund.ProcessedBy = actorId;
  refund.ProcessedAt = new Date();
  await refund.save();

  await PaymentHistory.updateMany(
    { BookingID: refund.BookingID, Status: 'successful' },
    { $set: { Status: 'refunded', RefundedAt: new Date() } }
  );

  await ledgerService.postEntry({
    hostId: refund.HostID,
    customerId: refund.CustomerID,
    bookingId: refund.BookingID,
    type: 'refund',
    amount: refund.Amount,
    direction: 'debit',
    description: `Refund ${refund._id}`,
    idempotencyKey: `refund-ledger-${refund._id}`,
  });

  await notifyUser({
    userId: refund.CustomerID,
    title: 'Hoàn tiền đã xử lý',
    body: `${refund.Amount.toLocaleString('vi-VN')}đ`,
    type: 'payment',
    entityType: 'Refund',
    entityId: refund._id,
  });

  return refund;
}

module.exports = { requestRefund, processRefund, getSuccessfulPaid, getRefundedTotal };
