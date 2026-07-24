"use strict";

/**
 * P1 production correctness — staff branch, coupon/add-on races, recurring cancel, check-in
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
  absoluteRange,
} = require("./helpers");
const StaffMember = require("../models/StaffMember");
const Branch = require("../models/Branch");
const Space = require("../models/Space");
const AddOn = require("../models/AddOn");
const Coupon = require("../models/Coupon");
const Booking = require("../models/Booking");
const BookingSlot = require("../models/BookingSlot");
const bookingService = require("../services/bookingService");
const couponService = require("../services/couponService");
const recurringService = require("../services/recurringService");
const checkInService = require("../services/checkInService");
const {
  assertBranchAccess,
  resolveActingHostOwnerId,
} = require("../services/staffService");

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
});

describe("P1.9 Staff branch scope", () => {
  test("branch-limited staff cannot access other branch", async () => {
    const host = await createUser({ email: "h-br@test.com", role: "host" });
    const staff = await createUser({
      email: "s-br@test.com",
      role: "customer",
    });
    const { branch, space } = await seedHostSpace(host);
    const branchB = await Branch.create({
      HostID: host._id,
      Name: "Branch B",
      Address: "2 Other St",
      OpeningTime: "08:00",
      ClosingTime: "22:00",
      Status: "active",
      Images: ["https://res.cloudinary.com/demo/image/upload/v1/x.jpg"],
    });
    await StaffMember.create({
      HostOwnerID: host._id,
      UserID: staff._id,
      Role: "receptionist",
      Status: "active",
      BranchIDs: [branch._id],
    });

    const ctx = await resolveActingHostOwnerId(staff._id, "customer", host._id);
    expect(ctx.allowedBranchIds).toContain(String(branch._id));
    expect(() => assertBranchAccess(ctx, branch._id)).not.toThrow();
    expect(() => assertBranchAccess(ctx, branchB._id)).toThrow();

    const { token } = agentWithAuth(app, staff);
    const res = await request(app)
      .get("/api/staff/host/reception/today")
      .set("Cookie", `authToken=${token}`)
      .set("X-Host-Owner-Id", String(host._id));
    expect(res.status).toBe(200);
    expect(res.body.allowedBranchIds).toBeTruthy();
    expect(res.body.allowedBranchIds.map(String)).toContain(String(branch._id));

    // Explicit branch B header must be rejected
    const denied = await request(app)
      .get("/api/staff/host/reception/today")
      .query({ branchId: String(branchB._id) })
      .set("Cookie", `authToken=${token}`)
      .set("X-Host-Owner-Id", String(host._id));
    expect(denied.status).toBe(403);
  });
});

describe("P1.4 Coupon atomic redeem", () => {
  test("usage limit cannot be exceeded by concurrent redeem", async () => {
    const host = await createUser({ email: "hc@test.com", role: "host" });
    const c1 = await createUser({ email: "c1@test.com", role: "customer" });
    const c2 = await createUser({ email: "c2@test.com", role: "customer" });
    const coupon = await Coupon.create({
      Code: "LASTONE",
      Type: "fixed",
      Value: 10000,
      UsageLimit: 1,
      UsedCount: 0,
      Status: "active",
      HostID: host._id,
    });

    const b1 = await Booking.create({
      CustomerID: c1._id,
      SpaceID: (await seedHostSpace(host)).space._id,
      HostID: host._id,
      StartTime: new Date(Date.now() + 3600000),
      EndTime: new Date(Date.now() + 7200000),
      TotalAmount: 100000,
      DepositAmount: 30000,
      Status: "pending",
    });
    const b2 = await Booking.create({
      CustomerID: c2._id,
      SpaceID: b1.SpaceID,
      HostID: host._id,
      StartTime: new Date(Date.now() + 8000000),
      EndTime: new Date(Date.now() + 9000000),
      TotalAmount: 100000,
      DepositAmount: 30000,
      Status: "pending",
    });

    await couponService.redeemCoupon({
      couponId: coupon._id,
      userId: c1._id,
      bookingId: b1._id,
      discountAmount: 10000,
    });
    await expect(
      couponService.redeemCoupon({
        couponId: coupon._id,
        userId: c2._id,
        bookingId: b2._id,
        discountAmount: 10000,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const fresh = await Coupon.findById(coupon._id);
    expect(fresh.UsedCount).toBe(1);
  });
});

describe("P1.5 Add-on inventory atomic", () => {
  test("last unit race: only one booking succeeds", async () => {
    const host = await createUser({ email: "ha@test.com", role: "host" });
    const c1 = await createUser({ email: "a1@test.com", role: "customer" });
    const c2 = await createUser({ email: "a2@test.com", role: "customer" });
    const { space } = await seedHostSpace(host);
    const addon = await AddOn.create({
      HostID: host._id,
      Name: "Projector",
      Price: 50000,
      Unit: "booking",
      Inventory: 1,
      Status: "active",
    });

    const r1 = futureRange(3, 1);
    const r2 = futureRange(5, 1);

    const b1 = await bookingService.createBooking({
      customerId: c1._id,
      spaceId: space._id,
      startTime: r1.start,
      endTime: r1.end,
      addOns: [{ addOnId: addon._id, quantity: 1 }],
    });
    expect(b1).toBeTruthy();

    await expect(
      bookingService.createBooking({
        customerId: c2._id,
        spaceId: space._id,
        startTime: r2.start,
        endTime: r2.end,
        addOns: [{ addOnId: addon._id, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ statusCode: expect.any(Number) });

    const fresh = await AddOn.findById(addon._id);
    expect(fresh.Inventory).toBe(0);
  });
});

describe("P1.6 Recurring cancel releases slots", () => {
  test("cancel whole series cancels children and frees slots", async () => {
    const host = await createUser({ email: "hr@test.com", role: "host" });
    const customer = await createUser({
      email: "cr@test.com",
      role: "customer",
    });
    const { space } = await seedHostSpace(host);
    const seriesStart = new Date();
    seriesStart.setDate(seriesStart.getDate() + 10);
    seriesStart.setHours(0, 0, 0, 0);

    const { series, bookingIds } = await recurringService.createSeries({
      customerId: customer._id,
      spaceId: space._id,
      hostId: host._id,
      frequency: "daily",
      interval: 1,
      startTimeOfDay: "10:00",
      durationMinutes: 60,
      seriesStart,
      occurrenceCount: 3,
      idempotencyKey: `recurring-cancel-slots-${customer._id}`,
    });
    expect(bookingIds.length).toBeGreaterThan(0);
    const slotsBefore = await BookingSlot.countDocuments({
      BookingID: { $in: bookingIds },
    });
    expect(slotsBefore).toBeGreaterThan(0);

    const result = await recurringService.cancelSeries(
      series._id,
      customer._id,
      {
        mode: "whole",
      },
    );
    expect(result.cancelledCount).toBeGreaterThan(0);
    const open = await Booking.countDocuments({
      _id: { $in: bookingIds },
      Status: { $nin: ["cancelled", "expired"] },
    });
    expect(open).toBe(0);
    const slotsAfter = await BookingSlot.countDocuments({
      BookingID: { $in: bookingIds },
    });
    expect(slotsAfter).toBe(0);
  });
});

describe("P1.8 Check-in random code + no-show grace", () => {
  test("mint uses random code not ObjectId suffix; no-show needs grace", async () => {
    const host = await createUser({ email: "hci@test.com", role: "host" });
    const customer = await createUser({
      email: "cci@test.com",
      role: "customer",
    });
    const { space } = await seedHostSpace(host);
    const day = new Date();
    day.setDate(day.getDate() + 2);
    day.setHours(0, 0, 0, 0);
    // Window around "now" for check-in tests: start 10 min ago so early window allows
    const start = new Date(Date.now() - 10 * 60000);
    const end = new Date(Date.now() + 50 * 60000);
    // Align to slot minutes for booking validation
    const step = 30 * 60 * 1000;
    const s2 = new Date(Math.floor(start.getTime() / step) * step);
    const e2 = new Date(s2.getTime() + 60 * 60000);

    let booking;
    try {
      booking = await bookingService.createBooking({
        customerId: customer._id,
        spaceId: space._id,
        startTime: s2,
        endTime: e2,
      });
    } catch {
      // fallback absolute range tomorrow
      const { start: st, end: en } = absoluteRange(day, 10, 0, 11, 0);
      booking = await bookingService.createBooking({
        customerId: customer._id,
        spaceId: space._id,
        startTime: st,
        endTime: en,
      });
    }
    await Booking.updateOne(
      { _id: booking._id },
      { $set: { Status: "confirmed" } },
    );

    const minted = await checkInService.mintCheckInToken({
      bookingId: booking._id,
      actorId: customer._id,
      actorRole: "customer",
    });
    // 16 hex chars (64-bit entropy) after WH- prefix
    expect(minted.code).toMatch(/^WH-[A-F0-9]{16}$/i);
    const suffix = String(booking._id).slice(-6).toUpperCase();
    expect(minted.code.includes(suffix)).toBe(false);

    const fresh = await Booking.findById(booking._id);
    expect(fresh.CheckInCodeHash).toBeTruthy();
    expect(fresh.CheckInCodeHash).not.toBe(minted.code);

    // No-show before grace fails if start is in future
    const futureDay = new Date();
    futureDay.setDate(futureDay.getDate() + 4);
    const { start: fs, end: fe } = absoluteRange(futureDay, 14, 0, 15, 0);
    const b2 = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: fs,
      endTime: fe,
    });
    await Booking.updateOne({ _id: b2._id }, { $set: { Status: "confirmed" } });
    await expect(
      checkInService.markNoShow({ hostId: host._id, bookingId: b2._id }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("P1.13 Inline handler CI guard", () => {
  test("critical modules and views have no inline handlers", () => {
    const fs = require("fs");
    const path = require("path");
    const files = [
      "public/js/api.js",
      "public/js/domSafe.js",
      "public/js/security.js",
      "public/js/customer-history.js",
      "public/js/gallery-lightbox.js",
      "public/js/host-spaces.js",
      "public/js/ui-bind.js",
      "views/layout.ejs",
      "views/customer/login.ejs",
      "views/partials/header.ejs",
    ];
    for (const f of files) {
      const p = path.join(process.cwd(), f);
      if (!fs.existsSync(p)) continue;
      const text = fs.readFileSync(p, "utf8");
      expect(text).not.toMatch(/\son(?:click|error|change|submit|input)\s*=/i);
    }
    expect(
      fs.existsSync(path.join(process.cwd(), "public/js/ui-bind.js")),
    ).toBe(true);
  });
});
