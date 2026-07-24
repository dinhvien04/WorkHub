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

describe('Customer dashboard check-in ready + mint QR', () => {
  test('dashboard returns checkInReady; mint token works', async () => {
    const host = await createUser({ email: 'hdash@test.com', role: 'host' });
    const customer = await createUser({ email: 'cdash@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    // Start soon (within 4h window used by service) — use 1h from now
    const { start, end } = futureRange(1, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    await bookingService.confirmBooking(host._id, booking._id);

    const { token } = agentWithAuth(app, customer);
    const dash = await request(app)
      .get('/api/me/dashboard')
      .set('Cookie', `authToken=${token}`);
    expect(dash.status).toBe(200);
    expect(dash.body.counts).toBeTruthy();
    expect(Array.isArray(dash.body.checkInReady)).toBe(true);
    expect(dash.body.checkInReady.length).toBeGreaterThanOrEqual(1);
    expect(dash.body.checkInReady[0].bookingCode).toMatch(/^WH-/);

    const csrf = await getCsrfPair(app);
    const mint = await withCsrf(
      request(app).post(`/api/bookings/${booking._id}/check-in-token`),
      csrf,
      `authToken=${token}`
    ).send({});
    expect(mint.status).toBe(200);
    expect(mint.body.token).toBeTruthy();
    expect(mint.body.code).toMatch(/^WH-/);
    expect(mint.body.expiresAt).toBeTruthy();
  });
});

describe('i18n lang cookie + notification prefs lang/tz', () => {
  test('set lang and prefs', async () => {
    const i18n = await request(app).get('/api/i18n?lang=en');
    expect(i18n.status).toBe(200);
    expect(i18n.body.lang).toBe('en');
    expect(i18n.body.messages['dash.title']).toMatch(/Overview|Tổng/i);

    const set = await request(app).post('/api/i18n/lang').send({ lang: 'en' });
    expect(set.status).toBe(200);
    expect(set.body.lang).toBe('en');
    const setCookie = set.headers['set-cookie'] || [];
    expect(setCookie.join(';')).toMatch(/lang=en/);

    const user = await createUser({ email: 'ci18n@test.com', role: 'customer' });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);
    const prefs = await withCsrf(
      request(app).put('/api/me/notification-prefs'),
      csrf,
      `authToken=${token}`
    ).send({
      email: true,
      push: false,
      sms: false,
      marketing: false,
      lang: 'en',
      timezone: 'Asia/Singapore',
    });
    expect(prefs.status).toBe(200);

    const fresh = await User.findById(user._id);
    expect(fresh.PreferredLang).toBe('en');
    expect(fresh.Timezone).toBe('Asia/Singapore');
    expect(fresh.NotifyPush).toBe(false);

    const get = await request(app)
      .get('/api/me/notification-prefs')
      .set('Cookie', `authToken=${token}`);
    expect(get.body.prefs.lang).toBe('en');
    expect(get.body.prefs.timezone).toBe('Asia/Singapore');
  });

  test('dashboard page has check-in section markup', async () => {
    const page = await request(app).get('/dashboard');
    expect(page.status).toBe(200);
    expect(page.text).toContain('dash-checkin');
    expect(page.text).toContain('dash-qr-modal');
    expect(page.text).toContain('i18n.js');
    expect(page.text).toContain('data-lang-set');
  });
});
