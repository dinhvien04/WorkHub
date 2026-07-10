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
  futureRange,
} = require('./helpers');
const bookingService = require('../services/bookingService');
const paymentService = require('../services/paymentService');
const emailService = require('../services/emailService');
const SeoRedirect = require('../models/SeoRedirect');

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
  emailService.clearDevOutbox();
});

describe('SEO redirect admin delete/toggle', () => {
  test('upsert list toggle delete', async () => {
    const admin = await createUser({ email: 'aseo@test.com', role: 'admin' });
    const { token } = agentWithAuth(app, admin);
    const csrf = await getCsrfPair(app);

    const up = await withCsrf(
      request(app).put('/api/admin/seo/redirects'),
      csrf,
      `authToken=${token}`
    ).send({
      fromPath: '/old-branch',
      toPath: '/khong-gian',
      statusCode: 301,
      note: 'legacy',
    });
    expect(up.status).toBe(200);
    expect(up.body.redirect.FromPath).toBe('/old-branch');
    const id = up.body.redirect._id;

    const list = await request(app)
      .get('/api/admin/seo/redirects')
      .set('Cookie', `authToken=${token}`);
    expect(list.status).toBe(200);
    expect(list.body.redirects.length).toBeGreaterThanOrEqual(1);

    const tog = await withCsrf(
      request(app).patch(`/api/admin/seo/redirects/${id}`),
      csrf,
      `authToken=${token}`
    ).send({ active: false });
    expect(tog.status).toBe(200);
    expect(tog.body.redirect.Active).toBe(false);

    const del = await withCsrf(
      request(app).delete(`/api/admin/seo/redirects/${id}`),
      csrf,
      `authToken=${token}`
    );
    expect(del.status).toBe(200);
    expect(await SeoRedirect.countDocuments()).toBe(0);
  });
});

describe('Payment emails', () => {
  test('pending payment queues customer email', async () => {
    const host = await createUser({ email: 'hpaye@test.com', role: 'host' });
    const customer = await createUser({ email: 'cpaye@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(4, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    emailService.clearDevOutbox();

    await paymentService.createPendingPayment({
      customerId: customer._id,
      bookingId: booking._id,
      paymentType: 'deposit',
      paymentMethod: 'bank_transfer',
      idempotencyKey: 'pay-email-test-key-001',
    });
    await new Promise((r) => setImmediate(r));
    const box = emailService.listDevOutbox();
    expect(box.length).toBeGreaterThanOrEqual(1);
    expect(box.some((e) => /thanh toán|payment/i.test(e.subject + e.body))).toBe(true);
  });
});

describe('Public status page', () => {
  test('GET /status renders health UI', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Trạng thái hệ thống');
    expect(res.text).toContain('/health/details');
    expect(res.text).toContain('st-version');
  });
});
