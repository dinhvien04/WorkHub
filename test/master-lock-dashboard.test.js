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
} = require('./helpers');
const { withLock, memoryAcquire, memoryRelease } = require('../utils/distributedLock');
const bookingService = require('../services/bookingService');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

describe('Distributed lock', () => {
  test('memory lock exclusive', async () => {
    const t1 = memoryAcquire('k', 1000);
    expect(t1).toBeTruthy();
    expect(memoryAcquire('k', 1000)).toBeNull();
    memoryRelease('k', t1);
    expect(memoryAcquire('k', 1000)).toBeTruthy();

    let ran = 0;
    await withLock('job-a', async () => {
      ran += 1;
    });
    expect(ran).toBe(1);
  });
});

describe('Customer dashboard + health + css build', () => {
  test('dashboard and server-timing', async () => {
    const host = await createUser({ email: 'hdash@test.com', role: 'host' });
    const customer = await createUser({ email: 'cdash@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(5, 1);
    await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    const { token } = agentWithAuth(app, customer);
    const dash = await request(app)
      .get('/api/me/dashboard')
      .set('Cookie', `authToken=${token}`);
    expect(dash.status).toBe(200);
    expect(dash.body.upcoming.length).toBeGreaterThanOrEqual(1);
    expect(dash.body.counts).toBeTruthy();

    const healthAdmin = await createUser({ email: 'hadm@test.com', role: 'admin' });
    const { token: aTok } = agentWithAuth(app, healthAdmin);
    const health = await request(app)
      .get('/api/admin/system-health')
      .set('Cookie', `authToken=${aTok}`);
    expect(health.status).toBe(200);
    expect(health.body.redis).toBeTruthy();

    const home = await request(app).get('/health');
    expect(home.headers['x-response-time'] || home.headers['server-timing']).toBeTruthy();

    execSync('node scripts/minify-css.js', { cwd: process.cwd() });
    expect(fs.existsSync(path.join('public', 'css', 'app.min.css'))).toBe(true);
    expect((await request(app).get('/css/app.min.css')).status).toBe(200);
    expect((await request(app).get('/dashboard')).status).toBe(200);
  });
});
