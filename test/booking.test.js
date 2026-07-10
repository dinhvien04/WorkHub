'use strict';

process.env.NODE_ENV = 'test';
process.env.DISABLE_CSRF = '1';
process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'test_jwt_secret_key_at_least_32_characters_long_for_workhub';

const bookingService = require('../services/bookingService');
const Booking = require('../models/Booking');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  seedHostSpace,
  futureRange,
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

  test('cannot book inactive/maintenance space', async () => {
    const host = await createUser({ email: 'h3@test.com', role: 'host' });
    const customer = await createUser({ email: 'c3@test.com', role: 'customer' });
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

  test('concurrent bookings same slot: only one succeeds', async () => {
    const host = await createUser({ email: 'h4@test.com', role: 'host' });
    const c1 = await createUser({ email: 'c4a@test.com', role: 'customer' });
    const c2 = await createUser({ email: 'c4b@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(8, 2);

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

    const count = await Booking.countDocuments({
      SpaceID: space._id,
      Status: { $in: ['pending', 'confirmed', 'in-use'] },
    });
    expect(count).toBe(1);
  });

  test('only in-use + expired becomes completed; pending does not', async () => {
    const host = await createUser({ email: 'h5@test.com', role: 'host' });
    const customer = await createUser({ email: 'c5@test.com', role: 'customer' });
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

    const p2 = await Booking.findById(pending._id);
    const i2 = await Booking.findById(inUse._id);
    expect(p2.Status).toBe('pending');
    expect(i2.Status).toBe('completed');
  });

  test('invalid transitions rejected', async () => {
    expect(() => bookingService.assertTransition('completed', 'cancelled')).toThrow();
    expect(() => bookingService.assertTransition('pending', 'in-use')).toThrow();
    expect(() => bookingService.assertTransition('confirmed', 'completed')).toThrow();
  });
});
