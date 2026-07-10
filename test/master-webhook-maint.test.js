'use strict';

const request = require('supertest');
const crypto = require('crypto');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  getApp,
  getCsrfPair,
  withCsrf,
  agentWithAuth,
  seedHostSpace,
  futureRange,
} = require('./helpers');
const {
  verifyStripeSignature,
  verifyMomoIpn,
  signForProvider,
} = require('../services/gatewayProviders');
const featureFlagService = require('../services/featureFlagService');
const bookingService = require('../services/bookingService');

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
  process.env.MAINTENANCE_MODE = '';
  await featureFlagService.upsertFlag({ key: 'kill_switch_platform', enabled: false });
});

describe('Stripe / MoMo signature helpers', () => {
  test('stripe v1 signature verifies', () => {
    const secret = 'whsec_test_secret';
    const rawBody = '{"type":"checkout.session.completed"}';
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    const header = `t=${t},v1=${v1}`;
    expect(verifyStripeSignature(rawBody, header, secret)).toBe(true);
    expect(verifyStripeSignature(rawBody, 't=1,v1=bad', secret)).toBe(false);
  });

  test('momo ipn signature verifies', () => {
    process.env.MOMO_ACCESS_KEY = 'access';
    process.env.MOMO_PARTNER_CODE = 'MOMO';
    const secret = 'secret';
    const event = {
      amount: 1000,
      extraData: '',
      message: 'Success',
      orderId: 'momo_1',
      orderInfo: 'info',
      orderType: 'momo_wallet',
      partnerCode: 'MOMO',
      payType: 'qr',
      requestId: 'momo_1',
      responseTime: 1,
      resultCode: 0,
      transId: 99,
    };
    const accessKey = 'access';
    const raw =
      `accessKey=${accessKey}&amount=${event.amount}&extraData=${event.extraData}&message=${event.message}` +
      `&orderId=${event.orderId}&orderInfo=${event.orderInfo}&orderType=${event.orderType}&partnerCode=${event.partnerCode}` +
      `&payType=${event.payType}&requestId=${event.requestId}&responseTime=${event.responseTime}` +
      `&resultCode=${event.resultCode}&transId=${event.transId}`;
    event.signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    expect(verifyMomoIpn(event, secret)).toBe(true);
    event.signature = 'deadbeef';
    expect(verifyMomoIpn(event, secret)).toBe(false);
  });

  test('plain hmac still works for mocks', () => {
    const raw = '{}';
    const sig = signForProvider('workhub_mock', raw);
    expect(sig).toHaveLength(64);
  });
});

describe('Maintenance mode + API version', () => {
  test('blocks mutating API when flag on; allows GET health', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.headers['x-workhub-version']).toBeTruthy();
    expect(health.headers['x-api-version']).toBe('1');

    await featureFlagService.upsertFlag({
      key: 'kill_switch_platform',
      enabled: true,
      percentage: 100,
    });

    const customer = await createUser({ email: 'maint@test.com', role: 'customer' });
    const { token } = agentWithAuth(app, customer);
    const csrf = await getCsrfPair(app);
    const blocked = await withCsrf(
      request(app).post('/api/me/favorites'),
      csrf,
      `authToken=${token}`
    ).send({ branchId: '000000000000000000000001' });
    expect(blocked.status).toBe(503);
    expect(blocked.body.code).toBe('MAINTENANCE');

    // GET still works
    const favs = await request(app)
      .get('/api/me/favorites')
      .set('Cookie', `authToken=${token}`);
    expect(favs.status).toBe(200);

    await featureFlagService.upsertFlag({ key: 'kill_switch_platform', enabled: false });
  });
});
