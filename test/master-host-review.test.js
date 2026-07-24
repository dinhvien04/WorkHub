'use strict';

const request = require('supertest');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  seedHostSpace,
  futureRange,
  absoluteRange,
  getApp,
  agentWithAuth,
  getCsrfPair,
  withCsrf,
} = require('./helpers');
const bookingService = require('../services/bookingService');
const Review = require('../models/Review');
const { trySimpleWebAuthnVerify } = require('../services/webauthnService');

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

describe('Review rating breakdown', () => {
  test('GET branch reviews returns breakdown + hostReply', async () => {
    const host = await createUser({ email: 'hrb@test.com', role: 'host' });
    const c1 = await createUser({ email: 'c1rb@test.com', role: 'customer' });
    const c2 = await createUser({ email: 'c2rb@test.com', role: 'customer' });
    const { space, branch } = await seedHostSpace(host);

    const day = new Date();
    day.setDate(day.getDate() + 5);
    day.setHours(0, 0, 0, 0);

    async function completedBooking(customer, startH, endH) {
      const { start, end } = absoluteRange(day, startH, 0, endH, 0);
      const booking = await bookingService.createBooking({
        customerId: customer._id,
        spaceId: space._id,
        startTime: start,
        endTime: end,
      });
      booking.Status = 'completed';
      await booking.save();
      return booking;
    }

    const b1 = await completedBooking(c1, 9, 10);
    const b2 = await completedBooking(c2, 11, 12);
    await Review.create({
      SpaceID: space._id,
      CustomerID: c1._id,
      BookingID: b1._id,
      Rating: 5,
      Comment: 'Great',
      HostReply: 'Cảm ơn bạn!',
      HostRepliedAt: new Date(),
    });
    await Review.create({
      SpaceID: space._id,
      CustomerID: c2._id,
      BookingID: b2._id,
      Rating: 3,
      Comment: 'Ok',
    });

    const res = await request(app).get(`/api/customers/branch/${branch._id}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body.reviews.length).toBe(2);
    expect(res.body.breakdown).toBeTruthy();
    expect(res.body.breakdown.total).toBe(2);
    expect(res.body.breakdown.average).toBe(4);
    expect(res.body.breakdown.counts[5]).toBe(1);
    expect(res.body.breakdown.counts[3]).toBe(1);
    expect(res.body.breakdown.percentages[5]).toBe(50);
    const withReply = res.body.reviews.find((r) => r.rating === 5);
    expect(withReply.hostReply).toContain('Cảm ơn');
  });
});

describe('Public host profile', () => {
  test('API and page for verified host; 404 for unverified', async () => {
    const host = await createUser({ email: 'hpub@test.com', role: 'host', hostVerified: true });
    await seedHostSpace(host);

    const api = await request(app).get(`/api/public/hosts/${host._id}`);
    expect(api.status).toBe(200);
    expect(api.body.host.companyName).toBe('Host Co');
    expect(api.body.host.stats.branchCount).toBeGreaterThanOrEqual(1);
    expect(api.body.host.hotlineMasked).toMatch(/\*/);
    // No bank secrets
    expect(JSON.stringify(api.body)).not.toMatch(/BankNumber|BankName|TaxCode/i);

    const page = await request(app).get(`/hosts/${host._id}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Host Co');
    expect(page.text).toContain('Đã xác minh');

    const unv = await createUser({
      email: 'hunv@test.com',
      role: 'host',
      hostVerified: false,
    });
    // ensure profile IsVerified false
    const HostProfile = require('../models/Host_Profile');
    await HostProfile.updateOne({ UserID: unv._id }, { $set: { IsVerified: false } });
    expect((await request(app).get(`/api/public/hosts/${unv._id}`)).status).toBe(404);
    expect((await request(app).get(`/hosts/${unv._id}`)).status).toBe(404);
  });
});

describe('WebAuthn fail-closed helper', () => {
  test('isEnabled false by default; stub cannot login', async () => {
    const webauthnService = require('../services/webauthnService');
    expect(webauthnService.isEnabled()).toBe(false);
    await expect(
      webauthnService.verifyLoginAssertion({
        challenge: 'ch',
        credentialId: 'x',
        signature: 'stub',
      })
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('Host reply still works with breakdown path', () => {
  test('host can reply then public list shows it', async () => {
    const host = await createUser({ email: 'hreply2@test.com', role: 'host' });
    const customer = await createUser({ email: 'creply2@test.com', role: 'customer' });
    const { space, branch } = await seedHostSpace(host);
    const { start, end } = futureRange(4, 1);
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
      Rating: 4,
      Comment: 'nice',
    });

    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);
    const reply = await withCsrf(
      request(app).post(`/api/host/reviews/${review._id}/reply`),
      csrf,
      `authToken=${token}`
    ).send({ reply: 'Thanks!' });
    expect(reply.status).toBe(200);

    const list = await request(app).get(`/api/customers/branch/${branch._id}/reviews`);
    expect(list.body.reviews[0].hostReply).toBe('Thanks!');
  });
});

describe('Review status filtering and privacy', () => {
  test('excludes non-published reviews from average rating calculations and stats', async () => {
    const host = await createUser({ email: 'h_status@test.com', role: 'host' });
    const customer = await createUser({ email: 'c_status@test.com', role: 'customer' });
    const { space, branch } = await seedHostSpace(host);

    const day = new Date();
    day.setDate(day.getDate() + 5);
    day.setHours(0, 0, 0, 0);

    async function completedBooking(startH, endH) {
      const { start, end } = absoluteRange(day, startH, 0, endH, 0);
      const booking = await bookingService.createBooking({
        customerId: customer._id,
        spaceId: space._id,
        startTime: start,
        endTime: end,
      });
      booking.Status = 'completed';
      await booking.save();
      return booking;
    }

    // 1. Create a published review with rating 5
    const b1 = await completedBooking(9, 10);
    const r1 = await Review.create({
      SpaceID: space._id,
      CustomerID: customer._id,
      BookingID: b1._id,
      Rating: 5,
      Comment: 'Excellent',
      Status: 'published',
    });

    // 2. Create a reported review with rating 1 (should be excluded)
    const b2 = await completedBooking(11, 12);
    await Review.create({
      SpaceID: space._id,
      CustomerID: customer._id,
      BookingID: b2._id,
      Rating: 1,
      Comment: 'Reported issue',
      Status: 'reported',
    });

    // 3. Create a hidden review with rating 2 (should be excluded)
    const b3 = await completedBooking(13, 14);
    await Review.create({
      SpaceID: space._id,
      CustomerID: customer._id,
      BookingID: b3._id,
      Rating: 2,
      Comment: 'Hidden review',
      Status: 'hidden',
    });

    // Recalculate average ratings
    await Review.calcAverageRatings(space._id);

    // Fetch the updated space & branch and verify average is 5 (since only published review counts)
    const SpaceModel = require('../models/Space');
    const BranchModel = require('../models/Branch');
    const updatedSpace = await SpaceModel.findById(space._id);
    const updatedBranch = await BranchModel.findById(branch._id);

    expect(updatedSpace.RatingAvg).toBe(5);
    expect(updatedBranch.RatingAvg).toBe(5);

    // Test review stats service / controller responses
    const res = await request(app).get(`/api/customers/branch/${branch._id}/reviews`);
    expect(res.status).toBe(200);
    // Should only return 1 review (the published one)
    expect(res.body.reviews.length).toBe(1);
    expect(res.body.reviews[0]._id.toString()).toBe(r1._id.toString());
    // Breakdown should only count the published one
    expect(res.body.breakdown.total).toBe(1);
    expect(res.body.breakdown.average).toBe(5);
    expect(res.body.breakdown.counts[5]).toBe(1);
    expect(res.body.breakdown.counts[1]).toBe(0);
    expect(res.body.breakdown.counts[2]).toBe(0);
  });

  test('does not expose customer email in listHostReviews and listAdminReviews APIs', async () => {
    const host = await createUser({ email: 'h_privacy@test.com', role: 'host', hostVerified: true });
    const admin = await createUser({ email: 'admin_privacy@test.com', role: 'admin' });
    const customer = await createUser({ email: 'c_privacy@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);

    const day = new Date();
    day.setDate(day.getDate() + 5);
    day.setHours(0, 0, 0, 0);
    const { start, end } = absoluteRange(day, 9, 0, 10, 0);

    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    booking.Status = 'completed';
    await booking.save();

    await Review.create({
      SpaceID: space._id,
      CustomerID: customer._id,
      BookingID: booking._id,
      Rating: 4,
      Comment: 'good',
      Status: 'reported', // set as reported so it shows up in default admin listing too
    });

    // 1. Check host review list API
    const hostAuth = agentWithAuth(app, host);
    const hostRes = await request(app)
      .get('/api/host/reviews')
      .set('Cookie', `authToken=${hostAuth.token}`);
    expect(hostRes.status).toBe(200);
    expect(hostRes.body.reviews.length).toBeGreaterThanOrEqual(1);
    expect(hostRes.body.reviews[0].CustomerID).toBeTruthy();
    expect(hostRes.body.reviews[0].CustomerID.FullName).toBe('Test User');
    // Ensure email is not exposed
    expect(hostRes.body.reviews[0].CustomerID.Email).toBeUndefined();

    // 2. Check admin review list API
    const adminAuth = agentWithAuth(app, admin);
    const adminRes = await request(app)
      .get('/api/admin/reviews')
      .set('Cookie', `authToken=${adminAuth.token}`);
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.reviews.length).toBeGreaterThanOrEqual(1);
    expect(adminRes.body.reviews[0].CustomerID).toBeTruthy();
    expect(adminRes.body.reviews[0].CustomerID.FullName).toBe('Test User');
    // Ensure email is not exposed
    expect(adminRes.body.reviews[0].CustomerID.Email).toBeUndefined();
  });
});
