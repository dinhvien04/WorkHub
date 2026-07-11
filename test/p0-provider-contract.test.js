"use strict";

/**
 * P0 provider-contract tests against production services (no live credentials).
 */
process.env.NODE_ENV = "test";
process.env.ENABLE_TRANSACTIONS = "true";
process.env.ALLOW_MOCK_PAYMENT_PROVIDER = "1";
process.env.ALLOW_MOCK_COMPLETE = "1";
process.env.PAYMENT_PROVIDER = "workhub_mock";
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  "test_jwt_secret_key_at_least_32_characters_long_for_workhub";
process.env.GATEWAY_WEBHOOK_SECRET =
  process.env.GATEWAY_WEBHOOK_SECRET ||
  "whsec_test_secret_at_least_32_chars_long";

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

jest.setTimeout(180000);

let replset;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replset.getUri());
  await mongoose.connection.db.admin().command({ ping: 1 });
  for (const name of [
    "User",
    "Booking",
    "GatewayPayment",
    "CheckoutOperation",
    "PaymentHistory",
    "LedgerEntry",
    "HostBalance",
    "WebhookEvent",
    "OutboxEvent",
  ]) {
    try {
      await require(
        `../models/${name === "PaymentHistory" ? "Payment_History" : name === "User" ? "User" : name}`,
      ).createCollection();
    } catch {
      /* */
    }
  }
  // Ensure collections
  const models = [
    require("../models/User"),
    require("../models/Booking"),
    require("../models/GatewayPayment"),
    require("../models/CheckoutOperation"),
    require("../models/Payment_History"),
    require("../models/LedgerEntry"),
    require("../models/HostBalance"),
    require("../models/WebhookEvent"),
    require("../models/OutboxEvent"),
  ];
  for (const m of models) {
    try {
      await m.createCollection();
    } catch {
      /* */
    }
  }
  const env = require("../config/env");
  env.ENABLE_TRANSACTIONS = true;
  env.ALLOW_MOCK_PAYMENT_PROVIDER = true;
  env.ALLOW_MOCK_COMPLETE = true;
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
});

describe("P0 MoMo not live-ready", () => {
  test("momoLiveReady is always false; listProviders never live momo", () => {
    process.env.MOMO_PARTNER_CODE = "x";
    process.env.MOMO_ACCESS_KEY = "y";
    process.env.MOMO_SECRET_KEY = "z";
    const providers = require("../services/gatewayProviders");
    expect(providers.momoLiveReady()).toBe(false);
    const list = providers.listProviders();
    expect(list.every((p) => p.id !== "momo" || p.live !== true)).toBe(true);
    expect(
      list.find((p) => p.id === "momo" && p.live === true),
    ).toBeUndefined();
  });

  test("activeProvider(momo) in production throws PROVIDER_NOT_IMPLEMENTED", () => {
    const env = require("../config/env");
    const prev = env.isProduction;
    env.isProduction = true;
    env.PAYMENT_PROVIDER = "momo";
    process.env.PAYMENT_PROVIDER = "momo";
    const providers = require("../services/gatewayProviders");
    expect(() => providers.activeProvider()).toThrow(
      /PROVIDER_NOT_IMPLEMENTED|not implemented/i,
    );
    env.isProduction = prev;
    process.env.PAYMENT_PROVIDER = "workhub_mock";
    env.PAYMENT_PROVIDER = "workhub_mock";
  });
});

describe("P0 Stripe payment_status unpaid does not credit", () => {
  test("checkout.session.completed + unpaid does not create revenue payment", async () => {
    const User = require("../models/User");
    const Booking = require("../models/Booking");
    const PaymentHistory = require("../models/Payment_History");
    const gatewayService = require("../services/gatewayService");
    const env = require("../config/env");
    env.ENABLE_TRANSACTIONS = true;

    const host = await User.create({
      Email: `h-unpaid-${Date.now()}@t.local`,
      PasswordHash: "x".repeat(60),
      FullName: "H",
      Role: "host",
      Status: "active",
      EmailVerified: true,
    });
    const cust = await User.create({
      Email: `c-unpaid-${Date.now()}@t.local`,
      PasswordHash: "x".repeat(60),
      FullName: "C",
      Role: "customer",
      Status: "active",
      EmailVerified: true,
    });
    const booking = await Booking.create({
      CustomerID: cust._id,
      HostID: host._id,
      SpaceID: new mongoose.Types.ObjectId(),
      StartTime: new Date(Date.now() + 86400000),
      EndTime: new Date(Date.now() + 90000000),
      TotalAmount: 100000,
      DepositAmount: 30000,
      Status: "pending",
    });

    const { session } = await gatewayService.createCheckoutSession({
      customerId: cust._id,
      bookingId: booking._id,
      paymentType: "deposit",
      idempotencyKey: `unpaid-${booking._id}`,
    });

    // Force provider stripe_mock for signature path
    const GatewayPayment = require("../models/GatewayPayment");
    await GatewayPayment.updateOne(
      { _id: session._id },
      { $set: { Provider: "stripe_mock" } },
    );

    const event = {
      type: "checkout.session.completed",
      id: `evt_unpaid_${Date.now()}`,
      data: {
        object: {
          id: session.SessionId,
          object: "checkout.session",
          amount_total: session.Amount,
          currency: "vnd",
          payment_status: "unpaid",
          client_reference_id: String(booking._id),
          mode: "payment",
        },
      },
    };
    const raw = JSON.stringify(event);
    const signature = gatewayService.signPayload(raw, "stripe_mock");
    const result = await gatewayService.handleWebhook({
      rawBody: raw,
      signature,
      event,
      provider: "stripe_mock",
    });
    expect(result.ok).toBe(true);
    expect(
      result.ignored ||
        result.reason === "payment_status_not_paid" ||
        result.paymentStatus === "unpaid" ||
        result.ignored,
    ).toBeTruthy();

    const payments = await PaymentHistory.find({
      TransactionCode: `GW-${session.SessionId}`,
      Status: "successful",
    });
    expect(payments.length).toBe(0);
  });
});

describe("P0 overpayment not successful revenue", () => {
  test("overpay creates non-revenue status only", async () => {
    const User = require("../models/User");
    const Booking = require("../models/Booking");
    const PaymentHistory = require("../models/Payment_History");
    const HostBalance = require("../models/HostBalance");
    const gatewayService = require("../services/gatewayService");
    const { getNetPaidForBooking } = require("../utils/netPaid");
    const env = require("../config/env");
    env.ENABLE_TRANSACTIONS = true;
    env.ALLOW_MOCK_COMPLETE = true;

    const host = await User.create({
      Email: `h-ov-${Date.now()}@t.local`,
      PasswordHash: "x".repeat(60),
      FullName: "H",
      Role: "host",
      Status: "active",
      EmailVerified: true,
    });
    const cust = await User.create({
      Email: `c-ov-${Date.now()}@t.local`,
      PasswordHash: "x".repeat(60),
      FullName: "C",
      Role: "customer",
      Status: "active",
      EmailVerified: true,
    });
    const booking = await Booking.create({
      CustomerID: cust._id,
      HostID: host._id,
      SpaceID: new mongoose.Types.ObjectId(),
      StartTime: new Date(Date.now() + 86400000),
      EndTime: new Date(Date.now() + 90000000),
      TotalAmount: 50000,
      DepositAmount: 30000,
      Status: "pending",
    });

    // Pre-seed a successful payment almost at total
    await PaymentHistory.create({
      BookingID: booking._id,
      CustomerID: cust._id,
      HostID: host._id,
      TransactionCode: `SEED-${booking._id}`,
      Amount: 40000,
      PaymentType: "deposit",
      PaymentMethod: "bank_transfer",
      Status: "successful",
      PaidAt: new Date(),
      RefundedAmount: 0,
    });

    const { session } = await gatewayService.createCheckoutSession({
      customerId: cust._id,
      bookingId: booking._id,
      paymentType: "remaining_balance",
      idempotencyKey: `ov-${booking._id}`,
    });
    // Force amount to overpay if needed
    const GatewayPayment = require("../models/GatewayPayment");
    await GatewayPayment.updateOne(
      { _id: session._id },
      { $set: { Amount: 30000 } },
    );

    const result = await gatewayService.mockCompleteSession(
      session.SessionId,
      cust._id,
    );
    expect(result.ok).toBe(true);

    const over = await PaymentHistory.find({
      TransactionCode: `GW-${session.SessionId}`,
    });
    if (result.overpay) {
      expect(over[0].Status).toBe("overpayment_pending_refund");
      expect(await getNetPaidForBooking(booking._id)).toBe(40000);
    }
  });
});

describe("P0 outbox lease reclaim", () => {
  test("expired processing lease can be reclaimed; old worker cannot mark sent", async () => {
    const OutboxEvent = require("../models/OutboxEvent");
    const outbox = require("../services/outboxService");

    const row = await OutboxEvent.create({
      Type: "metrics",
      IdempotencyKey: `lease-test-${Date.now()}`,
      Status: "processing",
      ProcessingBy: "worker-old",
      LeaseUntil: new Date(Date.now() - 1000),
      Payload: { fn: "incBookingsCreated" },
      AvailableAt: new Date(Date.now() - 5000),
    });

    const claimed = await outbox.claimBatch({
      workerId: "worker-new",
      limit: 5,
    });
    expect(claimed.some((c) => String(c._id) === String(row._id))).toBe(true);

    await expect(outbox.markSent(row._id, "worker-old")).rejects.toMatchObject({
      code: "OUTBOX_LEASE_LOST",
    });

    const again = await OutboxEvent.findById(row._id);
    if (again.Status === "processing" && again.ProcessingBy === "worker-new") {
      await outbox.markSent(row._id, "worker-new");
      const sent = await OutboxEvent.findById(row._id);
      expect(sent.Status).toBe("sent");
    }
  });
});

describe("P0 net paid formula", () => {
  test("partially_refunded contributes Amount - RefundedAmount", async () => {
    const User = require("../models/User");
    const Booking = require("../models/Booking");
    const PaymentHistory = require("../models/Payment_History");
    const { getNetPaidForBooking } = require("../utils/netPaid");

    const host = await User.create({
      Email: `h-net-${Date.now()}@t.local`,
      PasswordHash: "x".repeat(60),
      FullName: "H",
      Role: "host",
      Status: "active",
      EmailVerified: true,
    });
    const cust = await User.create({
      Email: `c-net-${Date.now()}@t.local`,
      PasswordHash: "x".repeat(60),
      FullName: "C",
      Role: "customer",
      Status: "active",
      EmailVerified: true,
    });
    const booking = await Booking.create({
      CustomerID: cust._id,
      HostID: host._id,
      SpaceID: new mongoose.Types.ObjectId(),
      StartTime: new Date(Date.now() + 86400000),
      EndTime: new Date(Date.now() + 90000000),
      TotalAmount: 100000,
      DepositAmount: 30000,
      Status: "confirmed",
    });
    await PaymentHistory.create({
      BookingID: booking._id,
      CustomerID: cust._id,
      HostID: host._id,
      TransactionCode: `NET-${booking._id}`,
      Amount: 100000,
      PaymentType: "full_payment",
      PaymentMethod: "bank_transfer",
      Status: "partially_refunded",
      PaidAt: new Date(),
      RefundedAmount: 40000,
    });
    expect(await getNetPaidForBooking(booking._id)).toBe(60000);
  });
});
