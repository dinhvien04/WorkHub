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
const fs = require('fs');
const path = require('path');

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

describe('PWA assets', () => {
  test('manifest, service worker, offline shell served', async () => {
    const mf = await request(app).get('/manifest.webmanifest');
    expect(mf.status).toBe(200);
    expect(mf.text).toContain('WorkHub');
    expect(mf.text).toContain('shortcuts');

    const sw = await request(app).get('/sw.js');
    expect(sw.status).toBe(200);
    expect(sw.text).toContain('workhub-shell-v2');
    expect(sw.text).toContain('offline.html');
    expect(sw.text).toContain('/api/');

    const off = await request(app).get('/offline.html');
    expect(off.status).toBe(200);
    expect(off.text).toContain('offline');

    // layout registers SW + install bar
    const home = await request(app).get('/');
    expect(home.status).toBe(200);
    expect(home.text).toContain('serviceWorker');
    expect(home.text).toContain('pwa-install-bar');
    expect(home.text).toContain('beforeinstallprompt');

    expect(fs.existsSync(path.join(__dirname, '../public/offline.html'))).toBe(true);
  });
});

describe('Host inbox quick actions', () => {
  test('inbox lists pending; confirm via host API', async () => {
    const host = await createUser({ email: 'hinbox@test.com', role: 'host' });
    const customer = await createUser({ email: 'cinbox@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(6, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    const { token } = agentWithAuth(app, host);
    const inbox = await request(app)
      .get('/api/host/inbox?bucket=new&limit=10')
      .set('Cookie', `authToken=${token}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.items.some((b) => String(b.id || b._id) === String(booking._id))).toBe(
      true
    );

    const csrf = await getCsrfPair(app);
    const conf = await withCsrf(
      request(app).put(`/api/hosts/bookings/${booking._id}/confirm`),
      csrf,
      `authToken=${token}`
    );
    expect(conf.status).toBe(200);

    const page = await request(app).get('/host/bookings');
    // unauthenticated host page redirects
    expect([200, 302]).toContain(page.status);
  });
});

describe('Finance export UI markers', () => {
  test('finance page has async export + jobs UI', async () => {
    // page requires host auth — unauthenticated redirects
    const res = await request(app).get('/host/finance');
    expect([200, 302]).toContain(res.status);

    // static script contains poll + bookings export
    const js = fs.readFileSync(path.join(__dirname, '../public/js/host-finance.js'), 'utf8');
    expect(js).toContain('pollJob');
    expect(js).toContain('/api/host/exports/bookings');
    expect(js).toContain('/api/jobs/me');

    const inboxJs = fs.readFileSync(path.join(__dirname, '../public/js/host-inbox.js'), 'utf8');
    expect(inboxJs).toContain('confirm');
    expect(inboxJs).toContain('checkin');
  });
});
