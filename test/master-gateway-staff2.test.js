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
const { scanBuffer } = require('../services/uploadScanService');
const StaffMember = require('../models/StaffMember');

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

describe('Multi-provider gateway', () => {
  test('list providers and stripe_mock checkout webhook', async () => {
    const list = await request(app).get('/api/gateway/providers');
    expect(list.status).toBe(200);
    expect(list.body.providers.length).toBeGreaterThanOrEqual(3);

    const host = await createUser({ email: 'hgw@test.com', role: 'host' });
    const customer = await createUser({ email: 'cgw@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(2, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    // Client provider is ignored — server uses PAYMENT_PROVIDER / mock default
    const { session } = await gatewayService.createCheckoutSession({
      customerId: customer._id,
      bookingId: booking._id,
      paymentType: 'deposit',
      provider: 'stripe_mock',
      idempotencyKey: 'stripe-idem-1',
    });
    expect(['workhub_mock', 'stripe_mock', 'momo_mock'].includes(session.Provider)).toBe(true);

    const event = {
      type: 'checkout.session.completed',
      id: 'evt_stripe_1',
      data: { object: { id: session.SessionId } },
      provider: session.Provider,
    };
    event.sessionId = session.SessionId;
    const raw = JSON.stringify(event);
    const signature = gatewayService.signPayload(raw, session.Provider);
    const result = await gatewayService.handleWebhook({
      rawBody: raw,
      signature,
      event,
      provider: session.Provider,
    });
    expect(result.ok).toBe(true);
    expect(result.session.Status).toBe('succeeded');
  });
});

describe('Staff confirm + upload scan', () => {
  test('manager confirms booking; scan rejects html polyglot', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(scanBuffer(jpeg).ok).toBe(true);
    expect(() =>
      scanBuffer(Buffer.from('<html><script>alert(1)</script>'), { allowPdf: false })
    ).toThrow();

    const host = await createUser({ email: 'hstf@test.com', role: 'host' });
    const mgr = await createUser({ email: 'mgr2@test.com', role: 'customer' });
    const customer = await createUser({ email: 'cstf@test.com', role: 'customer' });
    await StaffMember.create({
      HostOwnerID: host._id,
      UserID: mgr._id,
      Role: 'manager',
      Status: 'active',
    });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(4, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    const { token } = agentWithAuth(app, mgr);
    const csrf = await getCsrfPair(app);
    const conf = await withCsrf(
      request(app).put(`/api/staff/host/bookings/${booking._id}/confirm`),
      csrf,
      `authToken=${token}`
    )
      .set('X-Host-Owner-Id', String(host._id))
      .send({});
    expect(conf.status).toBe(200);
    expect(conf.body.booking.Status).toBe('confirmed');
  });
});
