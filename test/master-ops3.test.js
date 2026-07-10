'use strict';

const request = require('supertest');
const fs = require('fs');
const path = require('path');
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
const jobQueue = require('../services/jobQueue');
const ledgerService = require('../services/ledgerService');
const bookingService = require('../services/bookingService');
const featureFlagService = require('../services/featureFlagService');
const { listProviders, stripeLiveReady, momoLiveReady } = require('../services/gatewayProviders');
const DeadLetter = require('../models/DeadLetter');

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

describe('Job download + dead letter replay', () => {
  test('download completed export and replay DL', async () => {
    const host = await createUser({ email: 'hdl@test.com', role: 'host' });
    await ledgerService.postEntry({
      hostId: host._id,
      type: 'payment',
      amount: 50000,
      direction: 'credit',
      idempotencyKey: 'dl-pay-1',
    });
    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);
    const enq = await withCsrf(
      request(app).post('/api/host/exports/ledger'),
      csrf,
      `authToken=${token}`
    );
    expect(enq.status).toBe(202);
    const job = await jobQueue.processNextJob();
    expect(job.Status).toBe('completed');

    const dl = await request(app)
      .get(`/api/jobs/${job._id}/download`)
      .set('Cookie', `authToken=${token}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toMatch(/csv|octet|text/);

    const dead = await DeadLetter.create({
      Queue: 'exports',
      Payload: { type: 'generic', payload: { hello: 1 } },
      Error: 'boom',
      Attempts: 3,
      Status: 'open',
    });
    const admin = await createUser({ email: 'adl@test.com', role: 'admin' });
    const { token: aTok } = agentWithAuth(app, admin);
    const csrfA = await getCsrfPair(app);
    const replay = await withCsrf(
      request(app).post(`/api/admin/dead-letters/${dead._id}/replay`),
      csrfA,
      `authToken=${aTok}`
    );
    expect(replay.status).toBe(200);
    expect(replay.body.job).toBeTruthy();
  });
});

describe('Kill switch + gateway providers', () => {
  test('kill_switch_bookings blocks create; providers list live flags', async () => {
    const providers = listProviders();
    expect(providers.some((p) => p.id === 'stripe')).toBe(true);
    expect(typeof stripeLiveReady()).toBe('boolean');
    expect(typeof momoLiveReady()).toBe('boolean');

    await featureFlagService.upsertFlag({
      key: 'kill_switch_bookings',
      enabled: true,
      percentage: 100,
    });
    const host = await createUser({ email: 'hks@test.com', role: 'host' });
    const customer = await createUser({ email: 'cks@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(3, 1);
    await expect(
      bookingService.createBooking({
        customerId: customer._id,
        spaceId: space._id,
        startTime: start,
        endTime: end,
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    await featureFlagService.upsertFlag({ key: 'kill_switch_bookings', enabled: false });
  });
});
