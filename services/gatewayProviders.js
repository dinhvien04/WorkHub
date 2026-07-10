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

/**
 * Stripe-Signature header: t=timestamp,v1=hmac_sha256(secret, `${t}.${rawBody}`)
 */
function verifyStripeSignature(rawBody, stripeSignatureHeader, secret) {
  if (!stripeSignatureHeader || !secret) return false;
  const parts = String(stripeSignatureHeader).split(',').map((p) => p.trim());
  const map = {};
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k && v) map[k] = v;
  }
  const t = map.t;
  const v1 = map.v1;
  if (!t || !v1) {
    // allow plain HMAC for mock tests
    return verifyPlainHmac(rawBody, stripeSignatureHeader, secret);
  }
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (Number.isFinite(age) && age > 60 * 5) return false; // 5 min skew
  const signed = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(signed));
  } catch {
    return false;
  }
}

function verifyPlainHmac(rawBody, signature, secret) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(String(signature)), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * MoMo IPN signature: HMAC SHA256 over sorted accessKey... fields (simplified).
 */
function verifyMomoIpn(event, secret) {
  if (!event || !secret) return false;
  const accessKey = process.env.MOMO_ACCESS_KEY || '';
  const amount = event.amount ?? '';
  const extraData = event.extraData ?? '';
  const message = event.message ?? '';
  const orderId = event.orderId ?? '';
  const orderInfo = event.orderInfo ?? '';
  const orderType = event.orderType ?? '';
  const partnerCode = event.partnerCode ?? process.env.MOMO_PARTNER_CODE ?? '';
  const payType = event.payType ?? '';
  const requestId = event.requestId ?? '';
  const responseTime = event.responseTime ?? '';
  const resultCode = event.resultCode ?? '';
  const transId = event.transId ?? '';
  const raw =
    `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&message=${message}` +
    `&orderId=${orderId}&orderInfo=${orderInfo}&orderType=${orderType}&partnerCode=${partnerCode}` +
    `&payType=${payType}&requestId=${requestId}&responseTime=${responseTime}` +
    `&resultCode=${resultCode}&transId=${transId}`;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const sig = event.signature || '';
  try {
    return crypto.timingSafeEqual(Buffer.from(String(sig)), Buffer.from(expected));
  } catch {
    return false;
  }
}

function verifyForProvider(provider, rawBody, signature, event) {
  if (provider === 'stripe' || provider === 'stripe_mock') {
    const secret = webhookSecretFor(provider);
    // Live Stripe uses Stripe-Signature format; mock uses plain HMAC
    if (provider === 'stripe' && String(signature || '').includes('t=') && String(signature).includes('v1=')) {
      return verifyStripeSignature(rawBody, signature, secret);
    }
    return verifyPlainHmac(rawBody, signature, secret);
  }
  if (provider === 'momo' || provider === 'momo_mock') {
    const secret = webhookSecretFor(provider);
    if (provider === 'momo' && event && event.signature) {
      return verifyMomoIpn(event, secret);
    }
    return verifyPlainHmac(rawBody, signature, secret);
  }
  if (!signature) return false;
  return verifyPlainHmac(rawBody, signature, webhookSecretFor(provider));
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
  verifyStripeSignature,
  verifyMomoIpn,
  normalizeWebhookEvent,
  listProviders,
  webhookSecretFor,
  stripeLiveReady,
  momoLiveReady,
};
