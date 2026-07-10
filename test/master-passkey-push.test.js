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

describe('WebAuthn passkey flow', () => {
  test('register options + verify + login', async () => {
    const user = await createUser({ email: 'pk@test.com', role: 'customer', password: 'Pass1234' });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);

    const opts = await withCsrf(
      request(app).post('/api/auth/webauthn/register/options'),
      csrf,
      `authToken=${token}`
    );
    expect(opts.status).toBe(200);
    expect(opts.body.options.challenge).toBeTruthy();

    const credId = 'cred-test-' + Date.now();
    const reg = await withCsrf(
      request(app).post('/api/auth/webauthn/register/verify'),
      csrf,
      `authToken=${token}`
    ).send({
      challenge: opts.body.options.challenge,
      credentialId: credId,
      deviceName: 'Test key',
    });
    expect(reg.status).toBe(201);

    const list = await request(app)
      .get('/api/auth/webauthn/credentials')
      .set('Cookie', `authToken=${token}`);
    expect(list.status).toBe(200);
    expect(list.body.credentials.length).toBe(1);

    const loginOpts = await request(app)
      .post('/api/auth/webauthn/login/options')
      .send({ email: 'pk@test.com' });
    expect(loginOpts.status).toBe(200);
    expect(loginOpts.body.options.challenge).toBeTruthy();

    const login = await request(app)
      .post('/api/auth/webauthn/login/verify')
      .send({
        challenge: loginOpts.body.options.challenge,
        credentialId: credId,
        signature: 'stub',
      });
    expect(login.status).toBe(200);
    expect(login.body.user.email || login.body.user.role).toBeTruthy();
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
    await bookingService.confirmBooking(host._id, booking._id);

    const { token: cTok } = agentWithAuth(app, customer);
    const csrf = await getCsrfPair(app);
    const sub = await withCsrf(
      request(app).post('/api/push/subscribe'),
      csrf,
      `authToken=${cTok}`
    ).send({
      endpoint: 'https://push.example/test/' + Date.now(),
      keys: { p256dh: 'x', auth: 'y' },
    });
    expect(sub.status).toBe(201);

    const vapid = await request(app).get('/api/push/vapid-public-key');
    expect(vapid.status).toBe(200);

    const { token: sTok } = agentWithAuth(app, staff);
    const today = await request(app)
      .get('/api/staff/host/reception/today')
      .set('Cookie', `authToken=${sTok}`)
      .set('X-Host-Owner-Id', String(host._id));
    expect(today.status).toBe(200);
    expect(Array.isArray(today.body.bookings)).toBe(true);

    // receptionist cannot finance
    const fin = await request(app)
      .get('/api/host/balance')
      .set('Cookie', `authToken=${sTok}`);
    // staff is customer role — host balance requires host role
    expect([401, 403]).toContain(fin.status);
  });
});

describe('Detail map page renders', () => {
  test('detail and security pages', async () => {
    expect((await request(app).get('/security')).status).toBe(200);
    expect((await request(app).get('/consent')).status).toBe(200);
  });
});
