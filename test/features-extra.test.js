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
const couponService = require('../services/couponService');
const favoriteService = require('../services/favoriteService');
const Coupon = require('../models/Coupon');
const calendarService = require('../services/calendarService');

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

describe('Favorites', () => {
  test('customer can add and list favorites', async () => {
    const host = await createUser({ email: 'h@test.com', role: 'host' });
    const customer = await createUser({ email: 'c@test.com', role: 'customer' });
    const { branch } = await seedHostSpace(host);
    await favoriteService.addFavorite(customer._id, branch._id);
    const list = await favoriteService.listFavorites(customer._id);
    expect(list.length).toBe(1);
  });
});

describe('Coupons', () => {
  test('percent coupon reduces total on booking', async () => {
    await Coupon.create({
      Code: 'TEST10',
      Type: 'percent',
      Value: 10,
      Status: 'active',
      MinOrderAmount: 0,
    });
    const host = await createUser({ email: 'h2@test.com', role: 'host' });
    const customer = await createUser({ email: 'c2@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(3, 2);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
      couponCode: 'TEST10',
    });
    expect(booking.DiscountAmount).toBeGreaterThan(0);
    expect(booking.Snapshot.SpaceName).toBeTruthy();
  });

  test('invalid coupon rejected', async () => {
    await expect(
      couponService.validateCoupon({ code: 'NOPE', userId: null, orderAmount: 100000 })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('Host calendar API', () => {
  test('host sees only own events', async () => {
    const host = await createUser({ email: 'h3@test.com', role: 'host' });
    const customer = await createUser({ email: 'c3@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(4, 1);
    await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    const data = await calendarService.getHostCalendar({
      hostId: host._id,
      from: new Date(Date.now() - 86400000),
      to: new Date(Date.now() + 14 * 86400000),
    });
    expect(data.events.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Booking ICS + me routes', () => {
  test('customer downloads ics', async () => {
    const host = await createUser({ email: 'h4@test.com', role: 'host' });
    const customer = await createUser({ email: 'c4@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(5, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    const { token } = agentWithAuth(app, customer);
    const res = await request(app)
      .get(`/api/me/bookings/${booking._id}/ics`)
      .set('Cookie', `authToken=${token}`);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/BEGIN:VCALENDAR/);
  });

  test('wizard page is public shell 200', async () => {
    const res = await request(app).get('/booking/wizard');
    expect(res.status).toBe(200);
  });
});

describe('Messaging', () => {
  test('customer and host can message on booking', async () => {
    const host = await createUser({ email: 'h5@test.com', role: 'host' });
    const customer = await createUser({ email: 'c5@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(6, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    const { token: cToken } = agentWithAuth(app, customer);
    const csrf = await getCsrfPair(app);
    const res = await withCsrf(
      request(app).post(`/api/me/bookings/${booking._id}/messages`),
      csrf,
      `authToken=${cToken}`
    ).send({ body: 'Hello host' });
    expect(res.status).toBe(201);
  });
});
