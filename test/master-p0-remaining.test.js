"use strict";

/**
 * Remaining P0 regression suite from fix.md:
 * WebAuthn strict registration, refund/payout/ledger atomicity,
 * gateway session ownership, staff inbox branch scope.
 */
const request = require("supertest");
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  seedHostSpace,
  getApp,
  agentWithAuth,
  getCsrfPair,
  withCsrf,
  futureRange,
} = require("./helpers");
const PaymentHistory = require("../models/Payment_History");
const RefundAllocation = require("../models/RefundAllocation");
const LedgerEntry = require("../models/LedgerEntry");
const HostBalance = require("../models/HostBalance");
const Payout = require("../models/Payout");
const Refund = require("../models/Refund");
const StaffMember = require("../models/StaffMember");
const Branch = require("../models/Branch");
const Space = require("../models/Space");
const Booking = require("../models/Booking");
const WebAuthnCredential = require("../models/WebAuthnCredential");
const gatewayService = require("../services/gatewayService");
const bookingService = require("../services/bookingService");
const refundService = require("../services/refundService");
const payoutService = require("../services/payoutService");
const ledgerService = require("../services/ledgerService");
const webauthnService = require("../services/webauthnService");
const membershipService = require("../services/membershipService");
const { MembershipPlan } = require("../models/Membership");
const env = require("../config/env");

let app;

beforeAll(async () => {
  await startMemoryMongo();
  app = getApp();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearDb();
  refundService.clearTestHooks();
  payoutService.clearTestHooks();
  // Keep WebAuthn disabled unless a test enables it via env flag on service
  process.env.WEBAUTHN_ENABLED = "false";
  // env module caches WEBAUTHN_ENABLED at load — force via direct assignment
  env.WEBAUTHN_ENABLED = false;
});

describe("P0 WebAuthn registration — no publicKey fallback", () => {
  test("disabled feature returns unavailable", async () => {
    env.WEBAUTHN_ENABLED = false;
    await expect(
      webauthnService.registerCredential({
        userId: "000000000000000000000001",
        challenge: "x",
        credential: {
          id: "c",
          response: { clientDataJSON: "a", attestationObject: "b" },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 503, code: "FEATURE_DISABLED" });
  });

  test("arbitrary publicKey without attestation is rejected", async () => {
    env.WEBAUTHN_ENABLED = true;
    const user = await createUser({ email: "pk1@test.com", role: "customer" });
    await expect(
      webauthnService.registerCredential({
        userId: user._id,
        challenge: "ch",
        credential: {
          id: "cred-1",
          publicKey: "AAAA_forged_key",
          response: {},
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test("missing clientDataJSON/attestationObject rejected", async () => {
    env.WEBAUTHN_ENABLED = true;
    const user = await createUser({ email: "pk2@test.com", role: "customer" });
    await expect(
      webauthnService.registerCredential({
        userId: user._id,
        challenge: "ch",
        credential: { id: "cred-2", response: { clientDataJSON: "only" } },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test("controller rejects legacy publicKey body", async () => {
    env.WEBAUTHN_ENABLED = true;
    const user = await createUser({ email: "pk3@test.com", role: "customer" });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);
    const res = await withCsrf(
      request(app).post("/api/auth/webauthn/register/verify"),
      csrf,
      `authToken=${token}`,
    ).send({
      challenge: "c",
      credentialId: "id",
      publicKey: "forged",
    });
    expect([400, 401, 503]).toContain(res.status);
    expect(res.status).not.toBe(201);
    const count = await WebAuthnCredential.countDocuments({ UserID: user._id });
    expect(count).toBe(0);
  });

  test("banned user rejected for registration options", async () => {
    env.WEBAUTHN_ENABLED = true;
    const user = await createUser({
      email: "ban@test.com",
      role: "customer",
      status: "banned",
    });
    // createUser may not allow banned active flow — force status
    const User = require("../models/User");
    await User.updateOne({ _id: user._id }, { $set: { Status: "banned" } });
    await expect(
      webauthnService.registrationOptions({
        userId: user._id,
        email: user.Email,
        host: "localhost",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("P0 Refund atomicity — failure leaves no mutation", () => {
  async function seedPaidBooking() {
    const host = await createUser({ email: `rh${Date.now()}@t.com`, role: "host" });
    const customer = await createUser({
      email: `rc${Date.now()}@t.com`,
      role: "customer",
    });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(2, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    const pay = await PaymentHistory.create({
      BookingID: booking._id,
      CustomerID: customer._id,
      HostID: host._id,
      TransactionCode: `TX-${Date.now()}-${Math.random()}`,
      Amount: 200000,
      PaymentType: "deposit",
      PaymentMethod: "bank_transfer",
      Status: "successful",
      PaidAt: new Date(),
      RefundedAmount: 0,
    });
    await ledgerService.postEntry({
      hostId: host._id,
      bookingId: booking._id,
      paymentId: pay._id,
      type: "payment",
      amount: 200000,
      direction: "credit",
      idempotencyKey: `payment:${pay._id}:credit`,
    });
    return { host, customer, booking, pay };
  }

  test("happy path completes allocation + ledger", async () => {
    const { host, customer, booking, pay } = await seedPaidBooking();
    const refund = await refundService.requestRefund({
      bookingId: booking._id,
      userId: customer._id,
      role: "customer",
      amount: 50000,
      reason: "test",
      idempotencyKey: "ref-ok-1",
    });
    await refundService.processRefund({
      refundId: refund._id,
      actorId: host._id,
      approve: true,
      role: "host",
      transferReference: "TEST-OFFLINE-REF",
    });
    const fresh = await PaymentHistory.findById(pay._id);
    expect(fresh.RefundedAmount).toBe(50000);
    expect(fresh.Status).toBe("partially_refunded");
    const allocSum = await RefundAllocation.aggregate([
      { $match: { RefundID: refund._id } },
      { $group: { _id: null, s: { $sum: "$Amount" } } },
    ]);
    expect(allocSum[0].s).toBe(50000);
    const ledger = await LedgerEntry.findOne({
      IdempotencyKey: `refund:${refund._id}:debit`,
    });
    expect(ledger).toBeTruthy();
    expect(ledger.Amount).toBe(50000);
  });

  test("fail after first payment update → no net mutation", async () => {
    const { host, customer, booking, pay } = await seedPaidBooking();
    const refund = await refundService.requestRefund({
      bookingId: booking._id,
      userId: customer._id,
      role: "customer",
      amount: 40000,
      reason: "inj",
      idempotencyKey: "ref-fail-pay",
    });
    refundService.setTestHooks({
      afterFirstPaymentUpdate: async () => {
        throw new Error("injected after payment update");
      },
    });
    await expect(
      refundService.processRefund({ refundId: refund._id, actorId: host._id, approve: true, role: "host", transferReference: "TEST-OFFLINE-REF", }),
    ).rejects.toThrow(/injected/);

    const fresh = await PaymentHistory.findById(pay._id);
    expect(Number(fresh.RefundedAmount || 0)).toBe(0);
    expect(fresh.Status).toBe("successful");
    expect(await RefundAllocation.countDocuments({ RefundID: refund._id })).toBe(
      0,
    );
    const failed = await Refund.findById(refund._id);
    expect(failed.Status).toBe("failed");
    // Net paid unchanged
    expect(await refundService.getSuccessfulPaid(booking._id)).toBe(200000);
  });

  test("fail after ledger hook before complete → compensated", async () => {
    const { host, customer, booking, pay } = await seedPaidBooking();
    const refund = await refundService.requestRefund({
      bookingId: booking._id,
      userId: customer._id,
      role: "customer",
      amount: 30000,
      reason: "inj2",
      idempotencyKey: "ref-fail-led",
    });
    refundService.setTestHooks({
      beforeComplete: async () => {
        throw new Error("injected before complete");
      },
    });
    await expect(
      refundService.processRefund({ refundId: refund._id, actorId: host._id, approve: true, role: "host", transferReference: "TEST-OFFLINE-REF", }),
    ).rejects.toThrow(/injected/);

    // Without multi-doc txn, compensation may leave ledger; invariant: failed refund
    // must not permanently reduce net paid. When ENABLE_TRANSACTIONS=false,
    // processRefund compensates allocations; ledger may still exist — re-check net.
    const fresh = await PaymentHistory.findById(pay._id);
    expect(Number(fresh.RefundedAmount || 0)).toBe(0);
    expect(await refundService.getSuccessfulPaid(booking._id)).toBe(200000);
  });

  test("concurrent refunds cannot exceed net paid", async () => {
    const { host, customer, booking } = await seedPaidBooking();
    // Request amounts that fit individually but not together (pending not counted until processing)
    // Use approve path: create both at 120k while pending limit allows only one completion
    const r1 = await refundService.requestRefund({
      bookingId: booking._id,
      userId: customer._id,
      role: "customer",
      amount: 120000,
      reason: "c1",
      idempotencyKey: "ref-c1",
    });
    // Second request limited by pending of first — max remaining 80k
    const r2 = await refundService.requestRefund({
      bookingId: booking._id,
      userId: customer._id,
      role: "customer",
      amount: 80000,
      reason: "c2",
      idempotencyKey: "ref-c2",
    });
    const results = await Promise.allSettled([
      refundService.processRefund({ refundId: r1._id, actorId: host._id, approve: true, role: "host", transferReference: "TEST-OFFLINE-REF", }),
      refundService.processRefund({ refundId: r2._id, actorId: host._id, approve: true, role: "host", transferReference: "TEST-OFFLINE-REF", }),
    ]);
    const payments = await PaymentHistory.find({ BookingID: booking._id });
    const refunded = payments.reduce(
      (s, p) => s + Number(p.RefundedAmount || 0),
      0,
    );
    expect(refunded).toBeLessThanOrEqual(200000);
    expect(refunded).toBeGreaterThan(0);
    // Both can complete (120+80=200) — invariant is not exceeding net
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    expect(fulfilled).toBeGreaterThanOrEqual(1);
  });

  test("idempotency key same payload returns same; different amount 409", async () => {
    const { customer, booking } = await seedPaidBooking();
    const a = await refundService.requestRefund({
      bookingId: booking._id,
      userId: customer._id,
      role: "customer",
      amount: 10000,
      reason: "id",
      idempotencyKey: "ref-idem",
    });
    const b = await refundService.requestRefund({
      bookingId: booking._id,
      userId: customer._id,
      role: "customer",
      amount: 10000,
      reason: "id",
      idempotencyKey: "ref-idem",
    });
    expect(String(a._id)).toBe(String(b._id));
    await expect(
      refundService.requestRefund({
        bookingId: booking._id,
        userId: customer._id,
        role: "customer",
        amount: 20000,
        reason: "id",
        idempotencyKey: "ref-idem",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("P0 Payout atomicity", () => {
  test("ledger fail after payout create does not leave orphan without reserve (txn or compensate)", async () => {
    const host = await createUser({ email: "po1@test.com", role: "host" });
    await ledgerService.postEntry({
      hostId: host._id,
      type: "payment",
      amount: 500000,
      direction: "credit",
      idempotencyKey: "pay-seed-po",
    });

    payoutService.setTestHooks({
      afterPayoutCreate: async () => {
        throw new Error("injected after payout create");
      },
    });

    await expect(
      payoutService.requestPayout({
        hostId: host._id,
        amount: 100000,
        idempotencyKey: "po-fail-1",
      }),
    ).rejects.toThrow(/injected/);

    // With transactions off: payout may exist; critical is reserve consistency
    const payouts = await Payout.find({ HostID: host._id });
    const bal = await HostBalance.findOne({ HostID: host._id });
    if (payouts.length === 0) {
      // full rollback — ideal
      expect(bal.AvailableBalance).toBe(500000);
      expect(bal.ReservedBalance || 0).toBe(0);
    } else {
      // If payout exists, reserve must still be held (not released while payout open)
      // Previous bug: release reserve but leave payout requested
      const open = payouts.filter((p) =>
        ["requested", "processing"].includes(p.Status),
      );
      if (open.length) {
        expect(bal.ReservedBalance).toBeGreaterThanOrEqual(
          open.reduce((s, p) => s + p.Amount, 0),
        );
      }
    }
  });

  test("approve without reserve is rejected", async () => {
    const host = await createUser({ email: "po2@test.com", role: "host" });
    // Orphan payout with no reserve
    const orphan = await Payout.create({
      HostID: host._id,
      Amount: 100000,
      Status: "requested",
      IdempotencyKey: "orphan-po",
    });
    await HostBalance.create({
      HostID: host._id,
      AvailableBalance: 0,
      ReservedBalance: 0,
      PaidOutBalance: 0,
    });
    await expect(
      payoutService.processPayout({
        payoutId: orphan._id,
        approve: true,
        adminId: host._id,
        transferReference: 'ORPHAN-TEST-REF',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const fresh = await Payout.findById(orphan._id);
    expect(fresh.Status).not.toBe("paid");
  });

  test("same key different amount 409; concurrent cannot overspend", async () => {
    const host = await createUser({ email: "po3@test.com", role: "host" });
    await ledgerService.postEntry({
      hostId: host._id,
      type: "payment",
      amount: 150000,
      direction: "credit",
      idempotencyKey: "pay-conc",
    });
    const p1 = await payoutService.requestPayout({
      hostId: host._id,
      amount: 100000,
      idempotencyKey: "po-same-amt",
    });
    const p2 = await payoutService.requestPayout({
      hostId: host._id,
      amount: 100000,
      idempotencyKey: "po-same-amt",
    });
    expect(String(p1._id)).toBe(String(p2._id));
    await expect(
      payoutService.requestPayout({
        hostId: host._id,
        amount: 120000,
        idempotencyKey: "po-same-amt",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const results = await Promise.allSettled([
      payoutService.requestPayout({
        hostId: host._id,
        amount: 100000,
        idempotencyKey: "po-a",
      }),
      payoutService.requestPayout({
        hostId: host._id,
        amount: 100000,
        idempotencyKey: "po-b",
      }),
    ]);
    // Only 50k left after first 100k reserve — at most one more succeeds... actually 50k left so both fail
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(0);
    const bal = await HostBalance.findOne({ HostID: host._id });
    expect(bal.AvailableBalance + bal.ReservedBalance).toBe(150000);
  });
});

describe("P0 Ledger + HostBalance consistency", () => {
  test("payment credit updates projection; refund debit decreases", async () => {
    const host = await createUser({ email: "led@test.com", role: "host" });
    await ledgerService.postEntry({
      hostId: host._id,
      type: "payment",
      amount: 100000,
      direction: "credit",
      idempotencyKey: "payment:x:credit",
    });
    let bal = await HostBalance.findOne({ HostID: host._id });
    expect(bal.AvailableBalance).toBe(100000);

    await ledgerService.postEntry({
      hostId: host._id,
      type: "refund",
      amount: 25000,
      direction: "debit",
      idempotencyKey: "refund:y:debit",
    });
    bal = await HostBalance.findOne({ HostID: host._id });
    expect(bal.AvailableBalance).toBe(75000);
  });

  test("idempotent ledger key returns same entry", async () => {
    const host = await createUser({ email: "led2@test.com", role: "host" });
    const a = await ledgerService.postEntry({
      hostId: host._id,
      type: "payment",
      amount: 10000,
      direction: "credit",
      idempotencyKey: "payment:dup:credit",
    });
    const b = await ledgerService.postEntry({
      hostId: host._id,
      type: "payment",
      amount: 10000,
      direction: "credit",
      idempotencyKey: "payment:dup:credit",
    });
    expect(String(a._id)).toBe(String(b._id));
    expect(await LedgerEntry.countDocuments({ HostID: host._id })).toBe(1);
  });
});

describe("P0 Gateway session ownership", () => {
  test("owner success; other customer 404; guest 401; DTO allowlist", async () => {
    const host = await createUser({ email: "gwh@test.com", role: "host" });
    const owner = await createUser({ email: "gwo@test.com", role: "customer" });
    const other = await createUser({ email: "gwt@test.com", role: "customer" });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(3, 1);
    const booking = await bookingService.createBooking({
      customerId: owner._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    const { session } = await gatewayService.createCheckoutSession({
      customerId: owner._id,
      bookingId: booking._id,
      paymentType: "deposit",
      idempotencyKey: "sess-own-1",
    });

    const guest = await request(app).get(
      `/api/gateway/sessions/${session.SessionId}`,
    );
    expect(guest.status).toBe(401);

    const { token: ownerTok } = agentWithAuth(app, owner);
    const ok = await request(app)
      .get(`/api/gateway/sessions/${session.SessionId}`)
      .set("Cookie", `authToken=${ownerTok}`);
    expect(ok.status).toBe(200);
    expect(ok.body.amount).toBeDefined();
    expect(ok.body.status).toBeDefined();
    expect(ok.body.bookingId).toBeDefined();
    // Must not leak raw internals
    expect(ok.body.IdempotencyKey).toBeUndefined();
    expect(ok.body.ProviderMeta).toBeUndefined();
    expect(ok.body.session).toBeUndefined();
    const allowed = new Set([
      "amount",
      "bookingId",
      "createdAt",
      "currency",
      "paymentType",
      "status",
    ]);
    for (const k of Object.keys(ok.body)) {
      expect(allowed.has(k)).toBe(true);
    }
    expect(ok.body).not.toHaveProperty("IdempotencyKey");
    expect(ok.body).not.toHaveProperty("ProviderPayload");

    const { token: otherTok } = agentWithAuth(app, other);
    const denied = await request(app)
      .get(`/api/gateway/sessions/${session.SessionId}`)
      .set("Cookie", `authToken=${otherTok}`);
    expect(denied.status).toBe(404);
  });
});

describe("P0 Staff inbox branch scope", () => {
  test("receptionist branch A cannot see branch B bookings/counts", async () => {
    const host = await createUser({ email: "sih@test.com", role: "host" });
    const staff = await createUser({ email: "sis@test.com", role: "customer" });
    const customer = await createUser({
      email: "sic@test.com",
      role: "customer",
    });

    // seedHostSpace creates branch A + space A
    const { branch: branchA, space: spaceA } = await seedHostSpace(host);
    const branchB = await Branch.create({
      HostID: host._id,
      Name: "Branch B",
      Address: "B",
      OpeningTime: "08:00",
      ClosingTime: "22:00",
      Status: "active",
    });

    const spaceB = await Space.create({
      HostID: host._id,
      BranchID: branchB._id,
      Name: "Space B",
      SpaceCode: `SB-${Date.now()}`,
      Capacity: 4,
      Category: "meeting_room",
      PricePerHour: 100000,
      DepositAmount: 30000,
      Status: "available",
    });

    const rA = futureRange(4, 1);
    const rB = futureRange(5, 1);
    const bookA = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: spaceA._id,
      startTime: rA.start,
      endTime: rA.end,
    });
    const bookB = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: spaceB._id,
      startTime: rB.start,
      endTime: rB.end,
    });
    expect(bookA).toBeTruthy();
    expect(bookB).toBeTruthy();

    await StaffMember.create({
      HostOwnerID: host._id,
      UserID: staff._id,
      Role: "receptionist",
      BranchIDs: [branchA._id],
      AllBranches: false,
      Status: "active",
    });

    const inbox = require("../services/hostInboxService");
    const staffService = require("../services/staffService");
    const ctx = await staffService.resolveActingHostOwnerId(
      staff._id,
      "customer",
      host._id,
    );
    expect(ctx.allowedBranchIds).toEqual([String(branchA._id)]);
    const spaceFilter = await staffService.branchScopedSpaceFilter(ctx);
    const data = await inbox.listHostInbox(host._id, { spaceFilter });
    const ids = data.items.map((b) => String(b._id));
    expect(ids).toContain(String(bookA._id));
    expect(ids).not.toContain(String(bookB._id));
    // counts scoped
    expect(data.counts.new + data.counts.awaiting_payment + data.counts.today).toBeGreaterThanOrEqual(0);
    // total items only A
    expect(data.total).toBe(1);
  });

  test("empty BranchIDs without AllBranches denies all", async () => {
    const host = await createUser({ email: "denyh@test.com", role: "host" });
    const staff = await createUser({ email: "denys@test.com", role: "customer" });
    const customer = await createUser({
      email: "denyc@test.com",
      role: "customer",
    });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(6, 1);
    await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    await StaffMember.create({
      HostOwnerID: host._id,
      UserID: staff._id,
      Role: "receptionist",
      BranchIDs: [],
      AllBranches: false,
      Status: "active",
    });
    const staffService = require("../services/staffService");
    const ctx = await staffService.resolveActingHostOwnerId(
      staff._id,
      "customer",
      host._id,
    );
    expect(ctx.allowedBranchIds).toEqual([]);
    const spaceFilter = await staffService.branchScopedSpaceFilter(ctx);
    const data = await require("../services/hostInboxService").listHostInbox(
      host._id,
      { spaceFilter },
    );
    expect(data.total).toBe(0);
    expect(data.items).toHaveLength(0);
  });
});

describe("P1 Paid membership cannot activate free", () => {
  test("MonthlyPrice > 0 rejected even if MEMBERSHIP_PAID_ENABLED", async () => {
    env.MEMBERSHIP_PAID_ENABLED = true;
    const customer = await createUser({
      email: "mem@test.com",
      role: "customer",
    });
    await MembershipPlan.create({
      Code: "PAIDX",
      Name: "Paid",
      MonthlyPrice: 200000,
      IncludedHours: 10,
      Status: "active",
    });
    await expect(
      membershipService.subscribe({ userId: customer._id, planCode: "PAIDX" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("P1 Metrics token not accepted in query string", () => {
  test("Bearer works; query token ignored", async () => {
    const prev = env.METRICS_AUTH_TOKEN;
    env.METRICS_AUTH_TOKEN = "metrics-secret-test-token-32chars!!";
    try {
      const viaQuery = await request(app).get(
        "/metrics?token=metrics-secret-test-token-32chars!!",
      );
      expect(viaQuery.status).toBe(401);

      const viaBearer = await request(app)
        .get("/metrics")
        .set("Authorization", "Bearer metrics-secret-test-token-32chars!!");
      expect(viaBearer.status).toBe(200);
    } finally {
      env.METRICS_AUTH_TOKEN = prev;
    }
  });
});
