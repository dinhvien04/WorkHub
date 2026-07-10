"use strict";

/**
 * Payment provider adapters — hosted checkout only (never card/CVV).
 * Production never falls back to mock; never accepts client provider override.
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

/**
 * Resolve active provider. Client-requested provider is IGNORED in production.
 * Never auto-downgrade live → mock in production.
 */
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

  // Dev/test: may use mock
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

async function tryCreateLiveSession({
  provider,
  amount,
  currency,
  bookingId,
  successUrl,
  cancelUrl,
}) {
  if (provider === "stripe" && stripeLiveReady()) {
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set(
      "success_url",
      successUrl ||
        `${env.PUBLIC_BASE_URL || ""}/payment/gateway/{CHECKOUT_SESSION_ID}`,
    );
    params.set(
      "cancel_url",
      cancelUrl || `${env.PUBLIC_BASE_URL || ""}/payment`,
    );
    params.set("client_reference_id", String(bookingId));
    params.set(
      "line_items[0][price_data][currency]",
      (currency || "vnd").toLowerCase(),
    );
    params.set(
      "line_items[0][price_data][product_data][name]",
      `WorkHub booking ${bookingId}`,
    );
    params.set(
      "line_items[0][price_data][unit_amount]",
      String(Math.round(amount)),
    );
    params.set("line_items[0][quantity]", "1");
    const res = await globalThis.fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    if (!res.ok) {
      const err = new Error("Stripe session create failed");
      err.statusCode = 502;
      err.isOperational = true;
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
  // workhub_mock — never use JWT_SECRET as fallback in production (validated at startup)
  return (
    process.env.GATEWAY_WEBHOOK_SECRET ||
    (env.isProduction ? "" : env.JWT_SECRET)
  );
}

function signForProvider(provider, body) {
  const secret = webhookSecretFor(provider);
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const v1 = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${raw}`)
    .digest("hex");
  return `t=${ts},v1=${v1}`;
}

function verifyForProvider(provider, rawBody, signature, _event) {
  if (!signature) return false;
  const secret = webhookSecretFor(provider);
  if (!secret) return false;
  const raw = typeof rawBody === "string" ? rawBody : String(rawBody || "");

  // Stripe-style t=,v1=
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

  // MoMo: prefer official construct when stripe package present for stripe;
  // MoMo IPN canonical: partnerCode+orderId+requestId+amount+orderInfo+orderType+transId+resultCode+message+payType+responseTime+extraData
  if (provider === "momo" || provider === "momo_mock") {
    try {
      const parsed = JSON.parse(raw);
      // Require core MoMo identifiers when present in payload
      if (parsed.partnerCode && process.env.MOMO_PARTNER_CODE) {
        if (String(parsed.partnerCode) !== String(process.env.MOMO_PARTNER_CODE)) {
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
          `&orderInfo=${parsed.orderInfo ?? ""}` +
          `&orderType=${parsed.orderType ?? ""}` +
          `&partnerCode=${parsed.partnerCode ?? ""}` +
          `&payType=${parsed.payType ?? ""}` +
          `&requestId=${parsed.requestId ?? ""}` +
          `&responseTime=${parsed.responseTime ?? ""}` +
          `&resultCode=${parsed.resultCode ?? ""}` +
          `&transId=${parsed.transId ?? ""}`;
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
      /* fall through to raw body HMAC for mocks */
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

  // Stripe live: try official SDK constructEvent when stripe package is installed
  if (provider === "stripe" && process.env.STRIPE_WEBHOOK_SECRET) {
    try {
      let Stripe;
      try {
        Stripe = require("stripe");
      } catch {
        Stripe = null;
      }
      if (Stripe) {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_x");
        stripe.webhooks.constructEvent(
          raw,
          signature,
          process.env.STRIPE_WEBHOOK_SECRET,
        );
        return true;
      }
    } catch {
      // fall through — t=,v1= path already handled above
    }
  }

  // Raw hex HMAC
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
      sessionId: obj.id || event.sessionId || obj.client_reference_id,
      amount: obj.amount_total || event.amount,
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

/** Test/helper: verify Stripe-style t=,v1= with explicit secret */
function verifyStripeSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const raw = typeof rawBody === "string" ? rawBody : String(rawBody || "");
  if (!String(signature).includes("v1=")) return false;
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

/** Test/helper: MoMo IPN field signature */
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
};
