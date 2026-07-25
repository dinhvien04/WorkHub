'use strict';

const bookingService = require('../services/bookingService');
const Booking = require('../models/Booking');
const BookingSlot = require('../models/BookingSlot');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  seedHostSpace,
  futureRange,
  absoluteRange,
} = require('./helpers');

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearDb();
});

describe('Booking rules', () => {
  test('EndTime must be greater than StartTime', async () => {
    const host = await createUser({ email: 'h@test.com', role: 'host' });
    const customer = await createUser({ email: 'c@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const start = new Date(Date.now() + 3600_000);
    await expect(
      bookingService.createBooking({
        customerId: customer._id,
        spaceId: space._id,
        startTime: start,
        endTime: start,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('cannot book in the past', async () => {
    const host = await createUser({ email: 'h2@test.com', role: 'host' });
    const customer = await createUser({ email: 'c2@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const end = new Date(Date.now() - 3600_000);
    const start = new Date(end.getTime() - 3600_000);
    await expect(
      bookingService.createBooking({
        customerId: customer._id,
        spaceId: space._id,
        startTime: start,
        endTime: end,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('duration too long rejected before slots', async () => {
    const host = await createUser({ email: 'h3@test.com', role: 'host' });
    const customer = await createUser({ email: 'c3@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const start = new Date(Date.now() + 2 * 3600_000);
    const end = new Date(start.getTime() + 100 * 3600_000);
    await expect(
      bookingService.createBooking({
        customerId: customer._id,
        spaceId: space._id,
        startTime: start,
        endTime: end,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await Booking.countDocuments()).toBe(0);
    expect(await BookingSlot.countDocuments()).toBe(0);
  });

  test('inactive space rejected', async () => {
    const host = await createUser({ email: 'h4@test.com', role: 'host' });
    const customer = await createUser({ email: 'c4@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    space.Status = 'maintenance';
    await space.save();
    const { start, end } = futureRange(2, 2);
    await expect(
      bookingService.createBooking({
        customerId: customer._id,
        spaceId: space._id,
        startTime: start,
        endTime: end,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('partial overlap blocked: 10:00-11:00 vs 10:30-11:30', async () => {
    const host = await createUser({ email: 'h5@test.com', role: 'host' });
    const c1 = await createUser({ email: 'c5a@test.com', role: 'customer' });
    const c2 = await createUser({ email: 'c5b@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const base = new Date(Date.now() + 3 * 24 * 3600_000);
    // Aligned to BOOKING_SLOT_MINUTES (30); still partial-overlap
    const a = absoluteRange(base, 10, 0, 11, 0);
    const b = absoluteRange(base, 10, 30, 11, 30);

    await bookingService.createBooking({
      customerId: c1._id,
      spaceId: space._id,
      startTime: a.start,
      endTime: a.end,
    });
    await expect(
      bookingService.createBooking({
        customerId: c2._id,
        spaceId: space._id,
        startTime: b.start,
        endTime: b.end,
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test('nested overlap blocked', async () => {
    const host = await createUser({ email: 'h6@test.com', role: 'host' });
    const c1 = await createUser({ email: 'c6a@test.com', role: 'customer' });
    const c2 = await createUser({ email: 'c6b@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const base = new Date(Date.now() + 4 * 24 * 3600_000);
    // Aligned outer 10:00-12:00, nested 10:30-11:00
    const outer = absoluteRange(base, 10, 0, 12, 0);
    const inner = absoluteRange(base, 10, 30, 11, 0);

    await bookingService.createBooking({
      customerId: c1._id,
      spaceId: space._id,
      startTime: outer.start,
      endTime: outer.end,
    });
    await expect(
      bookingService.createBooking({
        customerId: c2._id,
        spaceId: space._id,
        startTime: inner.start,
        endTime: inner.end,
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test('adjacent non-overlap both succeed', async () => {
    const host = await createUser({ email: 'h7@test.com', role: 'host' });
    const c1 = await createUser({ email: 'c7a@test.com', role: 'customer' });
    const c2 = await createUser({ email: 'c7b@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const base = new Date(Date.now() + 5 * 24 * 3600_000);
    const a = absoluteRange(base, 10, 0, 10, 30);
    const b = absoluteRange(base, 10, 30, 11, 0);

    await bookingService.createBooking({
      customerId: c1._id,
      spaceId: space._id,
      startTime: a.start,
      endTime: a.end,
    });
    await bookingService.createBooking({
      customerId: c2._id,
      spaceId: space._id,
      startTime: b.start,
      endTime: b.end,
    });
    expect(await Booking.countDocuments({ Status: 'pending' })).toBe(2);
  });

  test('cancel releases slots for rebook', async () => {
    const host = await createUser({ email: 'h8@test.com', role: 'host' });
    const c1 = await createUser({ email: 'c8a@test.com', role: 'customer' });
    const c2 = await createUser({ email: 'c8b@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(10, 1);

    const booking = await bookingService.createBooking({
      customerId: c1._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    await bookingService.cancelBookingByCustomer(c1._id, booking._id);
    const rebook = await bookingService.createBooking({
      customerId: c2._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    expect(rebook._id).toBeTruthy();
  });

  test('concurrent bookings only one succeeds', async () => {
    const host = await createUser({ email: 'h9@test.com', role: 'host' });
    const c1 = await createUser({ email: 'c9a@test.com', role: 'customer' });
    const c2 = await createUser({ email: 'c9b@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(12, 2);

    const results = await Promise.allSettled([
      bookingService.createBooking({
        customerId: c1._id,
        spaceId: space._id,
        startTime: start,
        endTime: end,
      }),
      bookingService.createBooking({
        customerId: c2._id,
        spaceId: space._id,
        startTime: start,
        endTime: end,
      }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const fail = results.filter((r) => r.status === 'rejected');
    expect(ok.length).toBe(1);
    expect(fail.length).toBe(1);
    expect(fail[0].reason.statusCode).toBe(409);
  });

  test('only in-use expired becomes completed', async () => {
    const host = await createUser({ email: 'h10@test.com', role: 'host' });
    const customer = await createUser({ email: 'c10@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const pending = await Booking.create({
      CustomerID: customer._id,
      SpaceID: space._id,
      HostID: host._id,
      StartTime: new Date(Date.now() - 7200_000),
      EndTime: new Date(Date.now() - 3600_000),
      TotalAmount: 100,
      DepositAmount: 30,
      Status: 'pending',
    });
    const inUse = await Booking.create({
      CustomerID: customer._id,
      SpaceID: space._id,
      HostID: host._id,
      StartTime: new Date(Date.now() - 7200_000),
      EndTime: new Date(Date.now() - 1000),
      TotalAmount: 100,
      DepositAmount: 30,
      Status: 'in-use',
    });
    await bookingService.completeExpiredBookings();
    expect((await Booking.findById(pending._id)).Status).toBe('pending');
    expect((await Booking.findById(inUse._id)).Status).toBe('completed');
  });
});
