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

describe('Routing: no root API aliases', () => {
  test('POST /me/bookings => 404', async () => {
    const res = await request(app).post('/me/bookings').send({});
    expect(res.status).toBe(404);
  });

  test('PUT /me/profile => 404', async () => {
    const res = await request(app).put('/me/profile').send({});
    expect(res.status).toBe(404);
  });

  test('POST /me/booking/confirm => 404', async () => {
    const res = await request(app).post('/me/booking/confirm').send({});
    expect(res.status).toBe(404);
  });
});

describe('Guest public pages', () => {
  test('GET / returns 200 without cookie', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });

  test('GET /search returns 200 without cookie', async () => {
    const res = await request(app).get('/search');
    expect(res.status).toBe(200);
  });
});

describe('CSRF protection', () => {
  test('POST /api/customers/me/bookings without CSRF => 403', async () => {
    const user = await createUser({ email: 'c@test.com', role: 'customer' });
    const { token } = agentWithAuth(app, user);
    const res = await request(app)
      .post('/api/customers/me/bookings')
      .set('Cookie', `authToken=${token}`)
      .send({ spaceId: 'x', startTime: new Date().toISOString(), endTime: new Date().toISOString() });
    expect(res.status).toBe(403);
  });

  test('POST with valid CSRF reaches auth/business layer', async () => {
    const user = await createUser({ email: 'c2@test.com', role: 'customer' });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);
    const res = await withCsrf(
      request(app).post('/api/customers/me/bookings'),
      csrf,
      `authToken=${token}`
    ).send({});
    // Missing fields -> 400 validation, not 403 CSRF
    expect(res.status).not.toBe(403);
    expect([400, 404, 500]).toContain(res.status);
  });

  test('mismatched CSRF header => 403', async () => {
    const user = await createUser({ email: 'c3@test.com', role: 'customer' });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);
    const res = await request(app)
      .post('/api/customers/me/bookings')
      .set('Cookie', `authToken=${token}; ${csrf.cookieHeader}`)
      .set('X-CSRF-Token', 'wrong-token-value')
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('Availability GET (no CSRF)', () => {
  test('guest can check availability', async () => {
    const host = await createUser({ email: 'h@test.com', role: 'host' });
    const { branch, space } = await seedHostSpace(host);
    // Align with API parsing `${date}T${hm}:00+07:00` — use a future VN calendar day
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + 5);
    const y = day.getUTCFullYear();
    const m = String(day.getUTCMonth() + 1).padStart(2, '0');
    const d = String(day.getUTCDate()).padStart(2, '0');
    const date = `${y}-${m}-${d}`;

    const params = new URLSearchParams({
      branchId: branch._id.toString(),
      date,
      timeSlot: '10:00 - 11:00',
      roomType: 'meeting',
    });

    const res = await request(app).get(`/api/customers/bookings/availability?${params}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.spaces)).toBe(true);
    // only available spaces
    expect(res.body.spaces.every((s) => s.Status === 'available' || !s.Status)).toBe(true);
    expect(space.Name).toBeTruthy();
  });

  test('past time rejected', async () => {
    const host = await createUser({ email: 'h2@test.com', role: 'host' });
    const { branch } = await seedHostSpace(host);
    const params = new URLSearchParams({
      branchId: branch._id.toString(),
      date: '2020-01-01',
      timeSlot: '10:00 - 11:00',
      roomType: 'meeting',
    });
    const res = await request(app).get(`/api/customers/bookings/availability?${params}`);
    expect(res.status).toBe(400);
  });
});
