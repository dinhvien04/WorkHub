"use strict";

/**
 * Payment provider adapters — hosted checkout only (never card/CVV).
 * Live Stripe verification uses official stripe package only (no HMAC fallback).
 */
const crypto = require("crypto");
const env = require("../config/env");

const MOCK_PROVIDERS = new Set(["workhub_mock", "stripe_mock", "momo_mock"]);
const LIVE_PROVIDERS = new Set(["stripe", "momo"]);
const ALL_PROVIDERS = [
  "workhub_mock",
  "stripe_mock",
  "momo_mock",
  "stripe",
  "momo",
];

function stripeLiveReady() {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_SECRET_KEY.startsWith("sk_"),
  );
}

function momoLiveReady() {
  return Boolean(
    process.env.MOMO_PARTNER_CODE &&
      process.env.MOMO_ACCESS_KEY &&
      process.env.MOMO_SECRET_KEY,
  );
}

function mockAllowed() {
  return env.ALLOW_MOCK_PAYMENT_PROVIDER && !env.isProduction;
}

function activeProvider(requested) {
  const fromEnv = String(
    env.PAYMENT_PROVIDER || process.env.PAYMENT_PROVIDER || "",
  ).toLowerCase();

  if (env.isProduction) {
    let p = fromEnv;
    if (!p || MOCK_PROVIDERS.has(p)) {
      const err = new Error("Payment provider misconfigured for production.");
      err.statusCode = 503;
      err.code = "PAYMENT_MISCONFIGURED";
      err.isOperational = true;
      throw err;
    }
    if (p === "stripe" && !stripeLiveReady()) {
      const err = new Error("Stripe credentials missing.");
      err.statusCode = 503;
      err.isOperational = true;
      throw err;
    }
    if (p === "momo" && !momoLiveReady()) {
      const err = new Error("MoMo credentials missing.");
      err.statusCode = 503;
      err.isOperational = true;
      throw err;
    }
    return p;
  }

  let p = String(requested || fromEnv || "workhub_mock").toLowerCase();
  if (LIVE_PROVIDERS.has(p)) {
    if (p === "stripe" && !stripeLiveReady()) {
      if (!mockAllowed()) {
        throw Object.assign(new Error("Stripe not ready and mock disabled."), {
          statusCode: 503,
          isOperational: true,
        });
      }
      p = "stripe_mock";
    }
    if (p === "momo" && !momoLiveReady()) {
      if (!mockAllowed()) {
        throw Object.assign(new Error("MoMo not ready and mock disabled."), {
          statusCode: 503,
          isOperational: true,
        });
      }
      p = "momo_mock";
    }
  }
  if (MOCK_PROVIDERS.has(p) && !mockAllowed()) {
    throw Object.assign(new Error("Mock payment provider disabled."), {
      statusCode: 403,
      isOperational: true,
    });
  }
  if (!ALL_PROVIDERS.includes(p))
    return mockAllowed() ? "workhub_mock" : fromEnv || "stripe";
  return p;
}

function sessionPrefix(provider) {
  if (provider === "stripe" || provider === "stripe_mock") {
    return stripeLiveReady() && provider === "stripe" ? "cs_live_" : "cs_test_";
  }
  if (provider === "momo" || provider === "momo_mock") return "momo_";
  return "cs_";
}

function makeSessionId(provider) {
  return `${sessionPrefix(provider)}${crypto.randomBytes(16).toString("hex")}`;
}

function providerCheckoutUrl(provider, sessionId) {
  if (provider === "stripe" || provider === "stripe_mock") {
    return `/payment/gateway/${sessionId}?provider=${provider}`;
  }
  if (provider === "momo" || provider === "momo_mock") {
    return `/payment/gateway/${sessionId}?provider=${provider}`;
  }
  return `/payment/gateway/${sessionId}`;
}

function getStripeClient() {
  const Stripe = require("stripe");
  return new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder", {
    apiVersion: "2024-11-20.acacia",
  });
}

async function tryCreateLiveSession({
  provider,
  amount,
  currency,
  bookingId,
  successUrl,
  cancelUrl,
  idempotencyKey,
}) {
  if (provider === "stripe" && stripeLiveReady()) {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        success_url:
          successUrl ||
          `${env.PUBLIC_BASE_URL || ""}/payment/gateway/{CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl || `${env.PUBLIC_BASE_URL || ""}/payment`,
        client_reference_id: String(bookingId),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: (currency || "vnd").toLowerCase(),
              unit_amount: Math.round(amount),
              product_data: {
                name: `WorkHub booking ${bookingId}`,
              },
            },
          },
        ],
        metadata: {
          bookingId: String(bookingId),
        },
      },
      idempotencyKey
        ? { idempotencyKey: String(idempotencyKey).slice(0, 255) }
        : undefined,
    );
    return {
      sessionId: session.id,
      checkoutUrl: session.url,
      providerRef: session.id,
      live: true,
    };
  }
  return null;
}

function webhookSecretFor(provider) {
  if (provider === "stripe" || provider === "stripe_mock") {
    return (
      process.env.STRIPE_WEBHOOK_SECRET ||
      process.env.GATEWAY_WEBHOOK_SECRET ||
      ""
    );
  }
  if (provider === "momo" || provider === "momo_mock") {
    return (
      process.env.MOMO_SECRET_KEY || process.env.GATEWAY_WEBHOOK_SECRET || ""
    );
  }
  return (
    process.env.GATEWAY_WEBHOOK_SECRET ||
    (env.isProduction ? "" : env.JWT_SECRET)
  );
}

/**
 * Mock / non-Stripe signing (tests + mock adapters only).
 */
function signForProvider(provider, body) {
  if (provider === "stripe" && env.isProduction) {
    throw new Error("Cannot mock-sign live Stripe webhooks in production.");
  }
  const secret = webhookSecretFor(provider);
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const v1 = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${raw}`)
    .digest("hex");
  return `t=${ts},v1=${v1}`;
}

/**
 * Live Stripe: official constructEvent only — no generic HMAC fallback.
 * Mock providers: home-grown t=,v1= HMAC (cannot authenticate live stripe).
 */
function verifyForProvider(provider, rawBody, signature, _event) {
  if (!signature) return false;
  const raw = typeof rawBody === "string" ? rawBody : String(rawBody || "");

  // LIVE STRIPE — official SDK only
  if (provider === "stripe") {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return false;
    try {
      const stripe = getStripeClient();
      stripe.webhooks.constructEvent(
        Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(raw, "utf8"),
        signature,
        secret,
      );
      return true;
    } catch {
      return false;
    }
  }

  // stripe_mock / workhub_mock / momo — mock path (never used for live stripe)
  const secret = webhookSecretFor(provider);
  if (!secret) return false;

  if (provider === "momo" || provider === "momo_mock") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.partnerCode && process.env.MOMO_PARTNER_CODE) {
        if (
          String(parsed.partnerCode) !== String(process.env.MOMO_PARTNER_CODE)
        ) {
          return false;
        }
      }
      if (
        parsed.partnerCode != null &&
        parsed.orderId != null &&
        parsed.requestId != null
      ) {
        const accessKey = process.env.MOMO_ACCESS_KEY || "";
        const rawSig =
          `accessKey=${accessKey}` +
          `&amount=${parsed.amount ?? ""}` +
          `&extraData=${parsed.extraData ?? ""}` +
          `&message=${parsed.message ?? ""}` +
          `&orderId=${parsed.orderId ?? ""}` +
          `&orderInfo=${parsed.orderInfo || ""}` +
          `&orderType=${parsed.orderType || ""}` +
          `&partnerCode=${parsed.partnerCode || ""}` +
          `&payType=${parsed.payType || ""}` +
          `&requestId=${parsed.requestId || ""}` +
          `&responseTime=${parsed.responseTime || ""}` +
          `&resultCode=${parsed.resultCode || ""}` +
          `&transId=${parsed.transId || ""}`;
        const expected = crypto
          .createHmac("sha256", secret)
          .update(rawSig)
          .digest("hex");
        const provided = String(
          signature || parsed.signature || "",
        ).toLowerCase();
        try {
          return crypto.timingSafeEqual(
            Buffer.from(provided),
            Buffer.from(expected),
          );
        } catch {
          return false;
        }
      }
    } catch {
      /* fall through */
    }
    const expected = crypto
      .createHmac("sha256", secret)
      .update(raw)
      .digest("hex");
    try {
      return crypto.timingSafeEqual(
        Buffer.from(String(signature)),
        Buffer.from(expected),
      );
    } catch {
      return false;
    }
  }

  // Mock Stripe-style t=,v1= (stripe_mock / workhub_mock only)
  if (String(signature).includes("v1=")) {
    const parts = Object.fromEntries(
      String(signature)
        .split(",")
        .map((p) => p.split("="))
        .filter((x) => x.length === 2),
    );
    const ts = parts.t;
    const v1 = parts.v1;
    if (!ts || !v1) return false;
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
    if (age > 300) return false;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${ts}.${raw}`)
      .digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(raw)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(String(signature)),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

function normalizeWebhookEvent(provider, event) {
  if (!event || typeof event !== "object") return null;
  if (provider === "stripe" || provider === "stripe_mock") {
    const obj = event.data?.object || event;
    return {
      type: event.type || "checkout.session.completed",
      id: event.id || obj.id,
      sessionId:
        obj.object === "checkout.session"
          ? obj.id
          : obj.id || event.sessionId || obj.client_reference_id,
      amount: obj.amount_total || event.amount,
      currency: obj.currency || event.currency,
      paymentStatus: obj.payment_status || event.payment_status,
      livemode: event.livemode,
    };
  }
  if (provider === "momo" || provider === "momo_mock") {
    return {
      type: event.resultCode === 0 ? "payment.succeeded" : "payment.failed",
      id: event.transId || event.requestId,
      sessionId: event.orderId || event.sessionId,
      amount: event.amount,
    };
  }
  return {
    type: event.type || "checkout.session.completed",
    id: event.id || event.eventId,
    sessionId: event.sessionId,
    amount: event.amount,
  };
}

function listProviders() {
  const items = [];
  if (mockAllowed()) {
    items.push({ id: "workhub_mock", name: "WorkHub Mock", live: false });
  }
  if (stripeLiveReady())
    items.push({ id: "stripe", name: "Stripe", live: true });
  else if (mockAllowed())
    items.push({ id: "stripe_mock", name: "Stripe (mock)", live: false });
  if (momoLiveReady()) items.push({ id: "momo", name: "MoMo", live: true });
  else if (mockAllowed())
    items.push({ id: "momo_mock", name: "MoMo (mock)", live: false });
  return items;
}

function verifyStripeSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const Stripe = require("stripe");
    const stripe = new Stripe("sk_test_placeholder");
    stripe.webhooks.constructEvent(
      Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8"),
      signature,
      secret,
    );
    return true;
  } catch {
    return false;
  }
}

function verifyMomoIpn(event, secret) {
  if (!event || !secret) return false;
  const accessKey = process.env.MOMO_ACCESS_KEY || "";
  const raw =
    `accessKey=${accessKey}&amount=${event.amount}&extraData=${event.extraData || ""}&message=${event.message || ""}` +
    `&orderId=${event.orderId}&orderInfo=${event.orderInfo || ""}&orderType=${event.orderType || ""}&partnerCode=${event.partnerCode || ""}` +
    `&payType=${event.payType || ""}&requestId=${event.requestId}&responseTime=${event.responseTime || ""}` +
    `&resultCode=${event.resultCode}&transId=${event.transId}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(raw)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(String(event.signature || "")),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

module.exports = {
  PROVIDERS: ALL_PROVIDERS,
  activeProvider,
  makeSessionId,
  providerCheckoutUrl,
  tryCreateLiveSession,
  signForProvider,
  verifyForProvider,
  normalizeWebhookEvent,
  listProviders,
  stripeLiveReady,
  momoLiveReady,
  mockAllowed,
  webhookSecretFor,
  verifyStripeSignature,
  verifyMomoIpn,
  getStripeClient,
};
