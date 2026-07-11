'use strict';

process.env.NODE_ENV = 'test';
process.env.ENABLE_TRANSACTIONS = 'true';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test_jwt_secret_key_at_least_32_characters_long_for_workhub';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.setTimeout(180000);

let replset;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(replset.getUri());
  await mongoose.connection.db.admin().command({ ping: 1 });
  const env = require('../config/env');
  env.ENABLE_TRANSACTIONS = true;
  // Ensure collections exist before multi-doc transactions
  const models = [
    require('../models/User'),
    require('../models/Branch'),
    require('../models/Space'),
    require('../models/Booking'),
    require('../models/BookingSlot'),
    require('../models/OutboxEvent'),
    require('../models/PricingRule'),
  ];
  for (const m of models) {
    try {
      await m.createCollection();
    } catch {
      /* exists */
    }
    // Force collection materialization for wiredTiger lock catalog
    try {
      await m.collection.insertOne({ __warmup: true });
      await m.collection.deleteMany({ __warmup: true });
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 400));
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
});

describe('booking-transactions', () => {
  test('create booking writes outbox side effects (no direct notify inside txn)', async () => {
    const User = require('../models/User');
    const Branch = require('../models/Branch');
    const Space = require('../models/Space');
    const OutboxEvent = require('../models/OutboxEvent');
    const bookingService = require('../services/bookingService');

    const host = await User.create({
      Email: `hb-${Date.now()}@t.local`,
      PasswordHash: 'x'.repeat(60),
      FullName: 'Host B',
      Role: 'host',
      Status: 'active',
      EmailVerified: true,
    });
    const cust = await User.create({
      Email: `cb-${Date.now()}@t.local`,
      PasswordHash: 'x'.repeat(60),
      FullName: 'Cust B',
      Role: 'customer',
      Status: 'active',
      EmailVerified: true,
    });
    const branch = await Branch.create({
      HostID: host._id,
      Name: 'Br',
      Address: '1 St',
      OpeningTime: '08:00',
      ClosingTime: '22:00',
      Status: 'active',
    });
    const space = await Space.create({
      BranchID: branch._id,
      HostID: host._id,
      SpaceCode: `S-${Date.now()}`,
      Name: 'Room',
      Category: 'meeting_room',
      PricePerHour: 100000,
      DepositAmount: 30000,
      Status: 'available',
    });

    const start = new Date();
    start.setUTCHours(start.getUTCHours() + 2, 0, 0, 0);
    const step = 30 * 60 * 1000;
    const alignedStart = new Date(Math.ceil(start.getTime() / step) * step);
    const alignedEnd = new Date(alignedStart.getTime() + 60 * 60 * 1000);

    const booking = await bookingService.createBooking({
      customerId: cust._id,
      spaceId: space._id,
      startTime: alignedStart,
      endTime: alignedEnd,
      note: 'tx test',
    });
    expect(booking._id).toBeTruthy();

    const audit = await OutboxEvent.findOne({
      IdempotencyKey: `booking:${booking._id}:audit-created`,
    });
    expect(audit).toBeTruthy();
    const notify = await OutboxEvent.findOne({
      IdempotencyKey: `booking:${booking._id}:notify-host`,
    });
    expect(notify).toBeTruthy();
  });

  test('stale hold slots released in transaction mode', async () => {
    const User = require('../models/User');
    const Branch = require('../models/Branch');
    const Space = require('../models/Space');
    const Booking = require('../models/Booking');
    const BookingSlot = require('../models/BookingSlot');
    const bookingService = require('../services/bookingService');

    const host = await User.create({
      Email: `hs-${Date.now()}@t.local`,
      PasswordHash: 'x'.repeat(60),
      FullName: 'Host S',
      Role: 'host',
      Status: 'active',
      EmailVerified: true,
    });
    const cust = await User.create({
      Email: `cs-${Date.now()}@t.local`,
      PasswordHash: 'x'.repeat(60),
      FullName: 'Cust S',
      Role: 'customer',
      Status: 'active',
      EmailVerified: true,
    });
    const branch = await Branch.create({
      HostID: host._id,
      Name: 'Br2',
      Address: '2 St',
      OpeningTime: '08:00',
      ClosingTime: '22:00',
      Status: 'active',
    });
    const space = await Space.create({
      BranchID: branch._id,
      HostID: host._id,
      SpaceCode: `S2-${Date.now()}`,
      Name: 'Room2',
      Category: 'meeting_room',
      PricePerHour: 100000,
      Status: 'available',
    });

    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 1);
    start.setUTCHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const stale = await Booking.create({
      CustomerID: cust._id,
      HostID: host._id,
      SpaceID: space._id,
      StartTime: start,
      EndTime: end,
      TotalAmount: 100000,
      DepositAmount: 30000,
      Status: 'hold',
      HoldExpiresAt: new Date(Date.now() - 60000),
    });
    await BookingSlot.create({
      SpaceID: space._id,
      BookingID: stale._id,
      SlotStart: start,
    });

    const booking = await bookingService.createBooking({
      customerId: cust._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    expect(booking._id).toBeTruthy();

    const staleAgain = await Booking.findById(stale._id);
    expect(staleAgain.Status).toBe('expired');
    const staleSlots = await BookingSlot.countDocuments({
      BookingID: stale._id,
    });
    expect(staleSlots).toBe(0);
  });
});
