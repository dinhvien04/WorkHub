'use strict';

/**
 * Payment provider adapters — hosted checkout only (never card/CVV).
 * Real Stripe/MoMo keys can plug into the same interface later.
 */
const crypto = require('crypto');
const env = require('../config/env');

const PROVIDERS = ['workhub_mock', 'stripe_mock', 'momo_mock', 'stripe', 'momo'];

function stripeLiveReady() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_'));
}

function momoLiveReady() {
  return Boolean(
    process.env.MOMO_PARTNER_CODE &&
      process.env.MOMO_ACCESS_KEY &&
      process.env.MOMO_SECRET_KEY
  );
}

function activeProvider(requested) {
  const fromEnv = process.env.PAYMENT_PROVIDER || 'workhub_mock';
  let p = String(requested || fromEnv || 'workhub_mock').toLowerCase();
  // Auto-downgrade live providers to mock when keys missing
  if (p === 'stripe' && !stripeLiveReady()) p = 'stripe_mock';
  if (p === 'momo' && !momoLiveReady()) p = 'momo_mock';
  if (!PROVIDERS.includes(p)) return 'workhub_mock';
  return p;
}

function sessionPrefix(provider) {
  if (provider === 'stripe' || provider === 'stripe_mock') {
    return stripeLiveReady() && provider === 'stripe' ? 'cs_live_' : 'cs_test_';
  }
  if (provider === 'momo' || provider === 'momo_mock') return 'momo_';
  return 'cs_';
}

function makeSessionId(provider) {
  return `${sessionPrefix(provider)}${crypto.randomBytes(16).toString('hex')}`;
}

function providerCheckoutUrl(provider, sessionId) {
  // Live Stripe/MoMo: still return hosted WorkHub page until SDK wired;
  // metadata documents readiness for ops.
  if (provider === 'stripe' || provider === 'stripe_mock') {
    return `/payment/gateway/${sessionId}?provider=${provider}`;
  }
  if (provider === 'momo' || provider === 'momo_mock') {
    return `/payment/gateway/${sessionId}?provider=${provider}`;
  }
  return `/payment/gateway/${sessionId}`;
}

/**
 * Create live checkout session via provider HTTP API when keys present.
 * Returns null to fall back to local mock session storage.
 */
async function tryCreateLiveSession({ provider, amount, currency, bookingId, successUrl, cancelUrl }) {
  if (provider === 'stripe' && stripeLiveReady()) {
    // Stripe Checkout Sessions API (no SDK dependency)
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', successUrl || `${process.env.PUBLIC_BASE_URL || ''}/payment/gateway/{CHECKOUT_SESSION_ID}`);
    params.set('cancel_url', cancelUrl || `${process.env.PUBLIC_BASE_URL || ''}/payment`);
    params.set('client_reference_id', String(bookingId));
    params.set('line_items[0][price_data][currency]', (currency || 'vnd').toLowerCase());
    params.set('line_items[0][price_data][product_data][name]', `WorkHub booking ${bookingId}`);
    params.set('line_items[0][price_data][unit_amount]', String(Math.round(amount)));
    params.set('line_items[0][quantity]', '1');
    const res = await globalThis.fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    if (!res.ok) {
      const t = await res.text();
      const err = new Error(`Stripe create session failed: ${res.status} ${t}`);
      err.statusCode = 502;
      throw err;
    }
    const data = await res.json();
    return {
      sessionId: data.id,
      checkoutUrl: data.url,
      providerRef: data.id,
      live: true,
    };
  }
  if (provider === 'momo' && momoLiveReady()) {
    // MoMo create payment — signature HMAC; returns payUrl
    const partnerCode = process.env.MOMO_PARTNER_CODE;
    const accessKey = process.env.MOMO_ACCESS_KEY;
    const secretKey = process.env.MOMO_SECRET_KEY;
    const orderId = `momo_${bookingId}_${Date.now()}`;
    const requestId = orderId;
    const orderInfo = `WorkHub ${bookingId}`;
    const redirectUrl = process.env.MOMO_REDIRECT_URL || `${process.env.PUBLIC_BASE_URL || ''}/payment`;
    const ipnUrl = process.env.MOMO_IPN_URL || `${process.env.PUBLIC_BASE_URL || ''}/api/gateway/webhook?provider=momo`;
    const requestType = 'captureWallet';
    const extraData = '';
    const raw = `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${partnerCode}&redirectUrl=${redirectUrl}&requestId=${requestId}&requestType=${requestType}`;
    const signature = crypto.createHmac('sha256', secretKey).update(raw).digest('hex');
    const body = {
      partnerCode,
      accessKey,
      requestId,
      amount: String(amount),
      orderId,
      orderInfo,
      redirectUrl,
      ipnUrl,
      extraData,
      requestType,
      signature,
      lang: 'vi',
    };
    const endpoint =
      process.env.MOMO_ENDPOINT || 'https://test-payment.momo.vn/v2/gateway/api/create';
    const res = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      const err = new Error(`MoMo create failed: ${res.status} ${t}`);
      err.statusCode = 502;
      throw err;
    }
    const data = await res.json();
    if (!data.payUrl) {
      const err = new Error(data.message || 'MoMo payUrl missing');
      err.statusCode = 502;
      throw err;
    }
    return {
      sessionId: orderId,
      checkoutUrl: data.payUrl,
      providerRef: data.transId || orderId,
      live: true,
    };
  }
  return null;
}

function webhookSecretFor(provider) {
  if (provider === 'stripe' || provider === 'stripe_mock') {
    return process.env.STRIPE_WEBHOOK_SECRET || process.env.GATEWAY_WEBHOOK_SECRET || env.JWT_SECRET;
  }
  if (provider === 'momo' || provider === 'momo_mock') {
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
  return [
    {
      id: 'workhub_mock',
      mock: true,
      liveReady: true,
      label: 'WorkHub mock gateway',
    },
    {
      id: 'stripe_mock',
      mock: true,
      liveReady: true,
      label: 'Stripe (mock hosted)',
    },
    {
      id: 'momo_mock',
      mock: true,
      liveReady: true,
      label: 'MoMo (mock hosted)',
    },
    {
      id: 'stripe',
      mock: false,
      liveReady: stripeLiveReady(),
      label: 'Stripe Checkout (live keys)',
    },
    {
      id: 'momo',
      mock: false,
      liveReady: momoLiveReady(),
      label: 'MoMo e-wallet (live keys)',
    },
  ];
}

module.exports = {
  PROVIDERS,
  activeProvider,
  makeSessionId,
  providerCheckoutUrl,
  tryCreateLiveSession,
  signForProvider,
  verifyForProvider,
  normalizeWebhookEvent,
  listProviders,
  webhookSecretFor,
  stripeLiveReady,
  momoLiveReady,
};
