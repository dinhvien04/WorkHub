'use strict';

const crypto = require('crypto');
const PaymentHistory = require('../models/Payment_History');
const Booking = require('../models/Booking');
const logActivity = require('../utils/auditLogger');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} = require('../utils/errors');

async function getSuccessfulPaidAmount(bookingId) {
  const rows = await PaymentHistory.find({
    BookingID: bookingId,
    Status: 'successful',
  }).select('Amount').lean();
  return rows.reduce((sum, p) => sum + (p.Amount || 0), 0);
}

async function getRemainingAmount(bookingId) {
  const booking = await Booking.findById(bookingId).select('TotalAmount').lean();
  if (!booking) throw new NotFoundError('Không tìm thấy đơn hàng.');
  const paid = await getSuccessfulPaidAmount(bookingId);
  return Math.max(0, booking.TotalAmount - paid);
}

async function getPaymentProgress(bookingId) {
  const booking = await Booking.findById(bookingId).select('TotalAmount DepositAmount').lean();
  if (!booking) throw new NotFoundError('Không tìm thấy đơn hàng.');
  const paid = await getSuccessfulPaidAmount(bookingId);
  const total = booking.TotalAmount || 0;
  const percent = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  return {
    totalAmount: total,
    depositAmount: booking.DepositAmount || 0,
    paidAmount: paid,
    remainingAmount: Math.max(0, total - paid),
    percentPaid: percent,
  };
}

/**
 * Customer submits a payment report (pending until host verifies).
 */
async function createPendingPayment({
  customerId,
  bookingId,
  paymentType,
  paymentMethod = 'bank_transfer',
  idempotencyKey = null,
}) {
  const booking = await Booking.findOne({ _id: bookingId, CustomerID: customerId });
  if (!booking) throw new NotFoundError('Không tìm thấy đơn hàng của bạn.');

  if (!['pending', 'confirmed', 'in-use'].includes(booking.Status)) {
    throw new ValidationError('Đơn hàng không ở trạng thái có thể thanh toán.');
  }

  if (idempotencyKey) {
    const existing = await PaymentHistory.findOne({
      BookingID: bookingId,
      CustomerID: customerId,
      IdempotencyKey: idempotencyKey,
    });
    if (existing) {
      return { payment: existing, duplicate: true };
    }
  }

  // Block infinite duplicate pending of same stage
  const typeStr = String(paymentType || 'deposit').toLowerCase().trim();
  let actualPaymentType = 'deposit';
  let amountToPay = booking.DepositAmount;

  if (typeStr === 'full' || typeStr === 'full_payment' || typeStr === '100') {
    actualPaymentType = 'full_payment';
    amountToPay = booking.TotalAmount;
  } else if (typeStr === 'remaining' || typeStr === 'remaining_balance') {
    actualPaymentType = 'remaining_balance';
    amountToPay = await getRemainingAmount(bookingId);
  } else {
    actualPaymentType = 'deposit';
    amountToPay = booking.DepositAmount;
  }

  if (!amountToPay || amountToPay <= 0) {
    throw new ValidationError('Số tiền thanh toán không hợp lệ.');
  }

  const paid = await getSuccessfulPaidAmount(bookingId);
  if (paid + amountToPay > booking.TotalAmount) {
    throw new ValidationError('Không thể thanh toán vượt tổng giá trị đơn hàng.');
  }

  const pendingSameType = await PaymentHistory.findOne({
    BookingID: bookingId,
    CustomerID: customerId,
    PaymentType: actualPaymentType,
    Status: 'pending',
  });
  if (pendingSameType) {
    return { payment: pendingSameType, duplicate: true };
  }

  const txn = `TXN-${booking._id}-${crypto.randomBytes(4).toString('hex')}-${Date.now()}`;

  try {
    const payment = await PaymentHistory.create({
      BookingID: booking._id,
      CustomerID: customerId,
      HostID: booking.HostID,
      TransactionCode: txn,
      Amount: amountToPay,
      PaymentType: actualPaymentType,
      PaymentMethod: paymentMethod,
      Status: 'pending',
      IdempotencyKey: idempotencyKey || undefined,
    });

    await logActivity(
      customerId,
      'PAYMENT_PENDING',
      'PaymentHistory',
      payment._id,
      `Khách báo cáo thanh toán ${amountToPay.toLocaleString('vi-VN')}đ`,
      'info'
    );

    return { payment, duplicate: false };
  } catch (err) {
    if (err.code === 11000) {
      const existing = await PaymentHistory.findOne({
        BookingID: bookingId,
        CustomerID: customerId,
        IdempotencyKey: idempotencyKey,
      });
      if (existing) return { payment: existing, duplicate: true };
      throw new ConflictError('Giao dịch trùng lặp.');
    }
    throw err;
  }
}

async function verifyPayment(hostId, paymentId) {
  const payment = await PaymentHistory.findOne({ _id: paymentId, HostID: hostId });
  if (!payment) throw new NotFoundError('Không tìm thấy giao dịch.');
  if (payment.Status !== 'pending') {
    throw new ValidationError('Chỉ có thể xác minh giao dịch đang pending.');
  }

  const paid = await getSuccessfulPaidAmount(payment.BookingID);
  const booking = await Booking.findById(payment.BookingID);
  if (!booking) throw new NotFoundError('Không tìm thấy đơn hàng.');
  if (String(booking.HostID) !== String(hostId)) {
    throw new ForbiddenError('Bạn không có quyền xác minh giao dịch này.');
  }
  if (paid + payment.Amount > booking.TotalAmount) {
    throw new ValidationError('Xác minh sẽ làm vượt tổng đơn hàng.');
  }

  payment.Status = 'successful';
  payment.PaidAt = new Date();
  payment.VerifiedAt = new Date();
  payment.VerifiedBy = hostId;
  await payment.save();

  await logActivity(hostId, 'VERIFY_PAYMENT', 'PaymentHistory', payment._id, 'Host xác minh thanh toán', 'success');
  return payment;
}

async function listHostPayments(hostId, { page = 1, limit = 20, status } = {}) {
  const filter = { HostID: hostId };
  if (status) filter.Status = status;
  const skip = (page - 1) * limit;
  const [payments, total] = await Promise.all([
    PaymentHistory.find(filter)
      .select('-__v')
      .populate('CustomerID', 'FullName Email')
      .populate('BookingID', 'Status TotalAmount StartTime EndTime')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PaymentHistory.countDocuments(filter),
  ]);
  return { payments, total, page, limit };
}

module.exports = {
  getSuccessfulPaidAmount,
  getRemainingAmount,
  getPaymentProgress,
  createPendingPayment,
  verifyPayment,
  listHostPayments,
};
