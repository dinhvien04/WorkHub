'use strict';

const request = require('supertest');
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
  absoluteRange,
} = require('./helpers');
const bookingService = require('../services/bookingService');
const Booking = require('../models/Booking');
const BookingSlot = require('../models/BookingSlot');
const {
  previewReschedule,
  rescheduleBooking,
} = require('../services/rescheduleService');

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

describe('Reschedule preview + apply', () => {
  test('preview free window then apply; conflict blocked', async () => {
    const host = await createUser({ email: 'hrs@test.com', role: 'host' });
    const customer = await createUser({ email: 'crs@test.com', role: 'customer' });
    const other = await createUser({ email: 'ors@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);

    const day = new Date();
    day.setDate(day.getDate() + 8);
    day.setHours(0, 0, 0, 0);
    const r1 = absoluteRange(day, 9, 0, 10, 0);
    const r2 = absoluteRange(day, 14, 0, 15, 0);
    const r3 = absoluteRange(day, 14, 0, 16, 0); // overlaps r2

    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: r1.start,
      endTime: r1.end,
      holdMinutes: 20,
    });
    await bookingService.confirmBooking(host._id, booking._id);

    // Other customer holds 14-15
    await bookingService.createBooking({
      customerId: other._id,
      spaceId: space._id,
      startTime: r2.start,
      endTime: r2.end,
    });

    const previewOk = await previewReschedule({
      bookingId: booking._id,
      userId: customer._id,
      role: 'customer',
      startTime: absoluteRange(day, 11, 0, 12, 0).start,
      endTime: absoluteRange(day, 11, 0, 12, 0).end,
    });
    expect(previewOk.available).toBe(true);
    expect(previewOk.canApply).toBe(true);
    expect(previewOk.quote).toBeTruthy();
    expect(previewOk.quote.hours).toBe(1);

    const previewConflict = await previewReschedule({
      bookingId: booking._id,
      userId: customer._id,
      role: 'customer',
      startTime: r3.start,
      endTime: r3.end,
    });
    expect(previewConflict.available).toBe(false);
    expect(previewConflict.canApply).toBe(false);

    const { token } = agentWithAuth(app, customer);
    const csrf = await getCsrfPair(app);

    const apiPreview = await withCsrf(
      request(app).post(`/api/bookings/${booking._id}/reschedule-preview`),
      csrf,
      `authToken=${token}`
    ).send({
      startTime: absoluteRange(day, 11, 0, 12, 0).start.toISOString(),
      endTime: absoluteRange(day, 11, 0, 12, 0).end.toISOString(),
    });
    expect(apiPreview.status).toBe(200);
    expect(apiPreview.body.preview.available).toBe(true);

    const apply = await withCsrf(
      request(app).put(`/api/bookings/${booking._id}/reschedule`),
      csrf,
      `authToken=${token}`
    ).send({
      startTime: absoluteRange(day, 11, 0, 12, 0).start.toISOString(),
      endTime: absoluteRange(day, 11, 0, 12, 0).end.toISOString(),
    });
    expect(apply.status).toBe(200);
    expect(apply.body.previous).toBeTruthy();

    const fresh = await Booking.findById(booking._id);
    expect(new Date(fresh.StartTime).getHours()).toBe(11);
    const slots = await BookingSlot.find({ BookingID: booking._id });
    expect(slots.length).toBeGreaterThan(0);

    // Conflict apply fails
    const fail = await withCsrf(
      request(app).put(`/api/bookings/${booking._id}/reschedule`),
      csrf,
      `authToken=${token}`
    ).send({
      startTime: r2.start.toISOString(),
      endTime: r2.end.toISOString(),
    });
    expect(fail.status).toBe(409);
  });

  test('booking detail includes canReschedule + HoldExpiresAt', async () => {
    const host = await createUser({ email: 'hrs2@test.com', role: 'host' });
    const customer = await createUser({ email: 'crs2@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const day = new Date();
    day.setDate(day.getDate() + 3);
    day.setHours(0, 0, 0, 0);
    const { start, end } = absoluteRange(day, 10, 0, 11, 0);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
      holdMinutes: 15,
    });
    const { token } = agentWithAuth(app, customer);
    const res = await request(app)
      .get(`/api/customers/me/bookings/${booking._id}`)
      .set('Cookie', `authToken=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.canReschedule).toBe(true);
    expect(res.body.booking.HoldExpiresAt).toBeTruthy();
  });

  test('booking detail page renders reschedule section markup', async () => {
    const page = await request(app).get('/booking/detail');
    expect(page.status).toBe(200);
    expect(page.text).toContain('bd-reschedule-section');
    expect(page.text).toContain('bd-hold');
    expect(page.text).toContain('booking-detail.js');
  });
});
