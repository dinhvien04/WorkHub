"use strict";

const crypto = require("crypto");
const GatewayPayment = require("../models/GatewayPayment");
const Booking = require("../models/Booking");
const PaymentHistory = require("../models/Payment_History");
const WebhookEvent = require("../models/WebhookEvent");
const ledgerService = require("./ledgerService");
const { notifyUser } = require("./notificationService");
const env = require("../config/env");
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} = require("../utils/errors");
const providers = require("./gatewayProviders");

function webhookSecret() {
  // Never fall back to JWT in production (env validates at startup)
  if (env.isProduction) {
    return process.env.GATEWAY_WEBHOOK_SECRET || "";
  }
  return process.env.GATEWAY_WEBHOOK_SECRET || env.JWT_SECRET;
}

function signPayload(body, provider = "workhub_mock") {
  return providers.signForProvider(provider, body);
}

function verifySignature(
  rawBody,
  signature,
  provider = "workhub_mock",
  event = null,
) {
  return providers.verifyForProvider(provider, rawBody, signature, event);
}

/**
 * Sum successful payments minus refunded amounts for a booking.
 */
async function getPaidNet(bookingId) {
  const payments = await PaymentHistory.find({
    BookingID: bookingId,
    Status: { $in: ["successful", "partially_refunded"] },
  }).lean();
  let paid = 0;
  for (const p of payments) {
    const refunded = Number(p.RefundedAmount || 0);
    paid += Math.max(0, Number(p.Amount || 0) - refunded);
  }
  return paid;
}

/**
 * Server-side amount from paymentType. Client must not send amount/provider.
 */
async function resolveCheckoutAmount(booking, paymentType) {
  const type = String(paymentType || "deposit").toLowerCase();
  const allowed = new Set(["deposit", "remaining_balance", "full_payment"]);
  if (!allowed.has(type)) {
    throw new ValidationError(
      "paymentType không hợp lệ (deposit|remaining_balance|full_payment).",
    );
  }

  const total = Math.round(Number(booking.TotalAmount) || 0);
  const paid = await getPaidNet(booking._id);
  const remaining = Math.max(0, total - paid);

  if (remaining <= 0) {
    throw new ValidationError("Booking đã thanh toán đủ.");
  }

  let amount;
  if (type === "full_payment") {
    if (paid > 0) {
      throw new ValidationError(
        "full_payment chỉ khi chưa có thanh toán thành công.",
      );
    }
    amount = total;
  } else if (type === "remaining_balance") {
    amount = remaining;
  } else {
    // deposit: 30% of total, capped by remaining
    const dep =
      booking.DepositAmount > 0
        ? Math.round(Number(booking.DepositAmount))
        : Math.round(total * 0.3);
    amount = Math.min(dep, remaining);
  }

  amount = Math.round(amount);
  if (amount <= 0) throw new ValidationError("Số tiền checkout không hợp lệ.");
  if (paid + amount > total) {
    throw new ValidationError("Số tiền sẽ vượt tổng booking.");
  }
  return { amount, paymentType: type, paid, remaining, total };
}

/**
 * Create hosted-checkout session. Amount + provider are server-controlled.
 */
async function createCheckoutSession({
  customerId,
  bookingId,
  paymentType = "deposit",
  amount: _ignoredAmount,
  idempotencyKey,
  provider: _ignoredProvider,
}) {
  const booking = await Booking.findOne({
    _id: bookingId,
    CustomerID: customerId,
  });
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");

  const terminal = new Set([
    "cancelled",
    "rejected",
    "expired",
    "completed",
    "no_show",
  ]);
  if (terminal.has(booking.Status)) {
    throw new ValidationError(
      `Không thể thanh toán booking ở trạng thái ${booking.Status}.`,
    );
  }

  const { amount, paymentType: resolvedType } = await resolveCheckoutAmount(
    booking,
    paymentType,
  );
  const provider = providers.activeProvider(); // ignore client provider

  // Scoped idempotency: owner + booking + stage
  const scopedKey =
    idempotencyKey ||
    `checkout:${customerId}:${bookingId}:${resolvedType}:${amount}`;

  const existing = await GatewayPayment.findOne({
    IdempotencyKey: scopedKey,
    Status: { $in: ["created", "redirected", "pending"] },
  });
  if (existing) {
    return {
      session: existing,
      checkoutUrl: providers.providerCheckoutUrl(
        existing.Provider,
        existing.SessionId,
      ),
      provider: existing.Provider,
      duplicate: true,
    };
  }

  const base = env.PUBLIC_BASE_URL || "";
  let live = null;
  try {
    live = await providers.tryCreateLiveSession({
      provider,
      amount,
      currency: "VND",
      bookingId,
      successUrl: base
        ? `${base}/payment?bookingId=${bookingId}&paid=1`
        : undefined,
      cancelUrl: base ? `${base}/payment?bookingId=${bookingId}` : undefined,
    });
  } catch (err) {
    if (err.statusCode === 502 || err.statusCode === 503) throw err;
    live = null;
  }

  const sessionId = live?.sessionId || providers.makeSessionId(provider);
  try {
    const session = await GatewayPayment.create({
      BookingID: bookingId,
      CustomerID: customerId,
      HostID: booking.HostID,
      Amount: amount,
      SessionId: sessionId,
      Status: live ? "redirected" : "created",
      IdempotencyKey: scopedKey,
      Provider: provider,
      ProviderRef: live?.providerRef || "",
      Meta: { paymentType: resolvedType },
    });
    return {
      session,
      checkoutUrl:
        live?.checkoutUrl || providers.providerCheckoutUrl(provider, sessionId),
      provider,
      amount,
      paymentType: resolvedType,
      live: Boolean(live?.live),
      duplicate: false,
    };
  } catch (err) {
    if (err.code === 11000) {
      const again = await GatewayPayment.findOne({ IdempotencyKey: scopedKey });
      if (again) {
        return {
          session: again,
          checkoutUrl: providers.providerCheckoutUrl(
            again.Provider,
            again.SessionId,
          ),
          provider: again.Provider,
          amount: again.Amount,
          duplicate: true,
        };
      }
    }
    throw err;
  }
}

/**
 * Signed webhook processing with durable inbox + idempotency.
 * rawBody must be exact bytes/string from the request (not JSON.stringify).
 */
async function handleWebhook({
  rawBody,
  signature,
  event,
  provider: providerHint,
}) {
  const raw =
    typeof rawBody === "string"
      ? rawBody
      : Buffer.isBuffer(rawBody)
        ? rawBody.toString("utf8")
        : "";
  if (!raw) throw new ValidationError("Empty webhook body");

  const payloadHash = crypto.createHash("sha256").update(raw).digest("hex");
  let parsed = event;
  if (!parsed) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ValidationError("Invalid webhook JSON");
    }
  }

  const normalizedPeek = providers.normalizeWebhookEvent(
    providerHint || "workhub_mock",
    parsed,
  );
  let provider =
    providerHint || parsed?.provider || env.PAYMENT_PROVIDER || "workhub_mock";
  if (normalizedPeek?.sessionId) {
    const peek = await GatewayPayment.findOne({
      SessionId: normalizedPeek.sessionId,
    })
      .select("Provider")
      .lean();
    if (peek?.Provider) provider = peek.Provider;
  }

  if (!verifySignature(raw, signature, provider, parsed)) {
    // No JWT/mock secret fallback that accepts forged live webhooks
    if (
      providers.mockAllowed() &&
      verifySignature(raw, signature, "workhub_mock", parsed)
    ) {
      provider = "workhub_mock";
    } else {
      const err = new Error("Invalid webhook signature");
      err.statusCode = 401;
      err.code = "UNAUTHORIZED";
      err.isOperational = true;
      throw err;
    }
  }

  const normalized =
    providers.normalizeWebhookEvent(provider, parsed) || parsed;
  const providerEventId = String(
    normalized.id || parsed.id || payloadHash,
  ).slice(0, 200);

  // Durable inbox — unique (Provider, ProviderEventID)
  let inbox;
  try {
    inbox = await WebhookEvent.create({
      Provider: provider,
      ProviderEventID: providerEventId,
      PayloadHash: payloadHash,
      ProcessingStatus: "processing",
      ReceivedAt: new Date(),
    });
  } catch (err) {
    if (err.code === 11000) {
      const existing = await WebhookEvent.findOne({
        Provider: provider,
        ProviderEventID: providerEventId,
      });
      if (existing?.ProcessingStatus === "processed") {
        return { ok: true, duplicate: true };
      }
      // Recover stuck processing
      inbox = existing;
    } else {
      throw err;
    }
  }

  try {
    const sessionId = normalized.sessionId;
    if (!sessionId) throw new ValidationError("Missing sessionId");

    const session = await GatewayPayment.findOne({ SessionId: sessionId });
    if (!session) throw new NotFoundError("Session not found");

    // Amount consistency when provided
    if (
      normalized.amount != null &&
      Math.round(Number(normalized.amount)) !== session.Amount
    ) {
      throw new ValidationError("Webhook amount mismatch.");
    }

    if (session.Status === "succeeded") {
      // Ensure payment + ledger exist (recover partial failure)
      await ensurePaymentAndLedger(session);
      if (inbox) {
        inbox.ProcessingStatus = "processed";
        inbox.ProcessedAt = new Date();
        await inbox.save();
      }
      return { ok: true, duplicate: true, session };
    }

    const okTypes = new Set([
      "checkout.session.completed",
      "payment.succeeded",
      "payment.success",
    ]);
    if (!okTypes.has(normalized.type)) {
      session.Status = "failed";
      await session.save();
      if (inbox) {
        inbox.ProcessingStatus = "processed";
        inbox.ProcessedAt = new Date();
        await inbox.save();
      }
      return { ok: true, session };
    }

    // CAS session -> succeeded
    const cas = await GatewayPayment.findOneAndUpdate(
      { _id: session._id, Status: { $ne: "succeeded" } },
      {
        $set: {
          Status: "succeeded",
          WebhookReceivedAt: new Date(),
          ProviderRef: normalized.id || parsed.id || `evt_${Date.now()}`,
        },
      },
      { new: true },
    );
    if (!cas) {
      await ensurePaymentAndLedger(session);
      return { ok: true, duplicate: true, session };
    }

    const { payment } = await ensurePaymentAndLedger(cas);

    const booking = await Booking.findById(cas.BookingID);
    if (
      booking &&
      ["pending", "hold", "awaiting_payment", "payment_under_review"].includes(
        booking.Status,
      )
    ) {
      booking.Status = "payment_under_review";
      await booking.save();
    }

    await notifyUser({
      userId: cas.HostID,
      title: "Thanh toán gateway thành công",
      body: `${cas.Amount.toLocaleString("vi-VN")}đ`,
      type: "payment",
      entityType: "PaymentHistory",
      entityId: payment._id,
      link: "/host/payments",
    });

    if (inbox) {
      inbox.ProcessingStatus = "processed";
      inbox.ProcessedAt = new Date();
      await inbox.save();
    }

    return { ok: true, session: cas, payment, duplicate: false };
  } catch (err) {
    if (inbox) {
      inbox.ProcessingStatus = "failed";
      inbox.FailureReason = String(err.message || "error").slice(0, 500);
      await inbox.save();
    }
    throw err;
  }
}

async function ensurePaymentAndLedger(session) {
  let payment = await PaymentHistory.findOne({
    TransactionCode: `GW-${session.SessionId}`,
  });
  if (!payment) {
    const booking = await Booking.findById(session.BookingID)
      .select("TotalAmount")
      .lean();
    payment = await PaymentHistory.create({
      BookingID: session.BookingID,
      CustomerID: session.CustomerID,
      HostID: session.HostID,
      TransactionCode: `GW-${session.SessionId}`,
      Amount: session.Amount,
      PaymentType:
        session.Amount >= (booking?.TotalAmount || session.Amount)
          ? "full_payment"
          : "deposit",
      PaymentMethod: "e_wallet",
      Status: "successful",
      PaidAt: new Date(),
      VerifiedAt: new Date(),
      IdempotencyKey: `gw-${session.SessionId}`,
      RefundedAmount: 0,
    });
  }

  await ledgerService.postEntry({
    hostId: session.HostID,
    customerId: session.CustomerID,
    bookingId: session.BookingID,
    paymentId: payment._id,
    type: "payment",
    amount: session.Amount,
    direction: "credit",
    description: `Gateway ${session.SessionId}`,
    idempotencyKey: `ledger-gw-${session.SessionId}`,
  });

  return { payment };
}

async function getSession(sessionId) {
  const session = await GatewayPayment.findOne({ SessionId: sessionId }).lean();
  if (!session) throw new NotFoundError("Session not found");
  return session;
}

/**
 * Owner-scoped DTO — never return raw GatewayPayment / provider internals.
 */
async function getSessionForCustomer(sessionId, customerId) {
  const session = await GatewayPayment.findOne({
    SessionId: sessionId,
    CustomerID: customerId,
  }).lean();
  // 404 (not 403) to avoid session existence oracle across customers
  if (!session) throw new NotFoundError("Session not found");
  return {
    status: session.Status,
    amount: session.Amount,
    currency: session.Currency || "VND",
    paymentType:
      session.PaymentType ||
      session.Meta?.paymentType ||
      session.Type ||
      null,
    bookingId: session.BookingID ? String(session.BookingID) : null,
    createdAt: session.createdAt || null,
  };
}

/** Dev/test only — not mounted in production */
async function mockCompleteSession(sessionId, customerId) {
  if (!env.ALLOW_MOCK_COMPLETE || env.isProduction) {
    const err = new Error("Mock complete disabled");
    err.statusCode = 404;
    err.isOperational = true;
    throw err;
  }
  const session = await GatewayPayment.findOne({ SessionId: sessionId });
  if (!session) throw new NotFoundError("Session not found");
  if (String(session.CustomerID) !== String(customerId)) {
    throw new ForbiddenError("Không phải session của bạn.");
  }
  const event = {
    type: "checkout.session.completed",
    id: `evt_mock_${Date.now()}`,
    sessionId,
  };
  const raw = JSON.stringify(event);
  const signature = signPayload(raw, session.Provider || "workhub_mock");
  return handleWebhook({
    rawBody: raw,
    signature,
    event,
    provider: session.Provider || "workhub_mock",
  });
}

async function listProviders() {
  return providers.listProviders();
}

module.exports = {
  createCheckoutSession,
  handleWebhook,
  getSession,
  getSessionForCustomer,
  mockCompleteSession,
  signPayload,
  verifySignature,
  listProviders,
  getPaidNet,
  resolveCheckoutAmount,
  webhookSecret,
};
