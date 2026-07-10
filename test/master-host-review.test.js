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

describe('Optional simplewebauthn helper', () => {
  test('trySimpleWebAuthnVerify skips when package or payload missing', async () => {
    const result = await trySimpleWebAuthnVerify({
      credential: { CredentialId: 'x', PublicKey: '', Counter: 0 },
      challenge: 'ch',
      credentialId: 'x',
      clientDataJSON: null,
      authenticatorData: null,
      signature: null,
      host: 'localhost',
    });
    expect(result).toBe('skipped');
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
