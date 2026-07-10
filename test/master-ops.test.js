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
const totpService = require('../services/totpService');
const bookingService = require('../services/bookingService');
const checkInService = require('../services/checkInService');
const featureFlagService = require('../services/featureFlagService');
const Blackout = require('../models/Blackout');
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
});

describe('TOTP 2FA', () => {
  test('setup enable and login requires 2fa', async () => {
    const admin = await createUser({
      email: 'admin2fa@test.com',
      role: 'admin',
      password: 'Pass1234',
    });
    const { token } = agentWithAuth(app, admin);
    const csrf = await getCsrfPair(app);

    const setup = await withCsrf(
      request(app).post('/api/auth/2fa/setup'),
      csrf,
      `authToken=${token}`
    );
    expect(setup.status).toBe(200);
    expect(setup.body.secret).toBeTruthy();

    const code = totpService.totpAt(setup.body.secret);
    const enable = await withCsrf(
      request(app).post('/api/auth/2fa/enable'),
      csrf,
      `authToken=${token}`
    ).send({ code });
    expect(enable.status).toBe(200);
    expect(enable.body.recoveryCodes?.length).toBeGreaterThan(0);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin2fa@test.com', password: 'Pass1234' });
    expect(login.status).toBe(200);
    expect(login.body.requires2fa).toBe(true);
    expect(login.body.pendingToken).toBeTruthy();

    const verify = await request(app)
      .post('/api/auth/2fa/verify')
      .send({
        pendingToken: login.body.pendingToken,
        code: totpService.totpAt(setup.body.secret),
      });
    expect(verify.status).toBe(200);
    expect(verify.body.user.role).toBe('admin');
    expect(verify.headers['set-cookie']?.some((c) => c.startsWith('authToken='))).toBe(true);
  });
});

describe('Blackout blocks booking', () => {
  test('cannot book during blackout', async () => {
    const host = await createUser({ email: 'hb@test.com', role: 'host' });
    const customer = await createUser({ email: 'cb@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(3, 1);
    await Blackout.create({
      HostID: host._id,
      SpaceID: space._id,
      StartTime: start,
      EndTime: end,
      Reason: 'maintenance',
    });
    await expect(
      bookingService.createBooking({
        customerId: customer._id,
        spaceId: space._id,
        startTime: start,
        endTime: end,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('QR check-in', () => {
  test('mint token and check-in', async () => {
    const host = await createUser({ email: 'hq@test.com', role: 'host' });
    const customer = await createUser({ email: 'cq@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    // Check-in window: at most 30 min before StartTime — keep start soon
    const { start, end } = futureRange(0.25, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    await bookingService.confirmBooking(host._id, booking._id);

    const minted = await checkInService.mintCheckInToken({
      bookingId: booking._id,
      actorId: customer._id,
      actorRole: 'customer',
    });
    expect(minted.token).toContain('.');
    expect(minted.code).toMatch(/^WH-/);

    const updated = await checkInService.checkInWithToken({
      hostId: host._id,
      token: minted.token,
    });
    expect(updated.Status).toBe('in-use');
  });
});

describe('Feature flags + SEO', () => {
  test('flag evaluation and sitemap index', async () => {
    await featureFlagService.upsertFlag({
      key: 'new_wizard',
      enabled: true,
      percentage: 100,
    });
    expect(await featureFlagService.isEnabled('new_wizard', { userId: 'u1' })).toBe(true);
    expect(await featureFlagService.isEnabled('missing_flag')).toBe(false);

    const sm = await request(app).get('/sitemap_index.xml');
    expect(sm.status).toBe(200);
    expect(sm.text).toContain('sitemapindex');

    await SeoRedirect.create({ FromPath: '/old-path', ToPath: '/khong-gian', StatusCode: 301 });
    const redir = await request(app).get('/old-path');
    expect(redir.status).toBe(301);
    expect(redir.headers.location).toBe('/khong-gian');
  });
});

describe('Notification prefs + system health', () => {
  test('update prefs and admin health', async () => {
    const user = await createUser({ email: 'pref@test.com', role: 'customer' });
    const admin = await createUser({ email: 'health@test.com', role: 'admin' });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);

    const put = await withCsrf(
      request(app).put('/api/me/notification-prefs'),
      csrf,
      `authToken=${token}`
    ).send({ email: false, marketing: true });
    expect(put.status).toBe(200);

    const { token: adminTok } = agentWithAuth(app, admin);
    const health = await request(app)
      .get('/api/admin/system-health')
      .set('Cookie', `authToken=${adminTok}`);
    expect(health.status).toBe(200);
    expect(health.body.version).toBeTruthy();
  });
});
