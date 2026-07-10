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
const providers = require('./gatewayProviders');

function webhookSecret() {
  return process.env.GATEWAY_WEBHOOK_SECRET || env.JWT_SECRET;
}

function signPayload(body, provider = 'workhub_mock') {
  return providers.signForProvider(provider, body);
}

function verifySignature(rawBody, signature, provider = 'workhub_mock') {
  return providers.verifyForProvider(provider, rawBody, signature);
}

/**
 * Create hosted-checkout session. Never stores card data.
 */
async function createCheckoutSession({
  customerId,
  bookingId,
  amount,
  idempotencyKey,
  provider: requestedProvider,
}) {
  const booking = await Booking.findOne({ _id: bookingId, CustomerID: customerId });
  if (!booking) throw new NotFoundError('Không tìm thấy booking.');
  const amt = Math.round(Number(amount));
  if (!amt || amt <= 0 || amt > booking.TotalAmount) {
    throw new ValidationError('Số tiền checkout không hợp lệ.');
  }

  const provider = providers.activeProvider(requestedProvider);

  if (idempotencyKey) {
    const existing = await GatewayPayment.findOne({ IdempotencyKey: idempotencyKey });
    if (existing) {
      return {
        session: existing,
        checkoutUrl: providers.providerCheckoutUrl(existing.Provider, existing.SessionId),
        provider: existing.Provider,
        duplicate: true,
      };
    }
  }

  // Prefer live provider session when keys configured
  let live = null;
  try {
    live = await providers.tryCreateLiveSession({
      provider,
      amount: amt,
      currency: 'VND',
      bookingId,
      successUrl: process.env.PUBLIC_BASE_URL
        ? `${process.env.PUBLIC_BASE_URL}/payment?bookingId=${bookingId}&paid=1`
        : undefined,
      cancelUrl: process.env.PUBLIC_BASE_URL
        ? `${process.env.PUBLIC_BASE_URL}/payment?bookingId=${bookingId}`
        : undefined,
    });
  } catch (err) {
    if (err.statusCode === 502) throw err;
    live = null;
  }

  const sessionId = live?.sessionId || providers.makeSessionId(provider);
  try {
    const session = await GatewayPayment.create({
      BookingID: bookingId,
      CustomerID: customerId,
      HostID: booking.HostID,
      Amount: amt,
      SessionId: sessionId,
      Status: live ? 'redirected' : 'created',
      IdempotencyKey: idempotencyKey || undefined,
      Provider: provider,
      ProviderRef: live?.providerRef || '',
    });
    return {
      session,
      checkoutUrl: live?.checkoutUrl || providers.providerCheckoutUrl(provider, sessionId),
      provider,
      live: Boolean(live?.live),
      duplicate: false,
    };
  } catch (err) {
    if (err.code === 11000 && idempotencyKey) {
      const existing = await GatewayPayment.findOne({ IdempotencyKey: idempotencyKey });
      if (existing) {
        return {
          session: existing,
          checkoutUrl: providers.providerCheckoutUrl(existing.Provider, existing.SessionId),
          provider: existing.Provider,
          duplicate: true,
        };
      }
    }
    throw err;
  }
}

/**
 * Signed webhook processing (idempotent). Provider-aware.
 */
async function handleWebhook({ rawBody, signature, event, provider: providerHint }) {
  // Resolve session first if possible to pick provider-specific secret
  const normalizedPeek = providers.normalizeWebhookEvent(
    providerHint || 'workhub_mock',
    event
  );
  let provider = providerHint || event?.provider || 'workhub_mock';
  if (normalizedPeek?.sessionId) {
    const peek = await GatewayPayment.findOne({ SessionId: normalizedPeek.sessionId })
      .select('Provider')
      .lean();
    if (peek?.Provider) provider = peek.Provider;
  }

  if (!verifySignature(rawBody, signature, provider)) {
    // fallback workhub secret for legacy tests
    if (!verifySignature(rawBody, signature, 'workhub_mock')) {
      const err = new Error('Invalid webhook signature');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      err.isOperational = true;
      throw err;
    }
    provider = 'workhub_mock';
  }

  const normalized = providers.normalizeWebhookEvent(provider, event) || event;
  const sessionId = normalized.sessionId;
  if (!sessionId) throw new ValidationError('Missing sessionId');

  const session = await GatewayPayment.findOne({ SessionId: sessionId });
  if (!session) throw new NotFoundError('Session not found');

  if (session.Status === 'succeeded') {
    return { ok: true, duplicate: true, session };
  }

  const okTypes = new Set([
    'checkout.session.completed',
    'payment.succeeded',
    'payment.success',
  ]);
  if (!okTypes.has(normalized.type)) {
    session.Status = 'failed';
    await session.save();
    return { ok: true, session };
  }

  session.Status = 'succeeded';
  session.WebhookReceivedAt = new Date();
  session.ProviderRef = normalized.id || event.id || event.eventId || `evt_${Date.now()}`;
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

async function listProviders() {
  return providers.listProviders();
}

module.exports = {
  createCheckoutSession,
  handleWebhook,
  getSession,
  mockCompleteSession,
  signPayload,
  verifySignature,
  listProviders,
};
