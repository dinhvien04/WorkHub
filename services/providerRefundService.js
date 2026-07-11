"use strict";

/**
 * Provider refund adapters. Network calls OUTSIDE Mongo transactions.
 * Stripe: official refunds.create with idempotency key.
 * MoMo live: not implemented → manual_required.
 */
const crypto = require("crypto");
const env = require("../config/env");
const ProviderRefundOperation = require("../models/ProviderRefundOperation");
const GatewayPayment = require("../models/GatewayPayment");
const PaymentHistory = require("../models/Payment_History");
const Refund = require("../models/Refund");
const { ValidationError, NotFoundError } = require("../utils/errors");
const { withTransaction } = require("../utils/mongoTransaction");
const ledgerService = require("./ledgerService");

async function resolveProviderPaymentRef(payment) {
  // Prefer gateway session linked by TransactionCode GW-{sessionId}
  const code = String(payment.TransactionCode || "");
  if (code.startsWith("GW-")) {
    const sessionId = code.slice(3);
    const gw = await GatewayPayment.findOne({ SessionId: sessionId }).lean();
    if (gw) {
      return {
        provider: gw.Provider || "stripe",
        providerPaymentId: gw.ProviderRef || gw.SessionId,
        sessionId: gw.SessionId,
      };
    }
  }
  return {
    provider: payment.PaymentMethod === "e_wallet" ? "stripe" : "manual",
    providerPaymentId: payment.ProviderRef || payment.TransactionCode || "",
    sessionId: null,
  };
}

async function createStripeRefund({
  amount,
  paymentIntentOrCharge,
  idempotencyKey,
}) {
  if (
    !process.env.STRIPE_SECRET_KEY ||
    !process.env.STRIPE_SECRET_KEY.startsWith("sk_")
  ) {
    const err = new Error("Stripe not configured for refunds");
    err.code = "PAYMENT_PROVIDER_CONFIGURATION_ERROR";
    err.statusCode = 503;
    err.isOperational = true;
    throw err;
  }
  const Stripe = require("stripe");
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-11-20.acacia",
  });
  const params = {
    amount: Math.round(amount),
    // VND is zero-decimal in Stripe
    reason: "requested_by_customer",
  };
  // Prefer payment_intent if looks like pi_, else charge
  const ref = String(paymentIntentOrCharge || "");
  if (ref.startsWith("pi_")) params.payment_intent = ref;
  else if (ref.startsWith("ch_") || ref.startsWith("py_")) params.charge = ref;
  else {
    // Checkout session id — retrieve payment_intent
    if (ref.startsWith("cs_")) {
      const sess = await stripe.checkout.sessions.retrieve(ref);
      if (sess.payment_intent) {
        params.payment_intent = String(sess.payment_intent);
      } else {
        const err = new Error(
          "Checkout session has no payment_intent for refund",
        );
        err.code = "PAYMENT_PROVIDER_VALIDATION_ERROR";
        err.statusCode = 502;
        err.isOperational = true;
        throw err;
      }
    } else {
      // Dev/mock: cannot call Stripe with fake id
      if (!env.isProduction && process.env.ALLOW_MOCK_PAYMENT_PROVIDER) {
        return {
          id: `re_mock_${crypto.randomBytes(8).toString("hex")}`,
          status: "succeeded",
          mock: true,
        };
      }
      params.payment_intent = ref;
    }
  }
  try {
    const refund = await stripe.refunds.create(
      params,
      idempotencyKey
        ? { idempotencyKey: String(idempotencyKey).slice(0, 255) }
        : undefined,
    );
    return refund;
  } catch (err) {
    const e = new Error(
      String(err.message || "Stripe refund failed").slice(0, 300),
    );
    e.code = "PAYMENT_PROVIDER_UNAVAILABLE";
    e.statusCode = 502;
    e.isOperational = true;
    e.cause = err;
    throw e;
  }
}

/**
 * After refund marked provider_pending with allocations, submit provider refunds.
 */
async function submitProviderRefunds(refundId) {
  const refund = await Refund.findById(refundId);
  if (!refund) throw new NotFoundError("Refund not found");
  if (
    !["provider_pending", "provider_submitted", "processing"].includes(
      refund.Status,
    )
  ) {
    throw new ValidationError(
      `Refund status ${refund.Status} is not provider-submittable.`,
    );
  }

  const RefundAllocation = require("../models/RefundAllocation");
  const allocs = await RefundAllocation.find({ RefundID: refundId });
  if (!allocs.length) {
    throw new ValidationError("No allocations for provider refund.");
  }

  const results = [];
  for (const a of allocs) {
    const payment = await PaymentHistory.findById(a.PaymentID);
    if (!payment) continue;
    if (payment.PaymentMethod !== "e_wallet") continue;

    const ref = await resolveProviderPaymentRef(payment);
    let op = await ProviderRefundOperation.findOne({
      RefundID: refundId,
      PaymentID: payment._id,
    });
    if (!op) {
      op = await ProviderRefundOperation.create({
        RefundID: refundId,
        PaymentID: payment._id,
        Provider: ref.provider,
        ProviderPaymentID: ref.providerPaymentId || ref.sessionId || "",
        Amount: a.Amount,
        Currency: "VND",
        Status: "pending",
        ClientKeyHash: crypto
          .createHash("sha256")
          .update(`pref:${refundId}:${payment._id}`)
          .digest("hex"),
      });
    }
    if (op.Status === "succeeded") {
      results.push(op);
      continue;
    }

    if (ref.provider === "momo" || ref.provider === "momo_mock") {
      op.Status = "manual_required";
      op.FailureCode = "PROVIDER_NOT_IMPLEMENTED";
      await op.save();
      results.push(op);
      continue;
    }

    // stripe / stripe_mock / workhub_mock
    try {
      op.Attempts += 1;
      op.Status = "submitted";
      await op.save();

      const stripeResult = await createStripeRefund({
        amount: a.Amount,
        paymentIntentOrCharge: ref.providerPaymentId || ref.sessionId,
        idempotencyKey: `refund-op-${op._id}`,
      });

      op.ProviderRefundID = stripeResult.id;
      op.Status =
        stripeResult.status === "succeeded" || stripeResult.status === "pending"
          ? stripeResult.status === "succeeded"
            ? "succeeded"
            : "submitted"
          : "failed";
      if (stripeResult.status === "failed") {
        op.FailureCode = "stripe_refund_failed";
      }
      // Mock always succeeded
      if (stripeResult.mock) op.Status = "succeeded";
      await op.save();
      results.push(op);
    } catch (err) {
      op.Status = "failed";
      op.FailureCode = String(err.code || err.message).slice(0, 100);
      await op.save();
      results.push(op);
    }
  }

  await Refund.updateOne(
    { _id: refundId },
    {
      $set: {
        Status: "provider_submitted",
        ProviderRefundID: results
          .map((r) => r.ProviderRefundID)
          .filter(Boolean)
          .join(","),
      },
    },
  );

  // If all succeeded synchronously, settle internal ledger
  const allOk = results.every((r) => r.Status === "succeeded");
  if (allOk && results.length) {
    return settleInternalRefund(refundId);
  }

  // Any manual_required → manual_action_required
  if (results.some((r) => r.Status === "manual_required")) {
    await Refund.updateOne(
      { _id: refundId },
      { $set: { Status: "manual_action_required" } },
    );
  }

  return Refund.findById(refundId);
}

/**
 * Finalize ledger after provider confirmation (or manual evidence).
 */
async function settleInternalRefund(
  refundId,
  { transferReference = null } = {},
) {
  return withTransaction(
    async (session) => {
      const claimQ = Refund.findOneAndUpdate(
        {
          _id: refundId,
          Status: {
            $in: [
              "provider_submitted",
              "provider_pending",
              "manual_action_required",
              "manual_refund_required",
            ],
          },
        },
        {
          $set: {
            Status: "completed",
            ProcessedAt: new Date(),
            TransferReference: transferReference
              ? String(transferReference).slice(0, 200)
              : undefined,
          },
        },
        { new: true },
      );
      if (session) claimQ.session(session);
      const refund = await claimQ;
      if (!refund) {
        const again = await Refund.findById(refundId);
        if (again?.Status === "completed") return again;
        throw new ValidationError("Refund cannot settle in current status.");
      }

      // Allocations already applied when entering provider_pending
      await ledgerService.postEntry(
        {
          hostId: refund.HostID,
          customerId: refund.CustomerID,
          bookingId: refund.BookingID,
          type: "refund",
          amount: refund.Amount,
          direction: "debit",
          description: `Refund ${refund._id}`,
          idempotencyKey: `refund:${refund._id}:debit`,
          meta: {
            refundId: refund._id,
            channel: transferReference ? "manual_confirmed" : "provider",
            transferReference: transferReference || null,
          },
        },
        { session },
      );

      return refund;
    },
    { required: env.isProduction },
  );
}

/**
 * Confirm offline/manual refund with mandatory evidence.
 */
async function confirmManualRefund({
  refundId,
  actorId,
  transferReference,
  evidence = "",
}) {
  if (!transferReference || !String(transferReference).trim()) {
    throw new ValidationError(
      "TransferReference (bằng chứng chuyển khoản) là bắt buộc cho manual refund.",
    );
  }
  const refund = await Refund.findById(refundId);
  if (!refund) throw new NotFoundError("Refund not found");
  if (
    ![
      "provider_pending",
      "manual_action_required",
      "manual_refund_required",
      "requested",
      "approved",
      "processing",
    ].includes(refund.Status) &&
    refund.Status !== "provider_submitted"
  ) {
    // allow settle paths only
  }

  // Mark manual required path
  if (["requested", "approved"].includes(refund.Status)) {
    // Offline path through processRefund should already complete;
    // this is for explicit confirmation when status is manual_*
  }

  const settled = await settleInternalRefund(refundId, {
    transferReference,
  });
  settled.Meta = {
    ...(settled.Meta || {}),
    evidence: String(evidence).slice(0, 500),
    confirmedBy: actorId,
    channel: "manual_refund_confirmed",
  };
  await Refund.updateOne(
    { _id: refundId },
    {
      $set: {
        Status: "manual_refund_confirmed",
        TransferReference: String(transferReference).slice(0, 200),
        Meta: settled.Meta,
      },
    },
  );
  // Keep completed equivalent for finance
  await Refund.updateOne({ _id: refundId }, { $set: { Status: "completed" } });
  return Refund.findById(refundId);
}

module.exports = {
  submitProviderRefunds,
  settleInternalRefund,
  confirmManualRefund,
  createStripeRefund,
  resolveProviderPaymentRef,
};
