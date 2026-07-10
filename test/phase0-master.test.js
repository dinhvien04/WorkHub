'use strict';

const request = require('supertest');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  agentWithAuth,
  getApp,
  seedHostSpace,
  futureRange,
} = require('./helpers');
const paymentService = require('../services/paymentService');
const Booking = require('../models/Booking');
const { verifySignedToken, createCsrfToken } = require('../middlewares/csrfMiddleware');
const { slugify } = require('../utils/slugify');

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

describe('Phase 0 — admin page auth', () => {
  test('admin pages redirect without cookie', async () => {
    const res = await request(app).get('/admin/dashboard');
    expect([302, 301]).toContain(res.status);
    expect(String(res.headers.location || '')).toMatch(/login/i);
  });

  test('customer cannot open admin page', async () => {
    const user = await createUser({ email: 'c@test.com', role: 'customer' });
    const { token } = agentWithAuth(app, user);
    const res = await request(app)
      .get('/admin/users')
      .set('Cookie', `authToken=${token}`);
    expect([403, 302]).toContain(res.status);
  });
});

describe('Phase 0 — signed CSRF', () => {
  test('createCsrfToken is signed and verifiable', () => {
    const t = createCsrfToken();
    expect(verifySignedToken(t)).toBe(true);
    expect(verifySignedToken('not.signed.well')).toBe(false);
  });
});

describe('Phase 0 — SEO routes', () => {
  test('robots.txt and sitemap.xml', async () => {
    const robots = await request(app).get('/robots.txt');
    expect(robots.status).toBe(200);
    expect(robots.text).toMatch(/Sitemap:/i);

    const sm = await request(app).get('/sitemap.xml');
    expect(sm.status).toBe(200);
    expect(sm.text).toMatch(/urlset/);
  });

  test('slugify vietnamese', () => {
    expect(slugify('Quận 1 Hồ Chí Minh')).toMatch(/quan-1/);
  });
});

describe('Phase 0 — payment verify concurrency invariant', () => {
  test('two concurrent verifies cannot exceed TotalAmount', async () => {
    const host = await createUser({ email: 'h@test.com', role: 'host' });
    const customer = await createUser({ email: 'c2@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(2, 2);
    const booking = await Booking.create({
      CustomerID: customer._id,
      SpaceID: space._id,
      HostID: host._id,
      StartTime: start,
      EndTime: end,
      TotalAmount: 50000,
      DepositAmount: 30000,
      Status: 'pending',
    });

    const p1 = await paymentService.createPendingPayment({
      customerId: customer._id,
      bookingId: booking._id,
      paymentType: 'deposit',
      idempotencyKey: 'idem-conc-aaaaaaaaaa',
    });
    // Force second pending of different type with large amount by direct create
    const PaymentHistory = require('../models/Payment_History');
    const p2 = await PaymentHistory.create({
      BookingID: booking._id,
      CustomerID: customer._id,
      HostID: host._id,
      TransactionCode: 'TXN-BIG-' + Date.now(),
      Amount: 40000,
      PaymentType: 'remaining_balance',
      Status: 'pending',
      IdempotencyKey: 'idem-conc-bbbbbbbbbb',
    });

    const results = await Promise.allSettled([
      paymentService.verifyPayment(host._id, p1.payment._id),
      paymentService.verifyPayment(host._id, p2._id),
    ]);

    const paid = await paymentService.getSuccessfulPaidAmount(booking._id);
    expect(paid).toBeLessThanOrEqual(50000);
    // At least one may fail if over total
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(paid).toBeGreaterThan(0);
  });
});

describe('Phase 0 — health', () => {
  test('/health/live and ready', async () => {
    const live = await request(app).get('/health/live');
    expect(live.status).toBe(200);
    const ready = await request(app).get('/health/ready');
    expect([200, 503]).toContain(ready.status);
  });
});

describe('Phase 0 — CSP header present', () => {
  test('response has content-security-policy', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    const csp = res.headers['content-security-policy'] || '';
    expect(csp.toLowerCase()).toMatch(/script-src/);
    expect(csp).toMatch(/nonce-/);
  });
});
