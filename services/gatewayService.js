"use strict";

const crypto = require("crypto");
const GatewayPayment = require("../models/GatewayPayment");
const CheckoutOperation = require("../models/CheckoutOperation");
const Booking = require("../models/Booking");
const PaymentHistory = require("../models/Payment_History");
const WebhookEvent = require("../models/WebhookEvent");
const ledgerService = require("./ledgerService");
const outboxService = require("./outboxService");
const env = require("../config/env");
const { withTransaction } = require("../utils/mongoTransaction");
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require("../utils/errors");
const providers = require("./gatewayProviders");

function webhookSecret() {
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

function hashClientKey(rawKey) {
  return crypto
    .createHash("sha256")
    .update(String(rawKey || ""), "utf8")
    .digest("hex");
}

function buildRequestFingerprint({
  customerId,
  bookingId,
  paymentType,
  amount,
  currency,
  provider,
}) {
  const payload = [
    String(customerId),
    String(bookingId),
    String(paymentType),
    String(Math.round(Number(amount))),
    String(currency || "VND"),
    String(provider),
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Sum successful payments minus refunded amounts for a booking.
 * Delegates to canonical netPaid helper.
 */
async function getPaidNet(bookingId, session = null) {
  const { getNetPaidForBooking } = require("../utils/netPaid");
  return getNetPaidForBooking(bookingId, { session });
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
 * Create hosted-checkout session.
 * Idempotency is tenant+booking+operation scoped; raw client keys are hashed.
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
  const provider = providers.activeProvider();
  const currency = "VND";

  const rawClientKey =
    idempotencyKey ||
    `auto:${customerId}:${bookingId}:${resolvedType}:${amount}`;
  const clientKeyHash = hashClientKey(rawClientKey);
  const fingerprint = buildRequestFingerprint({
    customerId,
    bookingId,
    paymentType: resolvedType,
    amount,
    currency,
    provider,
  });

  // Lookup scoped operation for this customer+booking+key
  let operation = await CheckoutOperation.findOne({
    CustomerID: customerId,
    BookingID: bookingId,
    Operation: "checkout",
    ClientKeyHash: clientKeyHash,
  });

  if (operation) {
    if (operation.RequestFingerprint !== fingerprint) {
      throw new ConflictError(
        "Idempotency-Key đã dùng với request fingerprint khác (booking/amount/type/provider).",
      );
    }
    if (operation.Status === "succeeded") {
      const succeeded = operation.SucceededAttemptID
        ? await GatewayPayment.findById(operation.SucceededAttemptID)
        : await GatewayPayment.findOne({
            OperationID: operation._id,
            Status: "succeeded",
          });
      if (succeeded) {
        return {
          session: succeeded,
          checkoutUrl: providers.providerCheckoutUrl(
            succeeded.Provider,
            succeeded.SessionId,
          ),
          provider: succeeded.Provider,
          amount: succeeded.Amount,
          paymentType: succeeded.PaymentType,
          duplicate: true,
          alreadyPaid: true,
        };
      }
    }

    // Reuse open attempt if still active
    if (operation.CurrentAttemptID && operation.Status === "open") {
      const current = await GatewayPayment.findById(operation.CurrentAttemptID);
      if (
        current &&
        ["created", "redirected", "pending"].includes(current.Status)
      ) {
        return {
          session: current,
          checkoutUrl: providers.providerCheckoutUrl(
            current.Provider,
            current.SessionId,
          ),
          provider: current.Provider,
          amount: current.Amount,
          paymentType: current.PaymentType,
          duplicate: true,
        };
      }
      // Failed/expired attempt under same operation → new attempt allowed below
    }
  }

  if (!operation) {
    try {
      operation = await CheckoutOperation.create({
        CustomerID: customerId,
        BookingID: bookingId,
        HostID: booking.HostID,
        Operation: "checkout",
        ClientKeyHash: clientKeyHash,
        RequestFingerprint: fingerprint,
        PaymentType: resolvedType,
        Amount: amount,
        Currency: currency,
        Provider: provider,
        Status: "open",
        AttemptCount: 0,
      });
    } catch (err) {
      if (err.code === 11000) {
        operation = await CheckoutOperation.findOne({
          CustomerID: customerId,
          BookingID: bookingId,
          Operation: "checkout",
          ClientKeyHash: clientKeyHash,
        });
        if (!operation) throw err;
        if (operation.RequestFingerprint !== fingerprint) {
          throw new ConflictError(
            "Idempotency-Key đã dùng với request fingerprint khác.",
          );
        }
      } else {
        throw err;
      }
    }
  }

  // Operation-first: persist attempt shell before/with provider call
  const attemptNumber = (operation.AttemptCount || 0) + 1;
  // Scoped unique key for GatewayPayment (never raw client key alone)
  const scopedIdempotencyKey = `op:${operation._id}:attempt:${attemptNumber}`;

  const base = env.PUBLIC_BASE_URL || "";
  const isLiveProvider = providers.LIVE_PROVIDERS
    ? providers.LIVE_PROVIDERS.has(provider)
    : ["stripe", "momo"].includes(provider);

  let live = null;
  try {
    live = await providers.tryCreateLiveSession({
      provider,
      amount,
      currency,
      bookingId,
      successUrl: base
        ? `${base}/payment?bookingId=${bookingId}&paid=1`
        : undefined,
      cancelUrl: base ? `${base}/payment?bookingId=${bookingId}` : undefined,
      idempotencyKey: scopedIdempotencyKey,
    });
  } catch (err) {
    // Production / live providers: fail closed — never create local pseudo-session
    if (isLiveProvider || env.isProduction) {
      throw err;
    }
    // Dev/test mock path only: may continue without live session
    if (err.statusCode === 502 || err.statusCode === 503) throw err;
    live = null;
  }

  // Live provider without live session must not invent a local checkout URL
  if (isLiveProvider && !live) {
    const err = new Error(
      "Live payment provider did not return a checkout session.",
    );
    err.statusCode = 502;
    err.code = "PAYMENT_PROVIDER_UNAVAILABLE";
    err.isOperational = true;
    throw err;
  }

  const sessionId = live?.sessionId || providers.makeSessionId(provider);
  try {
    const session = await GatewayPayment.create({
      BookingID: bookingId,
      CustomerID: customerId,
      HostID: booking.HostID,
      OperationID: operation._id,
      AttemptNumber: attemptNumber,
      Amount: amount,
      Currency: currency,
      PaymentType: resolvedType,
      SessionId: sessionId,
      Status: live ? "redirected" : "created",
      IdempotencyKey: scopedIdempotencyKey,
      ClientKeyHash: clientKeyHash,
      RequestFingerprint: fingerprint,
      Provider: provider,
      ProviderRef: live?.providerRef || "",
      Meta: { paymentType: resolvedType },
    });

    await CheckoutOperation.updateOne(
      { _id: operation._id },
      {
        $set: {
          CurrentAttemptID: session._id,
          Status: "open",
          Amount: amount,
          PaymentType: resolvedType,
          Provider: provider,
        },
        $inc: { AttemptCount: 1 },
      },
    );

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
      const again = await GatewayPayment.findOne({
        IdempotencyKey: scopedIdempotencyKey,
      });
      if (again) {
        return {
          session: again,
          checkoutUrl: providers.providerCheckoutUrl(
            again.Provider,
            again.SessionId,
          ),
          provider: again.Provider,
          amount: again.Amount,
          paymentType: again.PaymentType,
          duplicate: true,
        };
      }
    }
    throw err;
  }
}

/**
 * Signed webhook processing with durable inbox + single financial transaction.
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
    if (
      providers.mockAllowed() &&
      provider !== "stripe" &&
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

  const workerId = `pid-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const leaseMs = 60_000;
  let inbox = await claimWebhookEvent({
    provider,
    providerEventId,
    payloadHash,
    workerId,
    leaseMs,
  });
  if (inbox === "duplicate") {
    return { ok: true, duplicate: true };
  }
  if (inbox === "payload_mismatch") {
    const err = new Error(
      "Webhook event ID reused with different payload hash",
    );
    err.statusCode = 409;
    err.code = "WEBHOOK_PAYLOAD_MISMATCH";
    err.isOperational = true;
    try {
      const alert = require("./alertService");
      if (alert?.securityAlert) {
        await alert.securityAlert({
          type: "webhook_payload_mismatch",
          provider,
          providerEventId,
        });
      }
    } catch {
      /* ignore */
    }
    throw err;
  }
  if (!inbox) {
    return { ok: true, duplicate: true, processing: true };
  }

  try {
    const sessionId = normalized.sessionId;
    if (!sessionId) throw new ValidationError("Missing sessionId");

    const gwSession = await GatewayPayment.findOne({ SessionId: sessionId });
    if (!gwSession) throw new NotFoundError("Session not found");

    if (
      normalized.amount != null &&
      Math.round(Number(normalized.amount)) !== gwSession.Amount
    ) {
      throw new ValidationError("Webhook amount mismatch.");
    }

    // Stripe Checkout: only credit when payment_status is paid
    // (completed+unpaid must not fulfill)
    if (provider === "stripe" || provider === "stripe_mock") {
      const pStatus = String(
        normalized.paymentStatus || parsed?.data?.object?.payment_status || "",
      ).toLowerCase();
      const evtType = String(normalized.type || "");
      if (evtType === "checkout.session.async_payment_failed") {
        await GatewayPayment.updateOne(
          { _id: gwSession._id, Status: { $ne: "succeeded" } },
          { $set: { Status: "failed" } },
        );
        await markWebhookProcessed(inbox._id, workerId, null);
        return { ok: true, session: gwSession, failed: true };
      }
      if (evtType === "checkout.session.expired") {
        await GatewayPayment.updateOne(
          { _id: gwSession._id, Status: { $ne: "succeeded" } },
          { $set: { Status: "expired" } },
        );
        await markWebhookProcessed(inbox._id, workerId, null);
        return { ok: true, session: gwSession, expired: true };
      }
      const creditTypes = new Set([
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ]);
      if (!creditTypes.has(evtType)) {
        await markWebhookProcessed(inbox._id, workerId, null);
        return { ok: true, ignored: true, reason: "unhandled_stripe_event" };
      }
      if (pStatus && pStatus !== "paid") {
        // completed but unpaid — do not credit
        await markWebhookProcessed(inbox._id, workerId, null);
        return {
          ok: true,
          ignored: true,
          reason: "payment_status_not_paid",
          paymentStatus: pStatus,
        };
      }
      // Validate booking reference when present
      const ref =
        normalized.clientReferenceId ||
        parsed?.data?.object?.client_reference_id ||
        parsed?.data?.object?.metadata?.bookingId;
      if (ref && String(ref) !== String(gwSession.BookingID)) {
        throw new ValidationError("Webhook booking reference mismatch.");
      }
      const cur = String(
        normalized.currency || parsed?.data?.object?.currency || "",
      ).toLowerCase();
      if (cur && cur !== String(gwSession.Currency || "vnd").toLowerCase()) {
        throw new ValidationError("Webhook currency mismatch.");
      }
    }

    const okTypes = new Set([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "payment.succeeded",
      "payment.success",
    ]);

    if (gwSession.Status === "succeeded") {
      // Idempotent re-delivery — settle if partial, mark processed as this worker
      const result = await withTransaction(
        async (mongoSession) => {
          await ensurePaymentAndLedger(gwSession, mongoSession);
          await markWebhookProcessed(inbox._id, workerId, mongoSession);
          return { ok: true, duplicate: true, session: gwSession };
        },
        { required: true },
      );
      return result;
    }

    if (!okTypes.has(normalized.type)) {
      await withTransaction(
        async (mongoSession) => {
          const failQ = GatewayPayment.findOneAndUpdate(
            { _id: gwSession._id, Status: { $ne: "succeeded" } },
            { $set: { Status: "failed" } },
            { new: true },
          );
          if (mongoSession) failQ.session(mongoSession);
          await failQ;
          await markWebhookProcessed(inbox._id, workerId, mongoSession);
        },
        { required: true },
      );
      return { ok: true, session: gwSession };
    }

    const settleResult = await withTransaction(
      async (mongoSession) => {
        // CAS session -> succeeded
        const casQ = GatewayPayment.findOneAndUpdate(
          { _id: gwSession._id, Status: { $ne: "succeeded" } },
          {
            $set: {
              Status: "succeeded",
              WebhookReceivedAt: new Date(),
              ProviderRef: normalized.id || parsed.id || `evt_${Date.now()}`,
            },
          },
          { new: true },
        );
        if (mongoSession) casQ.session(mongoSession);
        let cas = await casQ;
        if (!cas) {
          const againQ = GatewayPayment.findById(gwSession._id);
          if (mongoSession) againQ.session(mongoSession);
          cas = await againQ;
          await ensurePaymentAndLedger(cas, mongoSession);
          await markWebhookProcessed(inbox._id, workerId, mongoSession);
          return { ok: true, duplicate: true, session: cas };
        }

        // Overpayment guard inside same transaction
        const paidNet = await getPaidNet(cas.BookingID, mongoSession);
        const bookingQ = Booking.findById(cas.BookingID);
        if (mongoSession) bookingQ.session(mongoSession);
        const booking = await bookingQ;
        const total = Math.round(Number(booking?.TotalAmount) || 0);
        let overpay = false;
        if (total > 0 && paidNet + cas.Amount > total) {
          overpay = true;
        }

        let payment = null;
        if (overpay) {
          // Non-revenue status — never count in net paid / host balance
          payment = await ensurePaymentOnly(cas, mongoSession, {
            status: "overpayment_pending_refund",
            metaOverpay: true,
          });
          // Alert finance via outbox only (no revenue ledger credit)
          await outboxService.enqueueNotification(
            {
              userId: cas.HostID,
              title: "Thanh toán vượt — cần hoàn/đối soát",
              body: `${cas.Amount.toLocaleString("vi-VN")}đ (không ghi doanh thu)`,
              type: "payment",
              entityType: "PaymentHistory",
              entityId: payment?._id,
              link: "/host/payments",
            },
            {
              session: mongoSession,
              idempotencyKey: `booking:gw-${cas.SessionId}:notify-overpay`,
            },
          );
        } else {
          const result = await ensurePaymentAndLedger(cas, mongoSession);
          payment = result.payment;

          if (
            booking &&
            [
              "pending",
              "hold",
              "awaiting_payment",
              "payment_under_review",
            ].includes(booking.Status)
          ) {
            booking.Status = "payment_under_review";
            if (mongoSession) await booking.save({ session: mongoSession });
            else await booking.save();
          }

          if (cas.OperationID) {
            const opQ = CheckoutOperation.findOneAndUpdate(
              { _id: cas.OperationID },
              {
                $set: {
                  Status: "succeeded",
                  SucceededAttemptID: cas._id,
                  CurrentAttemptID: cas._id,
                },
              },
            );
            if (mongoSession) opQ.session(mongoSession);
            await opQ;
          }

          await outboxService.enqueueNotification(
            {
              userId: cas.HostID,
              title: "Thanh toán gateway thành công",
              body: `${cas.Amount.toLocaleString("vi-VN")}đ`,
              type: "payment",
              entityType: "PaymentHistory",
              entityId: payment?._id,
              link: "/host/payments",
            },
            {
              session: mongoSession,
              idempotencyKey: `booking:gw-${cas.SessionId}:notify-host`,
            },
          );
        }

        await markWebhookProcessed(inbox._id, workerId, mongoSession);

        return {
          ok: true,
          session: cas,
          payment,
          duplicate: false,
          overpay,
        };
      },
      { required: true },
    );

    // Worker owns outbox delivery — do not processPending inline (duplicate risk)
    return settleResult;
  } catch (err) {
    // Only mark failed if we still own the lease — never flip processed → failed
    await WebhookEvent.findOneAndUpdate(
      {
        _id: inbox._id,
        ProcessingStatus: "processing",
        ProcessingBy: workerId,
      },
      {
        $set: {
          ProcessingStatus: "failed",
          FailureReason: String(err.message || "error").slice(0, 500),
          ProcessingLeaseUntil: null,
        },
        $inc: { Attempts: 1 },
      },
    );
    throw err;
  }
}

/**
 * Atomic claim: insert or re-claim failed/expired lease.
 */
async function claimWebhookEvent({
  provider,
  providerEventId,
  payloadHash,
  workerId,
  leaseMs,
}) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);

  try {
    return await WebhookEvent.create({
      Provider: provider,
      ProviderEventID: providerEventId,
      PayloadHash: payloadHash,
      ProcessingStatus: "processing",
      ProcessingLeaseUntil: leaseUntil,
      ProcessingBy: workerId,
      Attempts: 1,
      ReceivedAt: now,
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  const existing = await WebhookEvent.findOne({
    Provider: provider,
    ProviderEventID: providerEventId,
  });
  if (!existing) return null;

  if (existing.PayloadHash && existing.PayloadHash !== payloadHash) {
    return "payload_mismatch";
  }

  if (existing.ProcessingStatus === "processed") {
    return "duplicate";
  }

  const reclaim = await WebhookEvent.findOneAndUpdate(
    {
      _id: existing._id,
      $or: [
        { ProcessingStatus: "failed" },
        { ProcessingStatus: "received" },
        {
          ProcessingStatus: "processing",
          ProcessingLeaseUntil: { $lte: now },
        },
        {
          ProcessingStatus: "processing",
          ProcessingLeaseUntil: null,
        },
      ],
    },
    {
      $set: {
        ProcessingStatus: "processing",
        ProcessingLeaseUntil: leaseUntil,
        ProcessingBy: workerId,
        PayloadHash: payloadHash,
      },
      $inc: { Attempts: 1 },
    },
    { new: true },
  );
  return reclaim || null;
}

/**
 * Mark processed only if current worker still owns the lease.
 */
async function markWebhookProcessed(id, workerId, session = null) {
  const q = WebhookEvent.findOneAndUpdate(
    {
      _id: id,
      ProcessingStatus: "processing",
      ProcessingBy: workerId,
    },
    {
      $set: {
        ProcessingStatus: "processed",
        ProcessedAt: new Date(),
        ProcessingLeaseUntil: null,
      },
    },
    { new: true },
  );
  if (session) q.session(session);
  const updated = await q;
  if (!updated) {
    const err = new Error(
      "Webhook lease lost — cannot mark processed (another worker owns event).",
    );
    err.statusCode = 409;
    err.code = "WEBHOOK_LEASE_LOST";
    err.isOperational = true;
    throw err;
  }
  return updated;
}

async function ensurePaymentOnly(
  session,
  mongoSession,
  { status, metaOverpay } = {},
) {
  const txCode = `GW-${session.SessionId}`;
  let paymentQ = PaymentHistory.findOne({ TransactionCode: txCode });
  if (mongoSession) paymentQ.session(mongoSession);
  let payment = await paymentQ;
  if (payment) return payment;

  const paymentType =
    session.PaymentType || session.Meta?.paymentType || "deposit";

  try {
    const docs = [
      {
        BookingID: session.BookingID,
        CustomerID: session.CustomerID,
        HostID: session.HostID,
        TransactionCode: txCode,
        Amount: session.Amount,
        PaymentType: paymentType,
        PaymentMethod: "e_wallet",
        Status: status || "successful",
        PaidAt: new Date(),
        VerifiedAt: new Date(),
        IdempotencyKey: `gw-${session.SessionId}`,
        RefundedAmount: 0,
        Meta: metaOverpay
          ? { reconciliationRequired: true, overpay: true }
          : {},
      },
    ];
    if (mongoSession) {
      const created = await PaymentHistory.create(docs, {
        session: mongoSession,
      });
      payment = created[0];
    } else {
      payment = await PaymentHistory.create(docs[0]);
    }
  } catch (err) {
    if (err.code === 11000) {
      const again = PaymentHistory.findOne({ TransactionCode: txCode });
      if (mongoSession) again.session(mongoSession);
      payment = await again;
    } else {
      throw err;
    }
  }
  return payment;
}

async function ensurePaymentAndLedger(session, mongoSession = null) {
  const payment = await ensurePaymentOnly(session, mongoSession);

  await ledgerService.postEntry(
    {
      hostId: session.HostID,
      customerId: session.CustomerID,
      bookingId: session.BookingID,
      paymentId: payment._id,
      type: "payment",
      amount: session.Amount,
      direction: "credit",
      description: `Gateway ${session.SessionId}`,
      idempotencyKey: `payment:gw-${session.SessionId}:credit`,
    },
    { session: mongoSession },
  );

  return { payment };
}

async function getSession(sessionId) {
  const session = await GatewayPayment.findOne({ SessionId: sessionId }).lean();
  if (!session) throw new NotFoundError("Session not found");
  return session;
}

async function getSessionForCustomer(sessionId, customerId) {
  const session = await GatewayPayment.findOne({
    SessionId: sessionId,
    CustomerID: customerId,
  }).lean();
  if (!session) throw new NotFoundError("Session not found");
  return {
    status: session.Status,
    amount: session.Amount,
    currency: session.Currency || "VND",
    paymentType:
      session.PaymentType || session.Meta?.paymentType || session.Type || null,
    bookingId: session.BookingID ? String(session.BookingID) : null,
    createdAt: session.createdAt || null,
  };
}

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
    amount: session.Amount,
    // Mock complete implies paid funds available
    paymentStatus: "paid",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        amount_total: session.Amount,
        currency: "vnd",
        payment_status: "paid",
        client_reference_id: String(session.BookingID),
        mode: "payment",
      },
    },
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
  hashClientKey,
  buildRequestFingerprint,
  markWebhookProcessed,
  claimWebhookEvent,
};
