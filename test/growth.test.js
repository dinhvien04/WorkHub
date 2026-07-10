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
const gatewayService = require('../services/gatewayService');
const membershipService = require('../services/membershipService');
const fraudService = require('../services/fraudService');
const { MembershipPlan } = require('../models/Membership');
const payoutService = require('../services/payoutService');
const ledgerService = require('../services/ledgerService');
const paymentService = require('../services/paymentService');

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

describe('Gateway mock', () => {
  test('checkout + signed webhook marks payment successful', async () => {
    const host = await createUser({ email: 'hg@test.com', role: 'host' });
    const customer = await createUser({ email: 'cg@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(2, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    const { session } = await gatewayService.createCheckoutSession({
      customerId: customer._id,
      bookingId: booking._id,
      amount: booking.DepositAmount,
      idempotencyKey: 'gw-idem-000000000001',
    });

    const event = {
      type: 'checkout.session.completed',
      id: 'evt_1',
      sessionId: session.SessionId,
    };
    const raw = JSON.stringify(event);
    const signature = gatewayService.signPayload(raw);
    const result = await gatewayService.handleWebhook({ rawBody: raw, signature, event });
    expect(result.ok).toBe(true);
    expect(result.session.Status).toBe('succeeded');

    // replay idempotent
    const again = await gatewayService.handleWebhook({ rawBody: raw, signature, event });
    expect(again.duplicate).toBe(true);
  });

  test('invalid webhook signature rejected', async () => {
    await expect(
      gatewayService.handleWebhook({
        rawBody: '{}',
        signature: 'bad',
        event: { type: 'x', sessionId: 'nope' },
      })
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('Membership subscribe', () => {
  test('customer can subscribe once', async () => {
    await MembershipPlan.create({
      Name: 'Basic',
      Code: 'BASIC',
      MonthlyPrice: 100000,
      IncludedHours: 10,
      Status: 'active',
    });
    const customer = await createUser({ email: 'cm@test.com', role: 'customer' });
    const m = await membershipService.subscribe({ userId: customer._id, planCode: 'BASIC' });
    expect(m.CreditsRemaining).toBe(10);
    await expect(
      membershipService.subscribe({ userId: customer._id, planCode: 'BASIC' })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('Fraud score', () => {
  test('new account high amount scores review/block', () => {
    const r = fraudService.scoreBookingAttempt({
      userCreatedAt: new Date(),
      amount: 10_000_000,
      recentBookingCount: 6,
      recentFailedPayments: 4,
    });
    expect(r.score).toBeGreaterThanOrEqual(40);
    expect(['review', 'block']).toContain(r.action);
  });
});

describe('Payout', () => {
  test('cannot payout more than available', async () => {
    const host = await createUser({ email: 'hp@test.com', role: 'host' });
    await expect(
      payoutService.requestPayout({ hostId: host._id, amount: 100000 })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('payout after credit balance', async () => {
    const host = await createUser({ email: 'hp2@test.com', role: 'host' });
    await ledgerService.postEntry({
      hostId: host._id,
      type: 'payment',
      amount: 200000,
      direction: 'credit',
      idempotencyKey: 'pay-credit-1',
    });
    const p = await payoutService.requestPayout({
      hostId: host._id,
      amount: 100000,
      idempotencyKey: 'payout-1-aaaaaaa',
    });
    expect(p.Status).toBe('requested');
    const bal = await ledgerService.getHostBalance(host._id);
    expect(bal.available).toBe(100000);
  });
});

describe('Partner API key', () => {
  test('create key and list spaces', async () => {
    const admin = await createUser({ email: 'partner@test.com', role: 'admin' });
    const { token } = agentWithAuth(app, admin);
    const csrf = await getCsrfPair(app);
    const create = await withCsrf(
      request(app).post('/api/partner/keys'),
      csrf,
      `authToken=${token}`
    ).send({ name: 'test', scopes: ['spaces:read', 'bookings:read'] });
    expect(create.status).toBe(201);
    const secret = create.body.secret;
    expect(secret).toMatch(/^wh_/);

    const host = await createUser({ email: 'hs@test.com', role: 'host' });
    await seedHostSpace(host);

    const spaces = await request(app)
      .get('/api/partner/v1/spaces')
      .set('X-API-Key', secret);
    expect(spaces.status).toBe(200);
    expect(Array.isArray(spaces.body.spaces)).toBe(true);
  });
});

describe('i18n + pages', () => {
  test('i18n bundle and gateway page', async () => {
    expect((await request(app).get('/api/i18n?lang=en')).body.lang).toBe('en');
    expect((await request(app).get('/membership')).status).toBe(200);
    expect((await request(app).get('/security')).status).toBe(200);
  });
});

describe('Privacy + RUM + sessions', () => {
  test('export data and logout-all', async () => {
    const customer = await createUser({ email: 'priv@test.com', role: 'customer' });
    const { token } = agentWithAuth(app, customer);
    const csrf = await getCsrfPair(app);

    const exp = await request(app)
      .get('/api/me/privacy/export')
      .set('Cookie', `authToken=${token}`);
    expect(exp.status).toBe(200);
    expect(exp.body.user).toBeTruthy();
    expect(exp.body.user.PasswordHash).toBeUndefined();

    const rum = await request(app)
      .post('/api/rum')
      .send({ lcp: 1200, inp: 80, cls: 0.05, path: '/' });
    expect(rum.status).toBe(204);

    const logout = await withCsrf(
      request(app).post('/api/sessions/logout-all'),
      csrf,
      `authToken=${token}`
    );
    expect(logout.status).toBe(200);
  });
});
