'use strict';

const request = require('supertest');
const fs = require('fs');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  agentWithAuth,
  seedHostSpace,
  futureRange,
  getApp,
  getCsrfPair,
  withCsrf,
} = require('./helpers');
const jobQueue = require('../services/jobQueue');
const { runBookingReminders } = require('../jobs/bookingReminders');
const { tick } = require('../jobs/jobWorker');
const bookingService = require('../services/bookingService');
const Booking = require('../models/Booking');
const ledgerService = require('../services/ledgerService');
const { scanBufferOptional, clamavEnabled } = require('../services/clamavService');

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

describe('Background jobs', () => {
  test('enqueue export ledger and process', async () => {
    const host = await createUser({ email: 'hj@test.com', role: 'host' });
    await ledgerService.postEntry({
      hostId: host._id,
      type: 'payment',
      amount: 100000,
      direction: 'credit',
      idempotencyKey: 'job-pay-1',
    });

    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);
    const enq = await withCsrf(
      request(app).post('/api/host/exports/ledger'),
      csrf,
      `authToken=${token}`
    );
    expect(enq.status).toBe(202);
    expect(enq.body.jobId).toBeTruthy();

    const processed = await jobQueue.processNextJob();
    expect(processed.Status).toBe('completed');
    expect(processed.Result.file).toMatch(/ledger-/);
    expect(fs.existsSync(processed.Result.file)).toBe(true);

    const st = await request(app)
      .get(`/api/jobs/${enq.body.jobId}`)
      .set('Cookie', `authToken=${token}`);
    expect(st.status).toBe(200);
    expect(st.body.job.Status).toBe('completed');
  });

  test('booking reminder enqueue', async () => {
    const host = await createUser({ email: 'hrm2@test.com', role: 'host' });
    const customer = await createUser({ email: 'crm2@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    // Align to BOOKING_SLOT_MINUTES (30) — raw Date.now()+1h may misalign
    const { start, end } = futureRange(1, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    await bookingService.confirmBooking(host._id, booking._id);

    const r = await runBookingReminders();
    expect(r.enqueued).toBeGreaterThanOrEqual(1);
    const fresh = await Booking.findById(booking._id);
    expect(fresh.ReminderSent).toBe(true);

    await tick();
  });
});

describe('ClamAV optional', () => {
  test('skipped when not configured', async () => {
    expect(clamavEnabled()).toBe(false);
    const r = await scanBufferOptional(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(r.skipped).toBe(true);
  });
});
