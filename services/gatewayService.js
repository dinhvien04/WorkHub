'use strict';

const crypto = require('crypto');
const GatewayPayment = require('../models/GatewayPayment');
const Booking = require('../models/Booking');
const PaymentHistory = require('../models/Payment_History');
const ledgerService = require('./ledgerService');
const { notifyUser } = require('./notificationService');
const env = require('../config/env');
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require('../utils/errors');

function webhookSecret() {
  return process.env.GATEWAY_WEBHOOK_SECRET || env.JWT_SECRET;
}

function signPayload(body) {
  return crypto.createHmac('sha256', webhookSecret()).update(body).digest('hex');
}

function verifySignature(rawBody, signature) {
  if (!signature) return false;
  const expected = signPayload(rawBody);
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Create hosted-checkout session (mock). Never stores card data.
 */
async function createCheckoutSession({
  customerId,
  bookingId,
  amount,
  idempotencyKey,
}) {
  const booking = await Booking.findOne({ _id: bookingId, CustomerID: customerId });
  if (!booking) throw new NotFoundError('Không tìm thấy booking.');
  const amt = Math.round(Number(amount));
  if (!amt || amt <= 0 || amt > booking.TotalAmount) {
    throw new ValidationError('Số tiền checkout không hợp lệ.');
  }

  if (idempotencyKey) {
    const existing = await GatewayPayment.findOne({ IdempotencyKey: idempotencyKey });
    if (existing) {
      return {
        session: existing,
        checkoutUrl: `/payment/gateway/${existing.SessionId}`,
        duplicate: true,
      };
    }
  }

  const sessionId = `cs_${crypto.randomBytes(16).toString('hex')}`;
  try {
    const session = await GatewayPayment.create({
      BookingID: bookingId,
      CustomerID: customerId,
      HostID: booking.HostID,
      Amount: amt,
      SessionId: sessionId,
      Status: 'created',
      IdempotencyKey: idempotencyKey || undefined,
      Provider: 'workhub_mock',
    });
    return {
      session,
      checkoutUrl: `/payment/gateway/${sessionId}`,
      duplicate: false,
    };
  } catch (err) {
    if (err.code === 11000 && idempotencyKey) {
      const existing = await GatewayPayment.findOne({ IdempotencyKey: idempotencyKey });
      if (existing) {
        return {
          session: existing,
          checkoutUrl: `/payment/gateway/${existing.SessionId}`,
          duplicate: true,
        };
      }
    }
    throw err;
  }
}

/**
 * Mock complete + signed webhook processing (idempotent).
 */
async function handleWebhook({ rawBody, signature, event }) {
  if (!verifySignature(rawBody, signature)) {
    const err = new Error('Invalid webhook signature');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    err.isOperational = true;
    throw err;
  }

  const sessionId = event.sessionId || event.data?.sessionId;
  if (!sessionId) throw new ValidationError('Missing sessionId');

  const session = await GatewayPayment.findOne({ SessionId: sessionId });
  if (!session) throw new NotFoundError('Session not found');

  if (session.Status === 'succeeded') {
    return { ok: true, duplicate: true, session };
  }

  if (event.type !== 'checkout.session.completed' && event.type !== 'payment.succeeded') {
    session.Status = 'failed';
    await session.save();
    return { ok: true, session };
  }

  session.Status = 'succeeded';
  session.WebhookReceivedAt = new Date();
  session.ProviderRef = event.id || event.eventId || `evt_${Date.now()}`;
  await session.save();

  // Create successful PaymentHistory (idempotent by session)
  let payment = await PaymentHistory.findOne({
    TransactionCode: `GW-${session.SessionId}`,
  });
  if (!payment) {
    payment = await PaymentHistory.create({
      BookingID: session.BookingID,
      CustomerID: session.CustomerID,
      HostID: session.HostID,
      TransactionCode: `GW-${session.SessionId}`,
      Amount: session.Amount,
      PaymentType: session.Amount >= (await Booking.findById(session.BookingID)).TotalAmount
        ? 'full_payment'
        : 'deposit',
      PaymentMethod: 'e_wallet',
      Status: 'successful',
      PaidAt: new Date(),
      VerifiedAt: new Date(),
      IdempotencyKey: `gw-${session.SessionId}`,
    });
  }

  await ledgerService.postEntry({
    hostId: session.HostID,
    customerId: session.CustomerID,
    bookingId: session.BookingID,
    paymentId: payment._id,
    type: 'payment',
    amount: session.Amount,
    direction: 'credit',
    description: `Gateway ${session.SessionId}`,
    idempotencyKey: `ledger-gw-${session.SessionId}`,
  });

  const booking = await Booking.findById(session.BookingID);
  if (booking && ['pending', 'awaiting_payment', 'payment_under_review'].includes(booking.Status)) {
    booking.Status = 'payment_under_review';
    await booking.save();
  }

  await notifyUser({
    userId: session.HostID,
    title: 'Thanh toán gateway thành công',
    body: `${session.Amount.toLocaleString('vi-VN')}đ`,
    type: 'payment',
    entityType: 'PaymentHistory',
    entityId: payment._id,
    link: '/host/payments',
  });

  return { ok: true, session, payment, duplicate: false };
}

async function getSession(sessionId) {
  const session = await GatewayPayment.findOne({ SessionId: sessionId }).lean();
  if (!session) throw new NotFoundError('Session not found');
  return session;
}

/** Dev helper: complete session without real provider */
async function mockCompleteSession(sessionId, customerId) {
  const session = await GatewayPayment.findOne({ SessionId: sessionId });
  if (!session) throw new NotFoundError('Session not found');
  if (String(session.CustomerID) !== String(customerId)) {
    throw new ForbiddenError('Không phải session của bạn.');
  }
  const event = {
    type: 'checkout.session.completed',
    id: `evt_mock_${Date.now()}`,
    sessionId,
  };
  const raw = JSON.stringify(event);
  const signature = signPayload(raw);
  return handleWebhook({ rawBody: raw, signature, event });
}

module.exports = {
  createCheckoutSession,
  handleWebhook,
  getSession,
  mockCompleteSession,
  signPayload,
  verifySignature,
};
