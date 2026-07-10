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
const metrics = require('../utils/metrics');
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

describe('Prometheus metrics + health details', () => {
  test('metrics endpoint and booking counter', async () => {
    const before = metrics.snapshot().bookingsCreated;

    const host = await createUser({ email: 'hm@test.com', role: 'host' });
    const customer = await createUser({ email: 'cm@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(2, 1);
    await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });

    expect(metrics.snapshot().bookingsCreated).toBeGreaterThanOrEqual(before + 1);

    await request(app).get('/health');
    const m = await request(app).get('/metrics');
    expect(m.status).toBe(200);
    expect(m.text).toContain('workhub_http_requests_total');
    expect(m.text).toContain('workhub_bookings_created_total');
    expect(m.headers['content-type']).toMatch(/text\/plain/);

    const details = await request(app).get('/health/details');
    expect(details.status).toBe(200);
    // metrics snapshot not public on /health/details (use /metrics)
    expect(details.body.version).toBeTruthy();
    expect(details.body.node).toBeUndefined();
  });
});
