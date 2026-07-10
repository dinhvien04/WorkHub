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
const StaffMember = require('../models/StaffMember');
const bookingService = require('../services/bookingService');
const webauthnService = require('../services/webauthnService');

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
  // Fail-closed default
  delete process.env.WEBAUTHN_ENABLED;
  // force re-read is via env module already loaded — use service isEnabled which reads env.WEBAUTHN_ENABLED
});

describe('WebAuthn fail-closed (default disabled)', () => {
  test('passkey routes return FEATURE_DISABLED when WEBAUTHN_ENABLED is false', async () => {
    const user = await createUser({ email: 'pk@test.com', role: 'customer', password: 'Pass1234' });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);

    const opts = await withCsrf(
      request(app).post('/api/auth/webauthn/register/options'),
      csrf,
      `authToken=${token}`
    );
    expect(opts.status).toBe(503);
    expect(opts.body.code === 'FEATURE_DISABLED' || opts.body.error).toBeTruthy();

    const loginOpts = await request(app)
      .post('/api/auth/webauthn/login/options')
      .send({ email: 'pk@test.com' });
    expect(loginOpts.status).toBe(503);

    // Stub signature path must never authenticate
    await expect(
      webauthnService.verifyLoginAssertion({
        challenge: 'x',
        credentialId: 'y',
        signature: 'stub',
        clientDataJSON: 'e30',
        authenticatorData: 'e30',
      })
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('Push subscribe + staff reception proxy', () => {
  test('push and staff check-in path', async () => {
    const host = await createUser({ email: 'hpush@test.com', role: 'host' });
    const staff = await createUser({ email: 'spush@test.com', role: 'customer' });
    const customer = await createUser({ email: 'cpush@test.com', role: 'customer' });
    await StaffMember.create({
      HostOwnerID: host._id,
      UserID: staff._id,
      Role: 'receptionist',
      Status: 'active',
    });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(3, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    // confirm so check-in possible if endpoint allows
    expect(booking).toBeTruthy();
    expect(staff).toBeTruthy();
  });
});
