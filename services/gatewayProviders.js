'use strict';

/**
 * Payment provider adapters — hosted checkout only (never card/CVV).
 * Real Stripe/MoMo keys can plug into the same interface later.
 */
const crypto = require('crypto');
const env = require('../config/env');

const PROVIDERS = ['workhub_mock', 'stripe_mock', 'momo_mock'];

function activeProvider(requested) {
  const fromEnv = process.env.PAYMENT_PROVIDER || 'workhub_mock';
  const p = String(requested || fromEnv || 'workhub_mock').toLowerCase();
  if (!PROVIDERS.includes(p)) return 'workhub_mock';
  return p;
}

function sessionPrefix(provider) {
  if (provider === 'stripe_mock') return 'cs_test_';
  if (provider === 'momo_mock') return 'momo_';
  return 'cs_';
}

function makeSessionId(provider) {
  return `${sessionPrefix(provider)}${crypto.randomBytes(16).toString('hex')}`;
}

function providerCheckoutUrl(provider, sessionId) {
  // All mock providers use our hosted page; real Stripe would return session.url
  if (provider === 'stripe_mock') {
    return `/payment/gateway/${sessionId}?provider=stripe_mock`;
  }
  if (provider === 'momo_mock') {
    return `/payment/gateway/${sessionId}?provider=momo_mock`;
  }
  return `/payment/gateway/${sessionId}`;
}

function webhookSecretFor(provider) {
  if (provider === 'stripe_mock') {
    return process.env.STRIPE_WEBHOOK_SECRET || process.env.GATEWAY_WEBHOOK_SECRET || env.JWT_SECRET;
  }
  if (provider === 'momo_mock') {
    return process.env.MOMO_SECRET_KEY || process.env.GATEWAY_WEBHOOK_SECRET || env.JWT_SECRET;
  }
  return process.env.GATEWAY_WEBHOOK_SECRET || env.JWT_SECRET;
}

function signForProvider(provider, rawBody) {
  return crypto.createHmac('sha256', webhookSecretFor(provider)).update(rawBody).digest('hex');
}

function verifyForProvider(provider, rawBody, signature) {
  if (!signature) return false;
  const expected = signForProvider(provider, rawBody);
  try {
    return crypto.timingSafeEqual(Buffer.from(String(signature)), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Normalize provider-specific webhook payloads into { type, sessionId, id }.
 */
function normalizeWebhookEvent(provider, event) {
  if (!event || typeof event !== 'object') return null;
  if (provider === 'stripe_mock' || event.object === 'event') {
    return {
      type: event.type || event.event_type,
      sessionId:
        event.sessionId ||
        event.data?.object?.id ||
        event.data?.sessionId ||
        event.data?.object?.client_reference_id,
      id: event.id || event.eventId,
    };
  }
  if (provider === 'momo_mock') {
    return {
      type: event.resultCode === 0 || event.type === 'payment.succeeded'
        ? 'payment.succeeded'
        : event.type || 'payment.failed',
      sessionId: event.orderId || event.sessionId || event.requestId,
      id: event.transId || event.id,
    };
  }
  return {
    type: event.type,
    sessionId: event.sessionId || event.data?.sessionId,
    id: event.id || event.eventId,
  };
}

function listProviders() {
  return PROVIDERS.map((id) => ({
    id,
    mock: id.endsWith('_mock'),
    label:
      id === 'stripe_mock'
        ? 'Stripe (mock hosted)'
        : id === 'momo_mock'
          ? 'MoMo (mock hosted)'
          : 'WorkHub mock gateway',
  }));
}

module.exports = {
  PROVIDERS,
  activeProvider,
  makeSessionId,
  providerCheckoutUrl,
  signForProvider,
  verifyForProvider,
  normalizeWebhookEvent,
  listProviders,
  webhookSecretFor,
};
