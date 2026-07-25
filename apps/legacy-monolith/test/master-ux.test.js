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
const AddOn = require('../models/AddOn');
const Space = require('../models/Space');
const Review = require('../models/Review');
const User = require('../models/User');

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

describe('Add-ons + instant book', () => {
  test('booking includes add-on line items', async () => {
    const host = await createUser({ email: 'ha@test.com', role: 'host' });
    const customer = await createUser({ email: 'ca@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const addOn = await AddOn.create({
      HostID: host._id,
      Name: 'Projector',
      Price: 50000,
      Unit: 'booking',
      Status: 'active',
    });
    const { start, end } = futureRange(2, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
      addOns: [{ addOnId: addOn._id, quantity: 1 }],
    });
    expect(booking.AddOnsTotal).toBe(50000);
    expect(booking.AddOns[0].Name).toBe('Projector');
    expect(booking.TotalAmount).toBeGreaterThanOrEqual(50000);
  });

  test('instant book confirms immediately', async () => {
    const host = await createUser({ email: 'hi@test.com', role: 'host' });
    const customer = await createUser({ email: 'ci@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    await Space.updateOne({ _id: space._id }, { $set: { InstantBook: true } });
    const { start, end } = futureRange(3, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    expect(booking.Status).toBe('confirmed');
    expect(booking.InstantBook).toBe(true);
  });
});

describe('Conflict alternatives + receipt', () => {
  test('conflict returns alternatives', async () => {
    const host = await createUser({ email: 'hc@test.com', role: 'host' });
    const c1 = await createUser({ email: 'c1@test.com', role: 'customer' });
    const c2 = await createUser({ email: 'c2@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(5, 1);
    await bookingService.createBooking({
      customerId: c1._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    const { token } = agentWithAuth(app, c2);
    const csrf = await getCsrfPair(app);
    const res = await withCsrf(
      request(app).post('/api/customers/me/bookings'),
      csrf,
      `authToken=${token}`
    ).send({ spaceId: space._id, startTime: start, endTime: end });
    expect(res.status).toBe(409);
    expect(Array.isArray(res.body.alternatives)).toBe(true);
  });

  test('receipt html for owner', async () => {
    const host = await createUser({ email: 'hr@test.com', role: 'host' });
    const customer = await createUser({ email: 'cr@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(6, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    const { token } = agentWithAuth(app, customer);
    const rec = await request(app)
      .get(`/api/bookings/${booking._id}/receipt`)
      .set('Cookie', `authToken=${token}`);
    expect(rec.status).toBe(200);
    expect(rec.text).toContain('Receipt');
    expect(rec.text).toContain(String(booking._id));
  });
});

describe('Email verify + review report', () => {
  test('request and confirm email verification', async () => {
    const user = await createUser({ email: 'ev@test.com', role: 'customer' });
    await User.updateOne({ _id: user._id }, { $set: { EmailVerified: false } });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);
    const reqv = await withCsrf(
      request(app).post('/api/auth/email/request-verify'),
      csrf,
      `authToken=${token}`
    );
    expect(reqv.status).toBe(200);
    expect(reqv.body.devToken).toBeTruthy();

    const conf = await request(app)
      .post('/api/auth/email/confirm')
      .send({ token: reqv.body.devToken });
    expect(conf.status).toBe(200);
    expect(conf.body.verified).toBe(true);
    const fresh = await User.findById(user._id);
    expect(fresh.EmailVerified).toBe(true);
  });

  test('report review marks reported', async () => {
    const host = await createUser({ email: 'hre@test.com', role: 'host' });
    const customer = await createUser({ email: 'cre@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(7, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    booking.Status = 'completed';
    await booking.save();
    const review = await Review.create({
      SpaceID: space._id,
      CustomerID: customer._id,
      BookingID: booking._id,
      Rating: 2,
      Comment: 'noisy',
    });
    const reporter = await createUser({ email: 'rep@test.com', role: 'customer' });
    const { token } = agentWithAuth(app, reporter);
    const csrf = await getCsrfPair(app);
    const res = await withCsrf(
      request(app).post(`/api/reviews/${review._id}/report`),
      csrf,
      `authToken=${token}`
    ).send({ reason: 'spam' });
    expect(res.status).toBe(200);
    expect(res.body.review.Status).toBe('reported');
  });
});

describe('Admin SEO pages', () => {
  test('admin seo and health pages render', async () => {
    expect((await request(app).get('/admin/seo')).status).toBe(302);
    expect((await request(app).get('/sitemap_index.xml')).status).toBe(200);
  });
});
