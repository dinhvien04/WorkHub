"use strict";

/**
 * Finance transaction suites — ENABLE_TRANSACTIONS=true + MongoMemoryReplSet.
 */
process.env.NODE_ENV = "test";
process.env.ENABLE_TRANSACTIONS = "true";
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
  // Create collections OUTSIDE transactions (catalog changes cannot happen in txn)
  const User = require("../models/User");
  const HostProfile = require("../models/Host_Profile");
  const HostBalance = require("../models/HostBalance");
  const LedgerEntry = require("../models/LedgerEntry");
  const Payout = require("../models/Payout");
  const OutboxEvent = require("../models/OutboxEvent");
  await Promise.all([
    User.createCollection(),
    HostProfile.createCollection(),
    HostBalance.createCollection(),
    LedgerEntry.createCollection(),
    Payout.createCollection(),
    OutboxEvent.createCollection(),
  ]);
  await new Promise((r) => setTimeout(r, 300));
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
});

describe("finance-transactions: payout reserve/settle", () => {
  test("request reserves; paid produces one final payout debit; failed restores once", async () => {
    const User = require("../models/User");
    const HostProfile = require("../models/Host_Profile");
    const HostBalance = require("../models/HostBalance");
    const LedgerEntry = require("../models/LedgerEntry");
    const payoutService = require("../services/payoutService");
    const ledgerService = require("../services/ledgerService");

    // Ensure env flag visible to services
    const env = require("../config/env");
    env.ENABLE_TRANSACTIONS = true;

    const host = await User.create({
      Email: `host-tx-${Date.now()}@test.local`,
      PasswordHash: "x".repeat(60),
      FullName: "Host Tx",
      Role: "host",
      Status: "active",
      EmailVerified: true,
    });
    await HostProfile.create({
      UserID: host._id,
      CompanyName: "Co",
      TaxCode: "TAX1",
      Hotline: "090",
      BankName: "VCB",
      BankNumber: "1234567890",
      IsVerified: true,
      VerificationDocument: "d.pdf",
    });

    await ledgerService.postEntry({
      hostId: host._id,
      type: "payment",
      amount: 500000,
      direction: "credit",
      description: "seed",
      idempotencyKey: `seed-pay-${host._id}`,
    });

    const payout = await payoutService.requestPayout({
      hostId: host._id,
      amount: 100000,
      idempotencyKey: `payout-tx-${host._id}-1`,
    });
    expect(payout.Status).toBe("requested");

    const balAfterReserve = await HostBalance.findOne({
      HostID: host._id,
    }).lean();
    expect(balAfterReserve.AvailableBalance).toBe(400000);
    expect(balAfterReserve.ReservedBalance).toBe(100000);

    const reserveEntries = await LedgerEntry.find({
      HostID: host._id,
      "Meta.kind": "payout_reserve",
    }).lean();
    expect(reserveEntries.length).toBe(1);
    expect(reserveEntries[0].Type).toBe("adjustment");

    await payoutService.processPayout({
      payoutId: payout._id,
      approve: false,
      adminId: host._id,
    });
    const balRestored = await HostBalance.findOne({ HostID: host._id }).lean();
    expect(balRestored.AvailableBalance).toBe(500000);
    expect(balRestored.ReservedBalance).toBe(0);

    const payout2 = await payoutService.requestPayout({
      hostId: host._id,
      amount: 100000,
      idempotencyKey: `payout-tx-${host._id}-2`,
    });
    await payoutService.processPayout({
      payoutId: payout2._id,
      approve: true,
      adminId: host._id,
      transferReference: "MANUAL-TX-001",
    });

    const finalDebits = await LedgerEntry.find({
      HostID: host._id,
      Type: "payout",
      Direction: "debit",
    }).lean();
    expect(finalDebits.length).toBe(1);

    const balPaid = await HostBalance.findOne({ HostID: host._id }).lean();
    expect(balPaid.AvailableBalance).toBe(400000);
    expect(balPaid.ReservedBalance).toBe(0);
    expect(balPaid.PaidOutBalance).toBe(100000);

    const snap = await ledgerService.getHostBalance(host._id);
    expect(snap.available).toBe(400000);
    expect(snap.paidOut).toBe(100000);
  });

  test("refund above available tracks debt — no silent clamp of ledger", async () => {
    const User = require("../models/User");
    const HostBalance = require("../models/HostBalance");
    const ledgerService = require("../services/ledgerService");
    const env = require("../config/env");
    env.ENABLE_TRANSACTIONS = true;

    const host = await User.create({
      Email: `host-debt-${Date.now()}@test.local`,
      PasswordHash: "x".repeat(60),
      FullName: "Host Debt",
      Role: "host",
      Status: "active",
      EmailVerified: true,
    });

    await ledgerService.postEntry({
      hostId: host._id,
      type: "payment",
      amount: 20000,
      direction: "credit",
      description: "seed small",
      idempotencyKey: `seed-small-${host._id}`,
    });
    await ledgerService.postEntry({
      hostId: host._id,
      type: "refund",
      amount: 100000,
      direction: "debit",
      description: "big refund",
      idempotencyKey: `refund-big-${host._id}`,
    });

    const bal = await HostBalance.findOne({ HostID: host._id }).lean();
    expect(
      (bal.DebtBalance || 0) + Math.max(0, -(bal.AvailableBalance || 0)),
    ).toBeGreaterThan(0);
    expect((bal.AvailableBalance || 0) <= 0 || (bal.DebtBalance || 0) > 0).toBe(
      true,
    );
  });
});
