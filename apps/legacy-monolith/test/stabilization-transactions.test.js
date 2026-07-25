"use strict";

const processEnv = process.env;
processEnv.ENABLE_TRANSACTIONS = "true";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  "test_jwt_secret_key_at_least_32_characters_long_for_workhub";

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

jest.setTimeout(180000);

let replset;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replset.getUri());
  await mongoose.connection.db.admin().command({ ping: 1 });

  // Create collections OUTSIDE transactions
  const User = require("../models/User");
  const Booking = require("../models/Booking");
  const PaymentHistory = require("../models/Payment_History");
  const Refund = require("../models/Refund");
  const RefundAllocation = require("../models/RefundAllocation");
  const Dispute = require("../models/Dispute");
  const LedgerEntry = require("../models/LedgerEntry");
  const OutboxEvent = require("../models/OutboxEvent");
  const HostProfile = require("../models/Host_Profile");
  const Space = require("../models/Space");

  await Promise.all([
    User.ensureIndexes(),
    Booking.ensureIndexes(),
    PaymentHistory.ensureIndexes(),
    Refund.ensureIndexes(),
    RefundAllocation.ensureIndexes(),
    Dispute.ensureIndexes(),
    LedgerEntry.ensureIndexes(),
    OutboxEvent.ensureIndexes(),
    HostProfile.ensureIndexes(),
    Space.ensureIndexes(),
  ]);
  await new Promise((r) => setTimeout(r, 1000));
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
});

describe("stabilization-transactions: dispute rollback on processRefund error", () => {
  beforeEach(() => {
    const refundService = require("../services/refundService");
    refundService.clearTestHooks();
  });

  afterEach(() => {
    const refundService = require("../services/refundService");
    refundService.clearTestHooks();
  });

  test("dispute status is rolled back if processRefund throws", async () => {
    const User = require("../models/User");
    const Booking = require("../models/Booking");
    const PaymentHistory = require("../models/Payment_History");
    const Dispute = require("../models/Dispute");
    const Refund = require("../models/Refund");
    const RefundAllocation = require("../models/RefundAllocation");

    const disputeService = require("../services/disputeService");
    const refundService = require("../services/refundService");

    // Ensure env flag visible to services
    const env = require("../config/env");
    env.ENABLE_TRANSACTIONS = true;

    // Create host and customer
    const host = await User.create({
      Email: `host-${Date.now()}@test.local`,
      PasswordHash: "x".repeat(60),
      FullName: "Host",
      Role: "host",
      Status: "active",
      EmailVerified: true,
    });

    const customer = await User.create({
      Email: `customer-${Date.now()}@test.local`,
      PasswordHash: "x".repeat(60),
      FullName: "Customer",
      Role: "customer",
      Status: "active",
      EmailVerified: true,
    });

    // Create a booking
    const booking = await Booking.create({
      CustomerID: customer._id,
      HostID: host._id,
      SpaceID: new mongoose.Types.ObjectId(),
      StartTime: new Date(),
      EndTime: new Date(Date.now() + 3600000),
      Status: "completed",
      TotalAmount: 500000,
      DepositAmount: 500000,
    });

    // Create a successful payment history
    const payment = await PaymentHistory.create({
      BookingID: booking._id,
      CustomerID: customer._id,
      HostID: host._id,
      Amount: 500000,
      Status: "successful",
      PaymentMethod: "bank_transfer",
      PaidAt: new Date(),
      TransactionCode: `TX-${Date.now()}`,
      IdempotencyKey: `idem-pay-${booking._id}`,
    });

    // Create dispute
    const dispute = await Dispute.create({
      BookingID: booking._id,
      CustomerID: customer._id,
      HostID: host._id,
      OpenedBy: customer._id,
      Reason: "Phòng không giống mô tả",
      Status: "open",
    });

    // Verify initial state
    expect(dispute.Status).toBe("open");

    // Setup failure hook inside processRefund
    refundService.setTestHooks({
      afterAllocation: async () => {
        throw new Error("Simulated processRefund allocation failure");
      },
    });

    // Attempt to resolve dispute with refund, which should trigger transaction rollback
    let error;
    try {
      await disputeService.resolveDispute({
        disputeId: dispute._id,
        adminId: host._id,
        resolution: "Resolve with partial refund",
        refundAmount: 200000,
        reject: false,
      });
    } catch (err) {
      error = err;
    }

    // Verify error was thrown
    expect(error).toBeDefined();
    expect(error.message).toBe("Simulated processRefund allocation failure");

    // Verify Dispute state rolled back to 'open' in DB
    const freshDispute = await Dispute.findById(dispute._id);
    expect(freshDispute.Status).toBe("open");
    expect(freshDispute.Resolution || "").toBe("");

    // Verify no Refund document was created/committed
    const refunds = await Refund.find({ BookingID: booking._id });
    expect(refunds.length).toBe(0);

    // Verify no RefundAllocation document was created/committed
    const allocations = await RefundAllocation.find();
    expect(allocations.length).toBe(0);

    // Verify payment history refunded amount is still 0 and status remains successful
    const freshPayment = await PaymentHistory.findById(payment._id);
    expect(freshPayment.RefundedAmount).toBe(0);
    expect(freshPayment.Status).toBe("successful");
  });

  test("dispute status becomes refund_pending when refund is not complete immediately, and resolved after settleInternalRefund", async () => {
    const User = require("../models/User");
    const Booking = require("../models/Booking");
    const PaymentHistory = require("../models/Payment_History");
    const Dispute = require("../models/Dispute");
    const Refund = require("../models/Refund");
    const GatewayPayment = require("../models/GatewayPayment");

    const disputeService = require("../services/disputeService");
    const providerRefundService = require("../services/providerRefundService");

    // Ensure env flag visible to services
    const env = require("../config/env");
    env.ENABLE_TRANSACTIONS = true;

    // Create host and customer
    const host = await User.create({
      Email: `host-dispute-${Date.now()}@test.local`,
      PasswordHash: "x".repeat(60),
      FullName: "Host",
      Role: "host",
      Status: "active",
      EmailVerified: true,
    });

    const customer = await User.create({
      Email: `customer-dispute-${Date.now()}@test.local`,
      PasswordHash: "x".repeat(60),
      FullName: "Customer",
      Role: "customer",
      Status: "active",
      EmailVerified: true,
    });

    // Create a booking
    const booking = await Booking.create({
      CustomerID: customer._id,
      HostID: host._id,
      SpaceID: new mongoose.Types.ObjectId(),
      StartTime: new Date(),
      EndTime: new Date(Date.now() + 3600000),
      Status: "completed",
      TotalAmount: 500000,
      DepositAmount: 500000,
    });

    // Create a successful payment history with e_wallet (gateway)
    const payment = await PaymentHistory.create({
      BookingID: booking._id,
      CustomerID: customer._id,
      HostID: host._id,
      Amount: 500000,
      Status: "successful",
      PaymentMethod: "e_wallet",
      PaidAt: new Date(),
      TransactionCode: "GW-disputesess",
    });

    // Create linked GatewayPayment
    await GatewayPayment.create({
      SessionId: "disputesess",
      CustomerID: customer._id,
      HostID: host._id,
      BookingID: booking._id,
      Amount: 500000,
      Provider: "stripe",
      ProviderRef: "pi_stripe_dispute",
      Status: "succeeded",
    });

    // Create dispute
    const dispute = await Dispute.create({
      BookingID: booking._id,
      CustomerID: customer._id,
      HostID: host._id,
      OpenedBy: customer._id,
      Reason: "Phòng không có điện",
      Status: "open",
    });

    // Resolve dispute with refund
    const resolvedDispute = await disputeService.resolveDispute({
      disputeId: dispute._id,
      adminId: host._id,
      resolution: "Partial refund 300k",
      refundAmount: 300000,
      reject: false,
    });

    // Dispute should NOT be resolved, but should be refund_pending
    expect(resolvedDispute.Status).toBe("refund_pending");

    const dbDispute = await Dispute.findById(dispute._id);
    expect(dbDispute.Status).toBe("refund_pending");

    // Refund should be provider_pending
    const refund = await Refund.findOne({ BookingID: booking._id });
    expect(refund).toBeTruthy();
    expect(refund.Status).toBe("provider_pending");

    // Settle the provider refund
    await providerRefundService.settleInternalRefund(refund._id);

    // Verify dispute is now resolved
    const freshDispute = await Dispute.findById(dispute._id);
    expect(freshDispute.Status).toBe("resolved");
    expect(freshDispute.ResolvedAt).toBeTruthy();
  });

  test("dispute status becomes resolution_failed if provider refund fails", async () => {
    const User = require("../models/User");
    const Booking = require("../models/Booking");
    const PaymentHistory = require("../models/Payment_History");
    const Dispute = require("../models/Dispute");
    const Refund = require("../models/Refund");
    const GatewayPayment = require("../models/GatewayPayment");

    const disputeService = require("../services/disputeService");
    const providerRefundService = require("../services/providerRefundService");

    // Ensure env flag visible to services
    const env = require("../config/env");
    env.ENABLE_TRANSACTIONS = true;

    // Create host and customer
    const host = await User.create({
      Email: `host-fail-${Date.now()}@test.local`,
      PasswordHash: "x".repeat(60),
      FullName: "Host",
      Role: "host",
      Status: "active",
      EmailVerified: true,
    });

    const customer = await User.create({
      Email: `customer-fail-${Date.now()}@test.local`,
      PasswordHash: "x".repeat(60),
      FullName: "Customer",
      Role: "customer",
      Status: "active",
      EmailVerified: true,
    });

    // Create a booking
    const booking = await Booking.create({
      CustomerID: customer._id,
      HostID: host._id,
      SpaceID: new mongoose.Types.ObjectId(),
      StartTime: new Date(),
      EndTime: new Date(Date.now() + 3600000),
      Status: "completed",
      TotalAmount: 500000,
      DepositAmount: 500000,
    });

    // Create a successful payment history with e_wallet (gateway)
    const payment = await PaymentHistory.create({
      BookingID: booking._id,
      CustomerID: customer._id,
      HostID: host._id,
      Amount: 500000,
      Status: "successful",
      PaymentMethod: "e_wallet",
      PaidAt: new Date(),
      TransactionCode: "GW-failsess",
    });

    // Create linked GatewayPayment
    await GatewayPayment.create({
      SessionId: "failsess",
      CustomerID: customer._id,
      HostID: host._id,
      BookingID: booking._id,
      Amount: 500000,
      Provider: "stripe",
      ProviderRef: "invalid_ref_to_fail",
      Status: "succeeded",
    });

    // Create dispute
    const dispute = await Dispute.create({
      BookingID: booking._id,
      CustomerID: customer._id,
      HostID: host._id,
      OpenedBy: customer._id,
      Reason: "Hỏng điều hòa",
      Status: "open",
    });

    // Resolve dispute with refund
    const resolvedDispute = await disputeService.resolveDispute({
      disputeId: dispute._id,
      adminId: host._id,
      resolution: "Partial refund 300k",
      refundAmount: 300000,
      reject: false,
    });

    expect(resolvedDispute.Status).toBe("refund_pending");

    const refund = await Refund.findOne({ BookingID: booking._id });
    expect(refund).toBeTruthy();
    expect(refund.Status).toBe("provider_pending");

    // Stub createStripeRefund to throw an error simulating provider failure
    const originalCreateStripeRefund = providerRefundService.createStripeRefund;
    providerRefundService.createStripeRefund = async () => {
      throw new Error("Stripe API down");
    };

    try {
      // Call submitProviderRefunds which will fail because of our stub
      await providerRefundService.submitProviderRefunds(refund._id);

      // Verify dispute status transitioned to resolution_failed
      const freshDispute = await Dispute.findById(dispute._id);
      expect(freshDispute.Status).toBe("resolution_failed");
    } finally {
      // Restore stub
      providerRefundService.createStripeRefund = originalCreateStripeRefund;
    }
  });
});
