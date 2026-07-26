"use strict";

/**
 * Regression tests for the two financial findings from the security audit.
 *
 * Both reproduce the money movement rather than asserting a guard exists, so
 * they still fail if the hole reopens by another route.
 */
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  seedHostSpace,
} = require("./helpers");

const Booking = require("../models/Booking");
const PaymentHistory = require("../models/Payment_History");
const GatewayPayment = require("../models/GatewayPayment");
const bookingService = require("../services/bookingService");
const rescheduleService = require("../services/rescheduleService");
const { getNetPaidForBooking } = require("../utils/netPaid");

const HOUR = 60 * 60 * 1000;

/** Next slot boundary, always inside the bookable window. */
function alignedStart(offsetHours = 2) {
  const step = 30 * 60 * 1000;
  return new Date(Math.ceil((Date.now() + offsetHours * HOUR) / step) * step);
}

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

describe("Reschedule re-prices a paid booking", () => {
  let host;
  let customer;
  let space;

  beforeEach(async () => {
    await clearDb();
    host = await createUser({ email: "host-resched@test.com", role: "host" });
    customer = await createUser({ email: "cust-resched@test.com", role: "customer" });
    ({ space } = await seedHostSpace(host));
  });

  async function bookAndPay(hours) {
    const start = alignedStart(2);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: new Date(start.getTime() + hours * HOUR),
    });

    // Settle it, so the booking counts as paid.
    await PaymentHistory.create({
      BookingID: booking._id,
      CustomerID: customer._id,
      HostID: host._id,
      TransactionCode: `TEST-${booking._id}`,
      Amount: booking.TotalAmount,
      Status: "successful",
      PaidAt: new Date(),
    });
    await Booking.updateOne({ _id: booking._id }, { $set: { Status: "confirmed" } });

    return Booking.findById(booking._id);
  }

  test("a paid short booking cannot be stretched into a longer one for free", async () => {
    const booking = await bookAndPay(0.5);
    const paidAmount = booking.TotalAmount;
    expect(paidAmount).toBeGreaterThan(0);

    const newStart = alignedStart(3);
    const newEnd = new Date(newStart.getTime() + 8 * HOUR);

    // This is the exploit: same booking, far longer window, nothing more paid.
    await expect(
      rescheduleService.rescheduleBooking({
        bookingId: booking._id,
        userId: customer._id,
        role: "customer",
        startTime: newStart,
        endTime: newEnd,
      }),
    ).rejects.toThrow(/cao hơn số đã thanh toán|thanh toán thêm/i);

    // And the booking must be untouched — times and amount both.
    const after = await Booking.findById(booking._id);
    expect(after.TotalAmount).toBe(paidAmount);
    expect(new Date(after.EndTime).getTime() - new Date(after.StartTime).getTime()).toBe(
      0.5 * HOUR,
    );
  });

  test("a same-length reschedule still works and keeps the amount consistent", async () => {
    const booking = await bookAndPay(1);

    const newStart = alignedStart(5);
    const result = await rescheduleService.rescheduleBooking({
      bookingId: booking._id,
      userId: customer._id,
      role: "customer",
      startTime: newStart,
      endTime: new Date(newStart.getTime() + 1 * HOUR),
    });

    expect(result.booking).toBeTruthy();
    const after = await Booking.findById(booking._id);
    const netPaid = await getNetPaidForBooking(booking._id);
    // Whatever the new price is, it must not exceed what was actually paid.
    expect(after.TotalAmount).toBeLessThanOrEqual(netPaid);
  });

  test("an unpaid booking may still be re-priced upward", async () => {
    const start = alignedStart(2);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: new Date(start.getTime() + 0.5 * HOUR),
    });
    const originalTotal = booking.TotalAmount;

    const newStart = alignedStart(4);
    await rescheduleService.rescheduleBooking({
      bookingId: booking._id,
      userId: customer._id,
      role: "customer",
      startTime: newStart,
      endTime: new Date(newStart.getTime() + 4 * HOUR),
    });

    // Nothing was paid, so the price is free to move — and must move, since
    // the window grew eightfold.
    const after = await Booking.findById(booking._id);
    expect(after.TotalAmount).toBeGreaterThan(originalTotal);
  });
});

describe("Hold expiry leaves in-flight checkouts alone", () => {
  let host;
  let customer;
  let space;

  beforeEach(async () => {
    await clearDb();
    host = await createUser({ email: "host-expire@test.com", role: "host" });
    customer = await createUser({ email: "cust-expire@test.com", role: "customer" });
    ({ space } = await seedHostSpace(host));
  });

  async function staleBooking() {
    const start = alignedStart(3);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: new Date(start.getTime() + 1 * HOUR),
    });
    // Push the hold into the past so the sweeper considers it.
    await Booking.updateOne(
      { _id: booking._id },
      { $set: { HoldExpiresAt: new Date(Date.now() - 60_000) } },
    );
    return booking;
  }

  test("a stale hold with no open checkout still expires", async () => {
    const booking = await staleBooking();

    const res = await bookingService.expireStaleHolds();
    expect(res.modifiedCount).toBeGreaterThan(0);

    const after = await Booking.findById(booking._id);
    expect(after.Status).toBe("expired");
  });

  test.each(["created", "redirected", "pending"])(
    "a stale hold with a %s checkout session is left alone",
    async (sessionStatus) => {
      const booking = await staleBooking();
      const statusBefore = (await Booking.findById(booking._id)).Status;

      await GatewayPayment.create({
        BookingID: booking._id,
        CustomerID: customer._id,
        HostID: host._id,
        SessionId: `sess-${sessionStatus}-${booking._id}`,
        Amount: booking.TotalAmount,
        Status: sessionStatus,
      });

      const res = await bookingService.expireStaleHolds();
      expect(res.skippedInFlight).toBeGreaterThan(0);

      // The customer may be on the provider's page right now; expiring here is
      // what produced "paid for nothing".
      const after = await Booking.findById(booking._id);
      expect(after.Status).toBe(statusBefore);
      expect(after.Status).not.toBe("expired");
    },
  );

  test("a settled or failed session does not protect the hold", async () => {
    const booking = await staleBooking();
    await GatewayPayment.create({
      BookingID: booking._id,
      CustomerID: customer._id,
      HostID: host._id,
      SessionId: `sess-failed-${booking._id}`,
      Amount: booking.TotalAmount,
      Status: "failed",
    });

    await bookingService.expireStaleHolds();
    const after = await Booking.findById(booking._id);
    expect(after.Status).toBe("expired");
  });
});
