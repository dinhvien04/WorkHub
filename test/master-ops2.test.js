'use strict';

const request = require('supertest');
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
const bookingService = require('../services/bookingService');
const cancellationPolicyService = require('../services/cancellationPolicyService');
const { sniffImageOrPdf, assertAllowedMagic } = require('../utils/magicBytes');
const { presentBooking } = require('../presenters/bookingPresenter');
const { runHoldReminders } = require('../jobs/holdReminders');
const Booking = require('../models/Booking');

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

describe('Cancellation policy', () => {
  test('snapshot on create + cancel preview', async () => {
    const host = await createUser({ email: 'hpol@test.com', role: 'host' });
    const customer = await createUser({ email: 'cpol@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(48, 2); // 48h ahead → within 24h free-cancel window
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    expect(booking.CancellationPolicy).toBeTruthy();
    expect(booking.CancellationPolicy.freeCancelHours).toBe(24);

    const preview = cancellationPolicyService.evaluateCancellation(booking.toObject(), {
      now: new Date(),
    });
    expect(preview.canCancel).toBe(true);
    expect(preview.withinFreeWindow).toBe(true);

    const { token } = agentWithAuth(app, customer);
    const res = await request(app)
      .get(`/api/bookings/${booking._id}/cancel-preview`)
      .set('Cookie', `authToken=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.cancelPreview.policy).toBeTruthy();
  });

  test('snapshot on create + cancel preview with freeCancelHours = 0', async () => {
    const host = await createUser({ email: 'hpol0@test.com', role: 'host' });
    const customer = await createUser({ email: 'cpol0@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);

    // Explicitly update Space to have FreeCancelHours = 0
    space.FreeCancelHours = 0;
    await space.save();

    const { start, end } = futureRange(1, 2); // 1h ahead (less than 24h)
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    expect(booking.CancellationPolicy).toBeTruthy();
    expect(booking.CancellationPolicy.freeCancelHours).toBe(0);

    const preview = cancellationPolicyService.evaluateCancellation(booking.toObject(), {
      now: new Date(),
    });
    expect(preview.canCancel).toBe(true);
    expect(preview.withinFreeWindow).toBe(true);
  });
});

describe('Timeline + inbox + onboarding', () => {
  test('timeline and host inbox', async () => {
    const host = await createUser({ email: 'hin@test.com', role: 'host' });
    const customer = await createUser({ email: 'cin@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(2, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    const { token: cTok } = agentWithAuth(app, customer);
    const tl = await request(app)
      .get(`/api/bookings/${booking._id}/timeline`)
      .set('Cookie', `authToken=${cTok}`);
    expect(tl.status).toBe(200);
    expect(tl.body.events.length).toBeGreaterThan(0);

    const { token: hTok } = agentWithAuth(app, host);
    const inbox = await request(app)
      .get('/api/host/inbox?bucket=new')
      .set('Cookie', `authToken=${hTok}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.counts).toBeTruthy();
    expect(inbox.body.items.length).toBeGreaterThanOrEqual(1);

    const ob = await request(app)
      .get('/api/host/onboarding')
      .set('Cookie', `authToken=${hTok}`);
    expect(ob.status).toBe(200);
    expect(ob.body.progress).toBeGreaterThan(0);
  });
});

describe('Magic bytes + presenter + force logout', () => {
  test('jpeg sniff and force logout', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffImageOrPdf(jpeg)).toBe('image/jpeg');
    expect(() => assertAllowedMagic(Buffer.from('not-a-file'))).toThrow();

    const booking = {
      _id: 'x',
      Status: 'pending',
      TotalAmount: 1,
      DepositAmount: 1,
      CustomerID: 'c',
      HostID: 'h',
      SpaceID: 's',
    };
    const dto = presentBooking(booking, { role: 'customer' });
    expect(dto.id).toBe('x');
    expect(dto.customerId).toBeUndefined();

    const admin = await createUser({ email: 'adm@test.com', role: 'admin' });
    const victim = await createUser({ email: 'vic@test.com', role: 'customer' });
    const before = victim.tokenVersion || 0;
    const { token } = agentWithAuth(app, admin);
    const csrf = await getCsrfPair(app);
    const res = await withCsrf(
      request(app).post(`/api/admin/users/${victim._id}/force-logout`),
      csrf,
      `authToken=${token}`
    );
    expect(res.status).toBe(200);
    const User = require('../models/User');
    const fresh = await User.findById(victim._id);
    expect(fresh.tokenVersion).toBe(before + 1);
  });
});

describe('Hold reminder job', () => {
  test('marks reminder sent', async () => {
    const host = await createUser({ email: 'hrm@test.com', role: 'host' });
    const customer = await createUser({ email: 'crm@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(1, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
      holdMinutes: 15,
    });
    // Force hold expiry window into next 10 min
    await Booking.updateOne(
      { _id: booking._id },
      {
        $set: {
          HoldExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
          HoldReminderSent: false,
          Status: 'pending',
        },
      }
    );
    const result = await runHoldReminders();
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const fresh = await Booking.findById(booking._id);
    expect(fresh.HoldReminderSent).toBe(true);
  });
});
