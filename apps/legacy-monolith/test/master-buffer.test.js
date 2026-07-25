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
const Space = require('../models/Space');
const { roleHas } = require('../policies/permissions');
const { calendarDeepLinks } = require('../services/calendarService');

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

describe('Buffer / cleanup conflict', () => {
  test('cleanup blocks back-to-back booking', async () => {
    const host = await createUser({ email: 'hbuf@test.com', role: 'host' });
    const c1 = await createUser({ email: 'cb1@test.com', role: 'customer' });
    const c2 = await createUser({ email: 'cb2@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    await Space.updateOne(
      { _id: space._id },
      { $set: { CleanupAfterMinutes: 30, BufferBeforeMinutes: 0 } }
    );

    // Fixed window: use absolute times far ahead
    const base = new Date(Date.now() + 72 * 3600000);
    base.setMinutes(0, 0, 0);
    const start1 = new Date(base);
    start1.setHours(10, 0, 0, 0);
    const end1 = new Date(base);
    end1.setHours(11, 0, 0, 0);
    const start2 = new Date(base);
    start2.setHours(11, 0, 0, 0);
    const end2 = new Date(base);
    end2.setHours(12, 0, 0, 0);

    await bookingService.createBooking({
      customerId: c1._id,
      spaceId: space._id,
      startTime: start1,
      endTime: end1,
    });

    await expect(
      bookingService.createBooking({
        customerId: c2._id,
        spaceId: space._id,
        startTime: start2,
        endTime: end2,
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test('zero cleanup allows adjacent slots', async () => {
    const host = await createUser({ email: 'hbuf2@test.com', role: 'host' });
    const c1 = await createUser({ email: 'cb3@test.com', role: 'customer' });
    const c2 = await createUser({ email: 'cb4@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);

    const base = new Date(Date.now() + 96 * 3600000);
    base.setMinutes(0, 0, 0);
    const start1 = new Date(base);
    start1.setHours(10, 0, 0, 0);
    const end1 = new Date(base);
    end1.setHours(11, 0, 0, 0);
    const start2 = new Date(base);
    start2.setHours(11, 0, 0, 0);
    const end2 = new Date(base);
    end2.setHours(12, 0, 0, 0);

    await bookingService.createBooking({
      customerId: c1._id,
      spaceId: space._id,
      startTime: start1,
      endTime: end1,
    });
    const b2 = await bookingService.createBooking({
      customerId: c2._id,
      spaceId: space._id,
      startTime: start2,
      endTime: end2,
    });
    expect(b2._id).toBeTruthy();
  });
});

describe('Calendar links + permissions + notes', () => {
  test('deep links and host note', async () => {
    expect(roleHas('owner', 'finance:view')).toBe(true);
    expect(roleHas('receptionist', 'finance:view')).toBe(false);
    expect(roleHas('finance', 'payment:verify')).toBe(true);

    const host = await createUser({ email: 'hnote@test.com', role: 'host' });
    const customer = await createUser({ email: 'cnote@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(5, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    const links = calendarDeepLinks(booking);
    expect(links.google).toContain('calendar.google.com');
    expect(links.outlook).toContain('outlook');

    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);
    const note = await withCsrf(
      request(app).post(`/api/host/bookings/${booking._id}/notes`),
      csrf,
      `authToken=${token}`
    ).send({ body: 'Khách VIP' });
    expect(note.status).toBe(201);
    expect(note.body.notes.length).toBe(1);

    const { token: cTok } = agentWithAuth(app, customer);
    const detail = await request(app)
      .get(`/api/customers/me/bookings/${booking._id}`)
      .set('Cookie', `authToken=${cTok}`);
    expect(detail.status).toBe(200);
    expect(detail.body.calendarLinks.google).toBeTruthy();
    expect(detail.body.cancelPreview).toBeTruthy();

    const patch = await withCsrf(
      request(app).patch(`/api/host/spaces/${space._id}/ops`),
      csrf,
      `authToken=${token}`
    ).send({ cleanupAfterMinutes: 15, instantBook: true });
    expect(patch.status).toBe(200);
    expect(patch.body.space.CleanupAfterMinutes).toBe(15);

    expect((await request(app).get('/consent')).status).toBe(200);
    expect((await request(app).get('/booking/detail')).status).toBe(200);
    expect((await request(app).get('/api/privacy/policy')).body.version).toBeTruthy();
  });
});
